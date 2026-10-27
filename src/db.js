/**
 * IndexedDB schema (keep in sync with public/sw.js):
 *   database "still", version 1
 *   store "kv"        — out-of-line keys (salt, verifier, vault, …)
 *   store "schedule"  — keyPath "id", reminder times only
 * Task titles are not stored here unless the user opts in to named notifications.
 */

const DB_NAME = "still";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("schedule")) db.createObjectStore("schedule", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function kvGet(key) {
  const db = await openDB();
  try {
    return await requestToPromise(db.transaction("kv", "readonly").objectStore("kv").get(key));
  } finally {
    db.close();
  }
}

export async function kvSet(key, value) {
  const db = await openDB();
  try {
    await requestToPromise(db.transaction("kv", "readwrite").objectStore("kv").put(value, key));
  } finally {
    db.close();
  }
}

/** Atomic replace of the vault header. A crash mid-write cannot mix old salt with new ciphertext. */
export async function commitVault({ salt, iterations, verifier, vault }) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      const store = tx.objectStore("kv");
      store.put(salt, "salt");
      store.put(iterations, "iterations");
      store.put(verifier, "verifier");
      store.put(vault, "vault");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Vault write aborted"));
    });
  } finally {
    db.close();
  }
}

export async function readVaultRecord() {
  const db = await openDB();
  try {
    const store = db.transaction("kv", "readonly").objectStore("kv");
    const [salt, iterations, verifier, vault, fails, notifTitles] = await Promise.all(
      ["salt", "iterations", "verifier", "vault", "fails", "notifTitles"].map((key) => requestToPromise(store.get(key))),
    );
    return { salt, iterations, verifier, vault, fails, notifTitles };
  } finally {
    db.close();
  }
}

export async function setFails(fails) {
  await kvSet("fails", fails);
}

export async function setNotifTitles(enabled) {
  await kvSet("notifTitles", Boolean(enabled));
}

export async function scheduleAll() {
  const db = await openDB();
  try {
    const rows = await requestToPromise(db.transaction("schedule", "readonly").objectStore("schedule").getAll());
    return rows || [];
  } finally {
    db.close();
  }
}

export async function scheduleReplace(slots) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("schedule", "readwrite");
      const store = tx.objectStore("schedule");
      store.clear();
      for (const slot of slots) store.put(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Schedule write aborted"));
    });
  } finally {
    db.close();
  }
}

export async function clearStores() {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["kv", "schedule"], "readwrite");
      tx.objectStore("kv").clear();
      tx.objectStore("schedule").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Clear aborted"));
    });
  } finally {
    db.close();
  }
}

export function deleteDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
