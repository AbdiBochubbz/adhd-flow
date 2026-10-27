/**
 * Vault crypto: PBKDF2-SHA-256 → AES-GCM.
 * The key is not extractable. A wrong PIN fails the AES-GCM auth tag.
 * Salt and iterations live beside the ciphertext; they are not secret.
 */

export const ITERATIONS = 210_000;
export const VERIFIER = "STILL-VAULT-V1";

export function randomBytes(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function deriveKey(secret, salt, iterations = ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson(key, value) {
  const iv = randomBytes(12);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return { iv, ct };
}

export async function decryptJson(key, packed) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.iv }, key, packed.ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function makeVerifier(key) {
  return encryptJson(key, { ok: VERIFIER });
}

export async function checkVerifier(key, packed) {
  try {
    const value = await decryptJson(key, packed);
    return value?.ok === VERIFIER;
  } catch {
    return false;
  }
}

export function bytesToB64(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function b64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function packToJson(packed) {
  return { iv: bytesToB64(packed.iv), ct: bytesToB64(packed.ct) };
}

export function packFromJson(packed) {
  if (!packed || typeof packed.iv !== "string" || typeof packed.ct !== "string") return null;
  return { iv: b64ToBytes(packed.iv), ct: b64ToBytes(packed.ct) };
}
