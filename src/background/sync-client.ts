// Settings-sync client core (#7). Background-only: fetch happens here, never
// in newtab. Encrypts the export bundle client-side before it ever leaves the
// browser; decrypts on pull. The server only ever sees the derived authToken
// and opaque ciphertext bytes.

import { firefoxSafeFetchRequest } from './icons/platform';
import { SYNC_ENDPOINT } from '@/shared/constants';
import { SyncFetchError } from '@/shared/models';
import {
  decodePairingCode,
  decryptPayload,
  deriveAesKey,
  deriveAuthToken,
  encodePairingCode,
  encryptPayload,
  getOrCreateSyncSecret,
  replaceSyncSecret,
  SyncCryptoError,
} from '@/shared/sync-crypto';

const syncFetchTimeoutMs = 10_000;

async function authHeaders(): Promise<{ Authorization: string }> {
  const secret = await getOrCreateSyncSecret();
  const authToken = await deriveAuthToken(secret);
  return { Authorization: `Bearer ${authToken}` };
}

function classifyHttpStatus(status: number): SyncFetchError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 413) return new SyncFetchError('payload-too-large', 'Sync payload was rejected as too large.', status);
  if (status === 429) return new SyncFetchError('rate-limited', 'Sync server is rate-limiting this device. Try again shortly.', status);
  return new SyncFetchError('http-status', `Sync server responded with HTTP ${status}.`, status);
}

// Wraps a fetch call so any network-level rejection (offline, CORS block, DNS
// failure) surfaces as a typed SyncFetchError('network' | 'offline') instead of
// an opaque TypeError, matching the "no silent failures" requirement.
async function requestSync(init: { method: string; headers?: Record<string, string>; body?: BodyInit }): Promise<Response> {
  try {
    return await firefoxSafeFetchRequest(SYNC_ENDPOINT, init, syncFetchTimeoutMs);
  } catch (error) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const message = error instanceof Error ? error.message : String(error);
    throw new SyncFetchError(offline ? 'offline' : 'network', `Could not reach the sync server: ${message}`);
  }
}

export async function syncPush(bundle: unknown): Promise<void> {
  const secret = await getOrCreateSyncSecret();
  const [authToken, aesKey] = await Promise.all([deriveAuthToken(secret), deriveAesKey(secret)]);
  const ciphertext = await encryptPayload(JSON.stringify(bundle), aesKey);

  const response = await requestSync({
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: toArrayBuffer(ciphertext),
  });

  const httpError = classifyHttpStatus(response.status);
  if (httpError) throw httpError;
}

export type SyncPullResult = { found: true; payload: unknown } | { found: false };

export async function syncPull(): Promise<SyncPullResult> {
  const headers = await authHeaders();
  const response = await requestSync({ method: 'GET', headers });

  if (response.status === 404) {
    return { found: false };
  }

  const httpError = classifyHttpStatus(response.status);
  if (httpError) throw httpError;

  const secret = await getOrCreateSyncSecret();
  const aesKey = await deriveAesKey(secret);
  const bodyBytes = new Uint8Array(await response.arrayBuffer());

  try {
    const json = await decryptPayload(bodyBytes, aesKey);
    return { found: true, payload: JSON.parse(json) as unknown };
  } catch (error) {
    // A decrypt/JSON failure here means the stored blob doesn't match this
    // device's secret (or is corrupt) — surface distinctly from a transport
    // error so the UI can suggest re-pairing rather than "try again".
    const message = error instanceof Error ? error.message : String(error);
    throw new SyncFetchError('unknown', `Could not decrypt the synced data: ${message}`);
  }
}

export async function getSyncPairingCode(): Promise<string> {
  const secret = await getOrCreateSyncSecret();
  return encodePairingCode(secret);
}

export async function adoptSyncSecret(pairingCode: string): Promise<void> {
  let secret: Uint8Array;
  try {
    secret = await decodePairingCode(pairingCode);
  } catch (error) {
    if (error instanceof SyncCryptoError) {
      throw new SyncFetchError('validation', error.message);
    }
    throw new SyncFetchError('validation', 'Pairing code could not be read.');
  }

  await replaceSyncSecret(secret);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
