import { bytesToB64, b64ToBytes, deriveBits, encryptJson, decryptJson, importAesKey, packFromJson, packToJson, randomBytes } from "./crypto.js";
import { sanitizePayload } from "./model.js";
import { planSync } from "./merge.js";

export const SYNC_ITERATIONS = 210_000;

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

export async function makeLoginProof(password, email, iterations = SYNC_ITERATIONS) {
  const bits = await deriveBits(password, new TextEncoder().encode(`still-login-v1:${email}`), iterations);
  return bytesToB64(bits);
}

export async function makeWrapKey(password, email, wrapSalt, iterations = SYNC_ITERATIONS) {
  const salt = wrapSalt instanceof Uint8Array ? wrapSalt : b64ToBytes(wrapSalt);
  const material = new TextEncoder().encode(`still-wrap-v1:${email}:${bytesToB64(salt)}`);
  const bits = await deriveBits(password, material, iterations);
  return importAesKey(bits);
}

export async function createSyncKey() {
  const raw = randomBytes(32);
  return { syncKeyB64: bytesToB64(raw), key: await importAesKey(raw) };
}

export async function openSyncKey(syncKeyB64) {
  return importAesKey(b64ToBytes(syncKeyB64));
}

export async function wrapSyncKey(wrapKey, syncKeyB64) {
  return packToJson(await encryptJson(wrapKey, { k: syncKeyB64 }));
}

export async function unwrapSyncKey(wrapKey, packed) {
  const opened = await decryptJson(wrapKey, packFromJson(packed));
  if (!opened || typeof opened.k !== "string") throw new Error("Wrapped key was empty");
  return opened.k;
}

export async function sealForAccount(syncKey, payload) {
  return packToJson(await encryptJson(syncKey, sanitizePayload(payload)));
}

export async function openFromAccount(syncKey, blob) {
  if (!blob) return null;
  const packed = packFromJson(blob);
  if (!packed) throw new Error("Remote list is unreadable");
  return sanitizePayload(await decryptJson(syncKey, packed));
}

export function createSyncClient(baseUrl, fetchImpl = globalThis.fetch) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  async function send(path, { method = "GET", token, body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      const wrapped = new Error("The account server could not be reached.");
      wrapped.cause = error;
      wrapped.status = 0;
      throw wrapped;
    }
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!response.ok) {
      const error = new Error(json?.error || "The account server refused that request.");
      error.status = response.status;
      error.body = json;
      throw error;
    }
    return json;
  }
  return {
    register: (email, loginProof) => send("/v1/register", { method: "POST", body: { email, loginProof } }),
    login: (email, loginProof) => send("/v1/login", { method: "POST", body: { email, loginProof } }),
    logout: (token) => send("/v1/logout", { method: "POST", token }),
    pull: (token) => send("/v1/vault", { token }),
    push: (token, body) => send("/v1/vault", { method: "PUT", token, body }),
  };
}

/**
 * Link this device to an account. The password is used to build a login proof and to unwrap
 * the sync key. It is not returned and is not written into the vault.
 * Local tasks are left untouched when the server cannot be read or the password cannot unwrap.
 */
export async function connectAccount({ url, email, password, mode, local, iterations = SYNC_ITERATIONS, fetchImpl }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, message: "Enter the email address for the account." };
  if (!password || String(password).length < 8) {
    return { ok: false, message: "Use a password of at least 8 characters. The PIN stays separate." };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: "Enter the server address, starting with https://." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, message: "Enter the server address, starting with https://." };
  }
  const client = createSyncClient(parsed.origin + parsed.pathname.replace(/\/$/, ""), fetchImpl);
  const proof = await makeLoginProof(password, normalized, iterations);
  let auth;
  try {
    auth = mode === "register" ? await client.register(normalized, proof) : await client.login(normalized, proof);
  } catch (error) {
    if (error.status === 401) return { ok: false, message: "That email or password didn’t match. Nothing on this device was changed." };
    if (error.status === 409) return { ok: false, message: "That email already has an account. Sign in instead. Nothing on this device was changed." };
    return { ok: false, message: "The account server could not be reached. Nothing on this device was changed." };
  }
  const mismatched = Boolean(local?.accountEmail) && local.accountEmail !== normalized;
  try {
    return await finishLink({
      client,
      token: auth.token,
      password,
      email: normalized,
      wrapSalt: auth.wrapSalt,
      local,
      iterations,
      mismatched,
      url: parsed.origin + parsed.pathname.replace(/\/$/, ""),
    });
  } catch {
    try {
      await client.logout(auth.token);
    } catch {
      /* the session can expire on its own */
    }
    return { ok: false, message: "The account list could not be opened. Nothing on this device was changed." };
  }
}

