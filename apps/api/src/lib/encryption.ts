/**
 * Encryption helpers for sensitive data (API keys, secrets)
 * Uses AES-GCM with Web Crypto API (edge-compatible)
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96 bits for GCM
const KEY_LENGTH = 256; // bits

/**
 * Check if a string is valid base64
 */
function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) return false;
  try {
    return btoa(atob(str)) === str;
  } catch {
    return false;
  }
}

/**
 * Derive a CryptoKey from a base64-encoded secret
 */
async function getKey(secret: string): Promise<CryptoKey> {
  if (!isValidBase64(secret)) {
    throw new Error(
      "Invalid ENCRYPTION_KEY: must be a valid base64-encoded 256-bit key. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  // Decode base64 secret to raw bytes
  const keyBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey("raw", keyBytes, { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt plaintext using AES-GCM
 * Returns base64-encoded string: iv:ciphertext
 */
export async function encrypt(
  plaintext: string,
  encryptionKey: string,
): Promise<string> {
  const key = await getKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext),
  );

  // Combine IV and ciphertext, encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt ciphertext using AES-GCM
 * Expects base64-encoded string containing iv:ciphertext
 */
export async function decrypt(
  ciphertext: string,
  encryptionKey: string,
): Promise<string> {
  const key = await getKey(encryptionKey);

  // Decode base64 to raw bytes
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data,
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Generate a random encryption key (base64-encoded)
 * Run once: console.log(generateEncryptionKey())
 */
export function generateEncryptionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_LENGTH / 8));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Mask a secret key for display (show first/last 4 chars)
 */
export function maskSecretKey(key: string | null): string | null {
  if (!key || key.length < 12) return key;
  const prefix = key.slice(0, 7); // sk_test_ or sk_live_
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}
