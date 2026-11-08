import {
  ITERATIONS,
  b64ToBytes,
  bytesToB64,
  checkVerifier,
  decryptJson,
  deriveKey,
  encryptJson,
  makeVerifier,
  randomBytes,
} from "./crypto.js";
import { clearStores, commitVault, deleteDatabase, kvDelete, kvGet, kvSet, readVaultRecord, setFails, setNotifTitles } from "./db.js";
import { sanitizePayload } from "./model.js";

export function vaultRecordState(record) {
  const salt = Boolean(record?.salt);
  const verifier = Boolean(record?.verifier);
  const vault = Boolean(record?.vault);
  if (salt && verifier && vault) return "ready";
  if (salt || verifier || vault) return "partial";
  return "empty";
}

export function assertCanCreate(record, replace = false) {
  if (vaultRecordState(record) !== "empty" && !replace) {
    const error = new Error("A vault is already on this device.");
    error.code = "vault-exists";
    throw error;
  }
}

export async function vaultExists() {
  const record = await readVaultRecord();
  return vaultRecordState(record) === "ready";
}

export async function readFails() {
  const record = await readVaultRecord();
  return record.fails || { count: 0, until: 0 };
}

export async function createVault(secret, payload, { replace = false } = {}) {
  const existing = await readVaultRecord();
  assertCanCreate(existing, replace);
  if (replace && vaultRecordState(existing) !== "empty") await keepPreviousVault(existing);
  const clean = sanitizePayload(payload);
  const salt = randomBytes(16);
  const key = await deriveKey(secret, salt, ITERATIONS);
  const verifier = await makeVerifier(key);
  const vault = await encryptJson(key, clean);
  if (!(await checkVerifier(key, verifier))) throw new Error("Could not seal the vault.");
  await commitVault({ salt, iterations: ITERATIONS, verifier, vault });
  await setFails({ count: 0, until: 0 });
  await setNotifTitles(clean.settings.showTitlesInNotifications);
  return key;
}

export async function openVault(secret) {
  const record = await readVaultRecord();
  if (!record.salt || !record.verifier || !record.vault) throw new Error("No vault");
  const iterations = record.iterations || ITERATIONS;
  const key = await deriveKey(secret, record.salt, iterations);
  const ok = await checkVerifier(key, record.verifier);
  if (!ok) {
    const error = new Error("Wrong PIN");
    error.code = "bad-pin";
    throw error;
  }
  const data = sanitizePayload(await decryptJson(key, record.vault));
  await setFails({ count: 0, until: 0 });
  return { key, data };
}

export async function saveVault(key, payload) {
  const clean = sanitizePayload(payload);
  const vault = await encryptJson(key, clean);
  const record = await readVaultRecord();
  await commitVault({
    salt: record.salt,
    iterations: record.iterations || ITERATIONS,
    verifier: record.verifier,
    vault,
  });
  await setNotifTitles(clean.settings.showTitlesInNotifications);
  return clean;
}

export async function changeSecret(newSecret, payload) {
  const salt = randomBytes(16);
  const key = await deriveKey(newSecret, salt, ITERATIONS);
  const verifier = await makeVerifier(key);
  const vault = await encryptJson(key, sanitizePayload(payload));
  if (!(await checkVerifier(key, verifier))) throw new Error("Could not re-seal the vault.");
  await decryptJson(key, vault);
  await commitVault({ salt, iterations: ITERATIONS, verifier, vault });
  await setFails({ count: 0, until: 0 });
  return key;
}

export async function noteFailedAttempt() {
  const fails = await readFails();
  const count = (fails.count || 0) + 1;
  const waits = [0, 0, 0, 0, 30_000, 60_000, 300_000];
  const wait = waits[Math.min(count, waits.length - 1)];
  const next = { count, until: Date.now() + wait };
  await setFails(next);
  return next;
}

export async function keepPreviousVault(record = null) {
  const current = record || (await readVaultRecord());
  if (vaultRecordState(current) === "empty") return false;
  await kvSet("vault-previous", {
    salt: current.salt,
    iterations: current.iterations,
    verifier: current.verifier,
    vault: current.vault,
    savedAt: Date.now(),
  });
  return true;
}

export async function hasPreviousVault() {
  const previous = await kvGet("vault-previous");
  return vaultRecordState(previous) === "ready";
}

/** Swap the live vault with the copy taken before the last import. Does not delete either copy. */
export async function restorePreviousVault() {
  const previous = await kvGet("vault-previous");
  if (vaultRecordState(previous) !== "ready") return false;
  const current = await readVaultRecord();
  await commitVault({
    salt: previous.salt,
    iterations: previous.iterations,
    verifier: previous.verifier,
    vault: previous.vault,
  });
  if (vaultRecordState(current) === "ready") {
    await kvSet("vault-previous", {
      salt: current.salt,
      iterations: current.iterations,
      verifier: current.verifier,
      vault: current.vault,
      savedAt: Date.now(),
    });
  }
  return true;
}

export async function eraseVault() {
  await clearStores();
  await deleteDatabase();
}

export async function clearSyncSession() {
  await kvDelete("sync-session");
}

export async function readLocalList() {
  const value = await kvGet("local-list");
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return sanitizePayload(value);
}

export async function writeLocalList(payload) {
  const clean = sanitizePayload(payload);
  await kvSet("local-list", clean);
  const saved = await readLocalList();
  if (!saved) throw new Error("The list could not be saved.");
  return saved;
}

export async function readLegacyArchive() {
  return kvGet("legacy-archive");
}

export async function archiveLegacy(record) {
  if (vaultRecordState(record) !== "ready") return false;
  await kvSet("legacy-archive", {
    salt: record.salt,
    iterations: record.iterations,
    verifier: record.verifier,
    vault: record.vault,
    savedAt: Date.now(),
  });
  const stored = await readLegacyArchive();
  if (vaultRecordState(stored) !== "ready") throw new Error("The older encrypted copy could not be kept.");
  return true;
}

export async function clearLiveLegacy() {
  await kvDelete("salt");
  await kvDelete("iterations");
  await kvDelete("verifier");
  await kvDelete("vault");
}

export async function readLocalPrevious() {
  const value = await kvGet("local-previous");
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return sanitizePayload(value);
}

export async function writeLocalPrevious(payload) {
  await kvSet("local-previous", sanitizePayload(payload));
}

export function backupFromRecord(record) {
  return {
    format: "still-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: record.iterations || ITERATIONS },
    cipher: "AES-GCM",
    salt: bytesToB64(record.salt),
    verifier: { iv: bytesToB64(record.verifier.iv), ct: bytesToB64(record.verifier.ct) },
    vault: { iv: bytesToB64(record.vault.iv), ct: bytesToB64(record.vault.ct) },
  };
}

function asBytes(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    return b64ToBytes(value);
  } catch {
    return null;
  }
}

export function parseBackup(json) {
  if (!json || json.format !== "still-backup" || json.version !== 1) return null;
  const salt = asBytes(json.salt);
  const verifier = { iv: asBytes(json.verifier?.iv), ct: asBytes(json.verifier?.ct) };
  const vault = { iv: asBytes(json.vault?.iv), ct: asBytes(json.vault?.ct) };
  if (!salt || !verifier.iv || !verifier.ct || !vault.iv || !vault.ct) return null;
  const iterations = Number(json.kdf?.iterations);
  if (!Number.isInteger(iterations) || iterations < 50_000 || iterations > 2_000_000) return null;
  return { salt, iterations, verifier, vault };
}