async function finishLink({ client, token, password, email, wrapSalt, local, iterations, mismatched, url }) {
  const remoteRecord = await client.pull(token);
  let syncKeyB64 = "";
  let syncKey = null;
  let wrapped = null;
  if (remoteRecord.wrappedSyncKey) {
    const wrapKey = await makeWrapKey(password, email, remoteRecord.wrapSalt || wrapSalt, iterations);
    syncKeyB64 = await unwrapSyncKey(wrapKey, remoteRecord.wrappedSyncKey);
    syncKey = await openSyncKey(syncKeyB64);
  } else {
    const created = await createSyncKey();
    syncKeyB64 = created.syncKeyB64;
    syncKey = created.key;
    wrapped = await wrapSyncKey(await makeWrapKey(password, email, remoteRecord.wrapSalt || wrapSalt, iterations), syncKeyB64);
  }
  let remote = null;
  if (remoteRecord.blob) {
    remote = await openFromAccount(syncKey, remoteRecord.blob);
  }
  if (mismatched && (remote?.tasks?.length || local?.tasks?.length)) {
    return {
      ok: true,
      held: true,
      session: { url, email, token, wrapSalt: remoteRecord.wrapSalt || wrapSalt },
      syncKeyB64,
      remote,
      remoteRevision: remoteRecord.revision || 0,
      message: "This phone’s list belongs to a different account. Nothing was copied either way.",
    };
  }
  const outcome = await pushPlan({
    client,
    token,
    syncKey,
    syncKeyB64,
    local: { ...local, accountEmail: email, syncKeyB64 },
    remote,
    baseRevision: 0,
    remoteRevision: remoteRecord.revision || 0,
    dirty: true,
    wrapped,
  });
  return {
    ok: true,
    held: false,
    session: { url, email, token, wrapSalt: remoteRecord.wrapSalt || wrapSalt, revision: outcome.revision },
    syncKeyB64,
    payload: outcome.payload,
    message: outcome.message,
  };
}

export async function pushPlan({ client, token, syncKey, syncKeyB64, local, remote, baseRevision, remoteRevision, dirty, wrapped }) {
  const plan = planSync({ local, remote, baseRevision, remoteRevision, dirty });
  if (plan.action === "none") {
    return { payload: { ...local, syncKeyB64 }, revision: remoteRevision, message: "Already up to date.", changed: false };
  }
  if (plan.action === "adopt") {
    return {
      payload: { ...plan.payload, accountEmail: local.accountEmail, syncKeyB64 },
      revision: remoteRevision,
      message: "Brought the account’s list onto this device.",
      changed: true,
    };
  }
  const payload = { ...plan.payload, accountEmail: local.accountEmail || payloadAccount(local), syncKeyB64 };
  const blob = await sealForAccount(syncKey, payload);
  try {
    const saved = await client.push(token, { baseRevision: plan.baseRevision, blob, wrappedSyncKey: wrapped || undefined });
    return {
      payload,
      revision: saved.revision,
      changed: true,
      message: plan.reason === "merged" ? "Merged both lists and saved the result." : "Saved this device’s list to the account.",
    };
  } catch (error) {
    if (error.status !== 409 || !error.body) throw error;
    const againRemote = error.body.blob ? await openFromAccount(syncKey, error.body.blob) : { tasks: [], tombstones: [], settings: {} };
    const merged = planSync({
      local: payload,
      remote: againRemote,
      baseRevision: plan.baseRevision,
      remoteRevision: error.body.revision,
      dirty: true,
    });
    const next = { ...(merged.payload || payload), accountEmail: payload.accountEmail, syncKeyB64 };
    if (merged.action === "adopt") {
      return { payload: next, revision: error.body.revision, changed: true, message: "Used the account list. This device had nothing newer." };
    }
    const saved = await client.push(token, { baseRevision: error.body.revision, blob: await sealForAccount(syncKey, next) });
    return { payload: next, revision: saved.revision, changed: true, message: "Merged both lists and saved the result." };
  }
}

function payloadAccount(local) {
  return local?.accountEmail || "";
}

export async function syncExisting({ client, token, syncKey, local, baseRevision, dirty = false }) {
  const remoteRecord = await client.pull(token);
  let remote = null;
  if (remoteRecord.blob) remote = await openFromAccount(syncKey, remoteRecord.blob);
  return pushPlan({
    client,
    token,
    syncKey,
    syncKeyB64: local.syncKeyB64,
    local,
    remote,
    baseRevision,
    remoteRevision: remoteRecord.revision || 0,
    dirty,
    wrapped: null,
  });
}
