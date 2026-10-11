// Local stand-in for the settings-sync server (api.flippflix.com/sync), shared
// by the Playwright Chrome suite and the Puppeteer suite, so every sync spec
// runs hermetically: no request ever reaches the real host.
//
// Behaviour mirrors the Worker's contract: one opaque blob per Bearer token,
// PUT stores (204), GET returns it as application/octet-stream (200) or 404,
// bodies over 5 MB are refused with 413, a missing/malformed token gets 401.
// Response headers are copied from the Worker so CORS behaves the same way.
//
// Browsers reach it at the real hostname, never through a code change:
// - Chromium: `--host-resolver-rules` maps the host to the local TLS port;
//   `--ignore-certificate-errors` accepts the self-signed cert.
// - Firefox: a PAC file sends the host to a local HTTP proxy whose CONNECT
//   handler hands the tunnelled socket straight to the same TLS server;
//   the WebDriver session's acceptInsecureCerts accepts the cert.
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { createSelfSignedCert } from './network-stub.js';

export const SYNC_HOST = 'api.flippflix.com';
const SYNC_PATH = '/sync';
const BODY_SIZE_LIMIT = 5 * 1024 * 1024;
const TOKEN_PATTERN = /^Bearer\s+([0-9a-fA-F]{64})$/;

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' } as const;
// A Worker `new Response(string)` defaults to this content type.
const TEXT_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'text/plain;charset=UTF-8' } as const;
const PREFLIGHT_HEADERS = {
  ...CORS_HEADERS,
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
} as const;
const BLOB_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/octet-stream',
  'Cache-Control': 'no-cache, no-store',
} as const;

export interface SyncStubCall {
  method: string;
  path: string;
  authorization: string | null;
  /** Lowercased 64-hex token, or null when the header was missing/malformed. */
  token: string | null;
  contentType: string | null;
  body: Buffer;
  /** Status sent back; 0 when the connection was dropped by an injected fault. */
  status: number;
}

/**
 * One-shot misbehaviour for the next matching request: answer with `status`
 * instead of the contract response, or drop the connection mid-request so
 * the browser sees a network error.
 */
export type SyncStubFault = { method?: 'GET' | 'PUT'; status: number } | { method?: 'GET' | 'PUT'; drop: true };

export interface SyncStub {
  /** Chromium launch args routing the sync host to this stub. */
  readonly chromeArgs: string[];
  /** Firefox prefs routing the sync host to this stub (pair with acceptInsecureCerts). */
  readonly firefoxPrefs: Record<string, string | number | boolean>;
  /** Every request received so far, CORS preflights included, in arrival order. */
  calls(): SyncStubCall[];
  /** Calls excluding CORS preflights, optionally filtered by method. */
  syncCalls(method?: 'GET' | 'PUT'): SyncStubCall[];
  /** Stored blob for a token, if any. */
  blob(token: string): Buffer | undefined;
  /** Overwrite (or create) the stored blob for a token. */
  setBlob(token: string, bytes: Buffer): void;
  /** Queue a one-shot fault; faults are consumed in order by matching requests. */
  injectFault(fault: SyncStubFault): void;
  /** Forget calls, blobs and queued faults, so one stub can serve several tests. */
  reset(): void;
  close(): Promise<void>;
}

function extractToken(authorization: string | null): string | null {
  const match = authorization?.match(TOKEN_PATTERN);
  return match ? match[1]!.toLowerCase() : null;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

export async function startSyncStub(): Promise<SyncStub> {
  let calls: SyncStubCall[] = [];
  let faults: SyncStubFault[] = [];
  const blobs = new Map<string, Buffer>();

  const takeFault = (method: string): SyncStubFault | undefined => {
    const index = faults.findIndex((fault) => !fault.method || fault.method === method);
    if (index === -1) return undefined;
    const [fault] = faults.splice(index, 1);
    return fault;
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const method = (req.method ?? '').toUpperCase();
    const path = new URL(req.url ?? '/', `https://${SYNC_HOST}`).pathname;
    const authorization = req.headers.authorization ?? null;
    const token = extractToken(authorization);
    const body = await readBody(req);
    const record = (status: number): void => {
      calls = [...calls, { method, path, authorization, token, contentType: req.headers['content-type'] ?? null, body, status }];
    };
    const respond = (status: number, headers: Record<string, string>, payload?: Buffer | string): void => {
      record(status);
      res.writeHead(status, headers);
      res.end(payload);
    };

    if (path !== SYNC_PATH) return respond(404, TEXT_HEADERS, 'Not found');
    if (method === 'OPTIONS') return respond(204, PREFLIGHT_HEADERS);

    const fault = takeFault(method);
    if (fault && 'drop' in fault) {
      record(0);
      req.socket.destroy();
      return;
    }
    if (fault) return respond(fault.status, TEXT_HEADERS, `Injected ${fault.status}`);

    if (!token) return respond(401, TEXT_HEADERS, 'Unauthorized');

    if (method === 'PUT') {
      if (body.byteLength > BODY_SIZE_LIMIT) return respond(413, TEXT_HEADERS, 'Payload too large');
      blobs.set(token, body);
      return respond(204, CORS_HEADERS);
    }
    if (method === 'GET') {
      const stored = blobs.get(token);
      return stored ? respond(200, BLOB_HEADERS, stored) : respond(404, CORS_HEADERS);
    }
    return respond(405, { ...TEXT_HEADERS, Allow: 'GET, PUT, OPTIONS' }, 'Method not allowed');
  };

  const tlsServer = https.createServer(createSelfSignedCert([SYNC_HOST]), (req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });

  // Firefox has no host-resolver override, so it reaches the stub as a proxy
  // client: CONNECT api.flippflix.com:443 is answered here and the raw socket
  // becomes a TLS connection on tlsServer. Any other CONNECT target is refused,
  // so a misrouted request fails loudly instead of leaving the machine.
  const proxyServer = http.createServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  proxyServer.on('connect', (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
    if (req.url !== `${SYNC_HOST}:443`) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.byteLength > 0) socket.unshift(head);
    tlsServer.emit('connection', socket);
  });

  const listen = (server: http.Server): Promise<number> =>
    new Promise((resolveListen) => {
      server.listen(0, '127.0.0.1', () => resolveListen((server.address() as AddressInfo).port));
    });
  const [tlsPort, proxyPort] = await Promise.all([listen(tlsServer), listen(proxyServer)]);

  const pac = `function FindProxyForURL(url, host) {
  if (host === "${SYNC_HOST}") return "PROXY 127.0.0.1:${proxyPort}";
  return "DIRECT";
}`;

  const close = (server: http.Server): Promise<void> =>
    new Promise((resolveClose) => {
      server.closeAllConnections();
      server.close(() => resolveClose());
    });

  return {
    chromeArgs: [`--host-resolver-rules=MAP ${SYNC_HOST} 127.0.0.1:${tlsPort}`, '--ignore-certificate-errors'],
    firefoxPrefs: {
      'network.proxy.type': 2,
      'network.proxy.autoconfig_url': `data:text/javascript,${encodeURIComponent(pac)}`,
    },
    calls: () => [...calls],
    syncCalls: (method) => calls.filter((c) => c.method !== 'OPTIONS' && (!method || c.method === method)),
    blob: (token) => blobs.get(token),
    setBlob: (token, bytes) => {
      blobs.set(token, bytes);
    },
    injectFault: (fault) => {
      faults = [...faults, fault];
    },
    reset: () => {
      calls = [];
      faults = [];
      blobs.clear();
    },
    close: async () => {
      await Promise.all([close(proxyServer), close(tlsServer)]);
    },
  };
}
