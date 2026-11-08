import { checkVerifier, decryptJson, deriveKey, encryptJson, makeVerifier, randomBytes } from "./crypto.js";
import { sanitizePayload } from "./model.js";
import { mergePayloads } from "./merge.js";

/** What to show. A saved local list always wins. A legacy vault is never treated as empty. */
export function decideBoot({ localList, legacy }) {
  if (localList) return { screen: "app", data: localList, fresh: false };
  if (legacy === "ready" || legacy === "partial") return { screen: "migrate", partial: legacy === "partial", fresh: false };
  return { screen: "app", data: null, fresh: true };
}

/** Read a 1.3 vault record. Does not write, and does not accept a wrong PIN as success. */
export async function unlockLegacy(secret, record) {
  if (!record?.salt || !record?.verifier || !record?.vault) {
    return { ok: false, code: "unreadable" };
  }
  const key = await deriveKey(secret, record.salt, record.iterations);
  const ok = await checkVerifier(key, record.verifier);
  if (!ok) return { ok: false, code: "bad-pin" };
  try {
    const data = sanitizePayload(await decryptJson(key, record.vault));
    return { ok: true, data };
  } catch {
    return { ok: false, code: "unreadable" };
  }
}

/** Seal a list the same way Still 1.3 did, for tests and for checking a backup PIN. */
export async function sealLegacy(secret, payload, iterations) {
  const salt = randomBytes(16);
  const key = await deriveKey(secret, salt, iterations);
  const verifier = await makeVerifier(key);
  const vault = await encryptJson(key, sanitizePayload(payload));
  return { salt, iterations, verifier, vault };
}

export function mergeKeptLists(current, unlocked) {
  const base = current || { tasks: [], tombstones: [], settings: {}, accountEmail: "", syncKeyB64: "" };
  return mergePayloads(base, unlocked);
}

/** Sign-out drops the server session only. The on-device list is the same object. */
export function afterSignOut(localList) {
  return { localList, clearedList: false };
}
