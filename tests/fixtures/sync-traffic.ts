// What the sync server is allowed to learn, checked against the requests the
// stub actually captured. Independent of the client's crypto module on
// purpose: the pairing code is decoded and the keys are derived here from the
// published scheme (base32 secret + 2-byte checksum; HKDF-SHA256 with info
// "auth" / "enc"), so a client-side derivation change cannot also move the
// yardstick it is measured against.
import { webcrypto } from 'node:crypto';
import type { SyncStubCall } from './sync-stub.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SECRET_BYTES = 32;
const WIRE_VERSION = 0x01;
/** Shortest run of key material that counts as leaked (8 bytes). */
const LEAK_WINDOW_BYTES = 8;

export const BEARER_PATTERN = /^Bearer [0-9a-f]{64}$/;

export function decodePairingSecret(pairingCode: string): Uint8Array {
  const cleaned = pairingCode.toUpperCase().replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Not a base32 pairing code: "${char}"`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out.slice(0, SECRET_BYTES));
}

async function hkdf(secret: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await webcrypto.subtle.importKey('raw', new Uint8Array(secret), 'HKDF', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** The Bearer token a client holding `pairingCode` must send. */
export async function expectedAuthToken(pairingCode: string): Promise<string> {
  return Buffer.from(await hkdf(decodePairingSecret(pairingCode), 'auth')).toString('hex');
}

/** AES-GCM-open a `version | 12-byte IV | ciphertext+tag` body; null when the key doesn't fit. */
async function openWire(keyBytes: Uint8Array, body: Buffer): Promise<string | null> {
  try {
    const key = await webcrypto.subtle.importKey('raw', new Uint8Array(keyBytes), 'AES-GCM', false, ['decrypt']);
    const plaintext = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(body.subarray(1, 13)) },
      key,
      new Uint8Array(body.subarray(13)),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

function windows(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + size <= text.length; i += 1) out.push(text.slice(i, i + size));
  return out;
}

/** Every encoding of `bytes` the server could plausibly be handed. */
function encodings(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes);
  return [buf.toString('hex'), buf.toString('base64'), buf.toString('base64url')];
}

export interface TrafficExpectations {
  /** Pairing code shared by the browsers under test. */
  pairingCode: string;
  /** Strings present in the seeded settings/workspaces that must never appear on the wire. */
  plaintextMarkers: string[];
}

/** The JSON each PUT carried, opened with HKDF(secret, "enc"), in arrival order. */
export async function decryptPushes(calls: SyncStubCall[], pairingCode: string): Promise<unknown[]> {
  const encKey = await hkdf(decodePairingSecret(pairingCode), 'enc');
  const pushes: unknown[] = [];
  for (const call of calls.filter((c) => c.method === 'PUT')) {
    const plaintext = await openWire(encKey, call.body);
    if (plaintext === null) throw new Error('A pushed body does not open with this pairing code');
    pushes.push(JSON.parse(plaintext) as unknown);
  }
  return pushes;
}

/**
 * Returns one line per violation (empty = the captured traffic leaks nothing):
 * - every sync request carries `Bearer <64 lowercase hex>`;
 * - that token is HKDF(secret, "auth") and contains no 8-byte run of the
 *   pairing code, the secret, or the encryption key, in hex or base64;
 * - every PUT body is versioned ciphertext with no plaintext marker in it,
 *   whether raw or base64-encoded;
 * - every PUT body opens with HKDF(secret, "enc") but not with the token, so
 *   the server cannot read what it stores;
 * - each marker does appear in some decrypted push, so its absence on the
 *   wire is meaningful.
 */
export async function findTrafficLeaks(calls: SyncStubCall[], expectations: TrafficExpectations): Promise<string[]> {
  const { pairingCode, plaintextMarkers } = expectations;
  const secret = decodePairingSecret(pairingCode);
  const encKey = await hkdf(secret, 'enc');
  const authToken = await expectedAuthToken(pairingCode);
  const normalizedCode = pairingCode.toUpperCase().replace(/[\s-]/g, '');
  const leakWindowChars = LEAK_WINDOW_BYTES * 2;

  const secretFragments = [
    ...[secret, encKey].flatMap((bytes) => encodings(bytes).flatMap((text) => windows(text, leakWindowChars))),
    ...windows(normalizedCode, leakWindowChars),
    ...windows(Buffer.from(normalizedCode).toString('hex'), leakWindowChars),
  ].map((fragment) => fragment.toLowerCase());

  const leaks: string[] = [];
  const pushedPlaintexts: string[] = [];
  for (const [index, call] of calls.entries()) {
    if (call.method === 'OPTIONS') continue;
    const label = `#${index} ${call.method}`;
    const authorization = call.authorization ?? '';
    if (!BEARER_PATTERN.test(authorization)) {
      leaks.push(`${label}: Authorization "${authorization}" is not "Bearer <64 lowercase hex>"`);
      continue;
    }
    const token = authorization.slice('Bearer '.length);
    if (token !== authToken) leaks.push(`${label}: token is not HKDF(secret, "auth")`);
    const leaked = secretFragments.find((fragment) => token.includes(fragment));
    if (leaked) leaks.push(`${label}: token contains key material fragment "${leaked}"`);

    if (call.method !== 'PUT') continue;
    if (call.body[0] !== WIRE_VERSION) leaks.push(`${label}: body does not start with wire version ${WIRE_VERSION}`);
    if (call.contentType !== 'application/octet-stream') leaks.push(`${label}: Content-Type is ${String(call.contentType)}`);
    const bodyText = call.body.toString('latin1');
    for (const marker of plaintextMarkers) {
      for (const encoded of [marker, Buffer.from(marker).toString('base64')]) {
        if (bodyText.includes(encoded)) leaks.push(`${label}: body contains plaintext marker "${marker}"`);
      }
    }
    if ((await openWire(Buffer.from(token, 'hex'), call.body)) !== null) {
      leaks.push(`${label}: body can be decrypted with the Bearer token the server holds`);
    }
    const plaintext = await openWire(encKey, call.body);
    if (plaintext === null) leaks.push(`${label}: body is not sealed with HKDF(secret, "enc")`);
    else pushedPlaintexts.push(plaintext);
  }

  // Guards the marker check itself: a marker that never travelled proves nothing.
  if (pushedPlaintexts.length > 0) {
    for (const marker of plaintextMarkers) {
      if (!pushedPlaintexts.some((plaintext) => plaintext.includes(marker))) {
        leaks.push(`marker "${marker}" is absent from every decrypted push, so its absence on the wire proves nothing`);
      }
    }
  }
  return leaks;
}
