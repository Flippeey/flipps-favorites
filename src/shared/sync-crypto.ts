// End-to-end-encryption core for settings sync (#7).
//
// The master secret never leaves the client. Everything the sync server ever
// sees is: the derived authToken (Bearer header) and opaque AES-GCM
// ciphertext. Do not console.log the secret, the derived aesKey's raw bytes,
// or the authToken.
//
// No extension-API import at module scope (would throw in Node/Vitest — see
// background/icons/platform.ts precedent). Storage access goes through
// shared/storage-buckets.ts, which itself only touches extensionApi lazily
// inside async functions, so this file is safe to import in tests.

import { createCachedValueStore } from './storage-buckets';

const SECRET_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const WIRE_VERSION = 0x01;
const SYNC_SECRET_STORAGE_KEY = 'sync-secret';

export type SyncCryptoErrorKind = 'bad-length' | 'bad-checksum' | 'malformed';

export class SyncCryptoError extends Error {
  readonly kind: SyncCryptoErrorKind;

  constructor(kind: SyncCryptoErrorKind, message: string) {
    super(message);
    this.name = 'SyncCryptoError';
    this.kind = kind;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Master secret: get-or-create, persisted base64-encoded in the sync-preferred
// storage bucket (same CachedValueStore pattern as app-settings).
// ─────────────────────────────────────────────────────────────────────────────

const syncSecretStore = createCachedValueStore<Uint8Array | null>({
  storageKey: SYNC_SECRET_STORAGE_KEY,
  area: 'sync-preferred',
  deserialize(storedValue) {
    if (typeof storedValue !== 'string' || !storedValue) return null;
    try {
      return base64ToBytes(storedValue);
    } catch {
      return null;
    }
  },
  serialize(value) {
    return value ? bytesToBase64(value) : null;
  },
});

export function generateSecret(): Uint8Array {
  const secret = new Uint8Array(SECRET_BYTE_LENGTH);
  crypto.getRandomValues(secret);
  return secret;
}

let getOrCreatePromise: Promise<Uint8Array> | null = null;

// Get-or-create the persisted master secret. Concurrent callers within the same
// lifetime share one in-flight creation so a race can't generate two secrets.
export async function getOrCreateSyncSecret(): Promise<Uint8Array> {
  if (!getOrCreatePromise) {
    getOrCreatePromise = (async () => {
      const existing = await syncSecretStore.read();
      if (existing) return existing;

      const created = generateSecret();
      await syncSecretStore.write(created);
      return created;
    })().catch(error => {
      getOrCreatePromise = null;
      throw error;
    });
  }
  return getOrCreatePromise;
}

// Replace the stored master secret (adopt-secret flow). Resets the in-flight
// get-or-create memo so a subsequent getOrCreateSyncSecret() call returns the
// newly adopted secret rather than a stale in-memory one.
export async function replaceSyncSecret(secret: Uint8Array): Promise<void> {
  await syncSecretStore.write(secret);
  getOrCreatePromise = Promise.resolve(secret);
}

// ─────────────────────────────────────────────────────────────────────────────
// HKDF-SHA256 derivations
// ─────────────────────────────────────────────────────────────────────────────

async function importSecretAsHkdfKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(secret), 'HKDF', false, ['deriveBits', 'deriveKey']);
}

function hkdfParams(info: string): HkdfParams {
  return {
    name: 'HKDF',
    hash: 'SHA-256',
    // No separate salt secret is needed: the master secret itself is already
    // uniformly random (crypto.getRandomValues), so a zero-length salt is safe
    // per RFC 5869 (HKDF-Extract treats a missing salt as an all-zero string).
    salt: new Uint8Array(0),
    info: new TextEncoder().encode(info),
  };
}

// authToken = HKDF(secret, info="auth") -> 32 bytes -> lowercase hex. This is
// the ONLY value ever sent to the server (Authorization: Bearer <authToken>).
export async function deriveAuthToken(secret: Uint8Array): Promise<string> {
  const hkdfKey = await importSecretAsHkdfKey(secret);
  const bits = await crypto.subtle.deriveBits(hkdfParams('auth'), hkdfKey, 256);
  return bytesToHex(new Uint8Array(bits));
}

