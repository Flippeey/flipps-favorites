// Hermetic stand-in for a live external host in tests that assert on a real
// browser navigation (e.g. an extension-opened tab landing at a bookmark's
// URL). `context.route`/`page.route` cannot reliably cover this case: a tab
// opened via the extension message pipeline (extensionApi.tabs.create) is a
// browser-level navigation, not a page-driven popup, so Playwright's
// per-target request interception and `ignoreHTTPSErrors` override can both
// lose the race to attach before that tab's first request lands — measured
// empirically as an intermittent chrome-error://chromewebdata result even
// with a context.route() in place.
//
// Two process-level Chromium flags close the race instead of racing a
// per-target attach: `--host-resolver-rules` redirects the hostname to this
// local stub server from the browser's first packet (no DNS/network
// dependency), and `--ignore-certificate-errors` applies from process start
// (not per-target), so the self-signed stub cert doesn't need to win any
// attach race either.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface StubHost {
  /** Chromium `--host-resolver-rules` value redirecting the given hosts (port 443) here. */
  hostResolverRules: string;
  close(): Promise<void>;
}

/**
 * Starts a local HTTPS server with a throwaway self-signed cert whose SAN
 * list covers `hostnames`, so the browser's TLS handshake for the real
 * hostname validates against this server without needing to also race an
 * `ignoreHTTPSErrors` override on a brand-new tab target. Returns the
 * `--host-resolver-rules` value that maps `hostnames` to it.
 */
export async function startStubHost(hostnames: string[]): Promise<StubHost> {
  const certDir = mkdtempSync(join(tmpdir(), 'ff-stub-cert-'));
  const keyPath = join(certDir, 'key.pem');
  const certPath = join(certDir, 'cert.pem');
  const sanList = hostnames.map((host) => `DNS:${host}`).join(',');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-subj',
      `/CN=${hostnames[0]}`,
      '-addext',
      `subjectAltName=${sanList}`,
    ],
    { stdio: 'ignore' },
  );

  const server = https.createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>stub</title>');
    },
  );
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as AddressInfo).port;
  rmSync(certDir, { recursive: true, force: true });

  return {
    hostResolverRules: hostnames.map((host) => `MAP ${host}:443 127.0.0.1:${port}`).join(','),
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}
