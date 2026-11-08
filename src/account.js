import { bytesToB64, b64ToBytes, deriveBits, encryptJson, decryptJson, importAesKey, packFromJson, packToJson, randomBytes } from "./crypto.js";
import { sanitizePayload } from "./model.js";
import { planSync } from "./merge.js";

export const SYNC_ITERATIONS = 210_000;

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

export async function makeWrapKey(password, userId, iterations = SYNC_ITERATIONS) {
  const bits = await deriveBits(password, new TextEncoder().encode(`still-wrap-v1:${userId}`), iterations);
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

function httpError(status, message, body) {
  const error = new Error(message);
  error.status = status;
  error.body = body;
  return error;
}

/** In-memory stand-in for the Supabase table rules: one row per user, no empty ciphertext, no cross-user reads. */
export function createMemoryVaults() {
  const rows = new Map();
  return {
    rows,
    forUser(userId) {
      return {
        async pull() {
          const row = rows.get(userId) || null;
          if (!row) return { revision: 0, blob: null, wrappedSyncKey: null };
          return { revision: row.revision, blob: row.blob, wrappedSyncKey: row.wrappedSyncKey };
        },
        async push({ baseRevision, blob, wrappedSyncKey }) {
          if (!blob?.iv || !blob?.ct || blob.ct.length < 17) throw httpError(400, "empty ciphertext");
          const current = rows.get(userId) || null;
          if (!current) {
            if (baseRevision !== 0) throw httpError(409, "revision conflict", { revision: 0, blob: null, wrappedSyncKey: null });
            if (!wrappedSyncKey?.iv || !wrappedSyncKey?.ct) throw httpError(400, "wrapped key required");
            rows.set(userId, { revision: 0, blob, wrappedSyncKey });
            return { revision: 0 };
          }
          if (current.revision !== baseRevision) {
            throw httpError(409, "revision conflict", { revision: current.revision, blob: current.blob, wrappedSyncKey: current.wrappedSyncKey });
          }
          current.revision += 1;
          current.blob = blob;
          return { revision: current.revision };
        },
      };
    },
  };
}

export function createFakeAuth(vaults, users = new Map()) {
  let current = null;
  return {
    async signUp({ email }) {
      const normalized = normalizeEmail(email);
      if (users.has(normalized)) return { data: { session: null, user: null }, error: { message: "already registered", status: 409 } };
      const user = { id: `user-${users.size + 1}`, email: normalized, email_confirmed_at: null };
      users.set(normalized, user);
      return { data: { session: null, user }, error: null };
    },
    async confirm(email) {
      const user = users.get(normalizeEmail(email));
      if (user) user.email_confirmed_at = new Date().toISOString();
    },
    async signInWithPassword({ email }) {
      const user = users.get(normalizeEmail(email));
      if (!user) return { data: { session: null, user: null }, error: { message: "Invalid login credentials", status: 401 } };
      if (!user.email_confirmed_at) return { data: { session: null, user }, error: { message: "Email not confirmed", status: 401 } };
      current = user;
      return { data: { session: { user }, user }, error: null };
    },
    async getUser() {
      return { data: { user: current }, error: current ? null : { message: "signed out" } };
    },
    async signOut() {
      current = null;
    },
    storeForCurrent() {
      if (!current) throw httpError(401, "signed out");
      return vaults.forUser(current.id);
    },
  };
}

export async function connectAccount({ email, password, mode, local, iterations = SYNC_ITERATIONS, auth, store, redirectTo }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, message: "Enter the email address for the account." };
  if (!password || String(password).length < 8) {
    return { ok: false, message: "Use a password of at least 8 characters." };
  }
  if (mode === "register") {
    const { data, error } = await auth.signUp({
      email: normalized,
      password,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      const taken = error.status === 409 || /already/i.test(error.message || "");
      return {
        ok: false,
        message: taken
          ? "That email already has an account. Sign in instead. Nothing on this device was changed."
          : "The account could not be created. Nothing on this device was changed.",
      };
    }
    if (!data?.session) {
      return {
        ok: true,
        needsConfirmation: true,
        message: "Check that email and confirm it before the list can sync. Nothing was uploaded.",
      };
    }
  } else {
    const { data, error } = await auth.signInWithPassword({ email: normalized, password });
    if (error || !data?.session) {
      const unconfirmed = /confirm/i.test(error?.message || "");
      return {
        ok: false,
        needsConfirmation: unconfirmed,
        message: unconfirmed
          ? "That email is not confirmed yet. Nothing was uploaded."
          : "That email or password did not match. Nothing on this device was changed.",
      };
    }
  }
  const { data: userData } = await auth.getUser();
  const user = userData?.user;
  if (!user?.id || !user.email_confirmed_at) {
    return { ok: true, needsConfirmation: true, message: "Confirm that email before the list can sync. Nothing was uploaded." };
  }
  const vaultStore = store || auth.storeForCurrent();
  const mismatched = Boolean(local?.accountEmail) && local.accountEmail !== normalized;
  try {
    return await finishLink({ store: vaultStore, password, email: normalized, userId: user.id, local, iterations, mismatched });
  } catch {
    return { ok: false, message: "The account list could not be opened. Nothing on this device was changed." };
  }
}

async function finishLink({ store, password, email, userId, local, iterations, mismatched }) {
  const remoteRecord = await store.pull();
  let syncKeyB64 = "";
  let syncKey = null;
  let wrapped = null;
  const wrapKey = await makeWrapKey(password, userId, iterations);
  if (remoteRecord.wrappedSyncKey) {
    syncKeyB64 = await unwrapSyncKey(wrapKey, remoteRecord.wrappedSyncKey);
    syncKey = await openSyncKey(syncKeyB64);
  } else {
    const created = await createSyncKey();
    syncKeyB64 = created.syncKeyB64;
    syncKey = created.key;
    wrapped = await wrapSyncKey(wrapKey, syncKeyB64);
  }
  let remote = null;
  if (remoteRecord.blob) remote = await openFromAccount(syncKey, remoteRecord.blob);
  const session = { email, userId, revision: remoteRecord.revision || 0 };
  if (mismatched && ((remote?.tasks?.length || 0) > 0 || (local?.tasks?.length || 0) > 0)) {
    return {
      ok: true,
      held: true,
      session,
      store,
      syncKeyB64,
      remote,
      remoteRevision: remoteRecord.revision || 0,
      message: "This device’s list belongs to a different account. Nothing was copied either way.",
    };
  }
  const outcome = await pushPlan({
    store,
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
    session: { ...session, revision: outcome.revision },
    syncKeyB64,
    payload: outcome.payload,
    message: outcome.message,
  };
}

export async function pushPlan({ store, syncKey, syncKeyB64, local, remote, baseRevision, remoteRevision, dirty, wrapped }) {
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
  const payload = { ...plan.payload, accountEmail: local.accountEmail || "", syncKeyB64 };
  const blob = await sealForAccount(syncKey, payload);
  if (!blob.ct || blob.ct.length < 17) throw httpError(400, "empty ciphertext");
  try {
    const saved = await store.push({ baseRevision: plan.baseRevision, blob, wrappedSyncKey: wrapped || null });
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
    const saved = await store.push({ baseRevision: error.body.revision, blob: await sealForAccount(syncKey, next) });
    return { payload: next, revision: saved.revision, changed: true, message: "Merged both lists and saved the result." };
  }
}

export async function syncExisting({ store, syncKey, local, baseRevision, dirty = false }) {
  const remoteRecord = await store.pull();
  let remote = null;
  if (remoteRecord.blob) remote = await openFromAccount(syncKey, remoteRecord.blob);
  return pushPlan({
    store,
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