// aesKey = HKDF(secret, info="enc") -> AES-GCM 256 CryptoKey. Never leaves the
// client, never serialized to storage or network.
export async function deriveAesKey(secret: Uint8Array): Promise<CryptoKey> {
  const hkdfKey = await importSecretAsHkdfKey(secret);
  return crypto.subtle.deriveKey(
    hkdfParams('enc'),
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    true, // extractable — round-trip tests inspect raw key bytes; harmless since the key itself never leaves the client
    ['encrypt', 'decrypt'],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AES-GCM encrypt/decrypt. Wire format: 1 version byte (0x01) + 12-byte random
// IV + ciphertext (includes the GCM auth tag). Sent as application/octet-stream.
// ─────────────────────────────────────────────────────────────────────────────

export async function encryptPayload(json: string, aesKey: CryptoKey): Promise<Uint8Array> {
  const iv = new Uint8Array(IV_BYTE_LENGTH);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(json);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(plaintext)),
  );

  const wire = new Uint8Array(1 + IV_BYTE_LENGTH + ciphertext.byteLength);
  wire[0] = WIRE_VERSION;
  wire.set(iv, 1);
  wire.set(ciphertext, 1 + IV_BYTE_LENGTH);
  return wire;
}

export async function decryptPayload(wire: Uint8Array, aesKey: CryptoKey): Promise<string> {
  if (wire.byteLength < 1 + IV_BYTE_LENGTH + 1) {
    throw new SyncCryptoError('bad-length', 'Encrypted payload is too short to be valid.');
  }
  if (wire[0] !== WIRE_VERSION) {
    throw new SyncCryptoError('malformed', `Unsupported sync payload version: ${wire[0]}`);
  }

  const iv = wire.slice(1, 1 + IV_BYTE_LENGTH);
  const ciphertext = wire.slice(1 + IV_BYTE_LENGTH);

  // Any tamper/wrong-key case surfaces as a WebCrypto OperationError from the
  // GCM auth-tag check — let it propagate as-is rather than masking it.
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(ciphertext));
  return new TextDecoder().decode(plaintext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pairing code: base32 (RFC 4648, no padding, uppercase) of secret(32B) +
// 2-byte checksum (first 2 bytes of SHA-256(secret)). Displayed grouped in
// blocks of 4 separated by '-'. Decode is tolerant of case/dashes/whitespace.
// ─────────────────────────────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

function base32Decode(input: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new SyncCryptoError('malformed', `Invalid pairing code character: "${char}"`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

async function computeChecksum(secret: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(secret)));
  return digest.slice(0, 2);
}

function groupInBlocksOf4(base32: string): string {
  const blocks: string[] = [];
  for (let i = 0; i < base32.length; i += 4) {
    blocks.push(base32.slice(i, i + 4));
  }
  return blocks.join('-');
}

// Encodes secret(32B) + 2-byte SHA-256 checksum as uppercase base32 (RFC 4648,
// no padding), displayed grouped in blocks of 4 separated by '-'. Async because
// the checksum requires a WebCrypto digest.
export async function encodePairingCode(secret: Uint8Array): Promise<string> {
  const checksum = await computeChecksum(secret);
  const payload = new Uint8Array(secret.byteLength + checksum.byteLength);
  payload.set(secret, 0);
  payload.set(checksum, secret.byteLength);
  return groupInBlocksOf4(base32Encode(payload));
}

// Decodes a pairing code back to the 32-byte secret. Tolerant of lowercase,
// dashes, and surrounding/interior whitespace. Rejects wrong length or a
// tampered checksum with a typed SyncCryptoError — never returns a "valid
// looking" but wrong secret.
export async function decodePairingCode(rawCode: string): Promise<Uint8Array> {
  const cleaned = rawCode.toUpperCase().replace(/[\s-]/g, '');
  const decoded = base32Decode(cleaned);

  const expectedLength = SECRET_BYTE_LENGTH + 2; // secret + 2-byte checksum
  if (decoded.byteLength !== expectedLength) {
    throw new SyncCryptoError(
      'bad-length',
      `Pairing code decodes to ${decoded.byteLength} bytes; expected ${expectedLength}.`,
    );
  }

  const secret = decoded.slice(0, SECRET_BYTE_LENGTH);
  const providedChecksum = decoded.slice(SECRET_BYTE_LENGTH);
  const expectedChecksum = await computeChecksum(secret);

  if (!bytesEqual(providedChecksum, expectedChecksum)) {
    throw new SyncCryptoError('bad-checksum', 'Pairing code checksum does not match — check for typos.');
  }

  return secret;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is available in both the extension DOM contexts and Node 18+ (global).
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
