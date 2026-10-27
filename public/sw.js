/* Still service worker.
   The build replaces __CACHE__ and __PRECACHE__.
   Keep the IndexedDB schema in sync with src/db.js.
   Task titles are not in this database unless the user opted in. */

const CACHE_NAME = "__CACHE__";
const PRECACHE = __PRECACHE__;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://www.google.com https://*.google.com https://*.googleapis.com wss://www.google.com wss://*.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirstNavigation(request) {
  const indexUrl = new URL("index.html", self.registration.scope).href;
  try {
    const fresh = await fetch(request);
    const secured = withSecurityHeaders(fresh);
    const cache = await caches.open(CACHE_NAME);
    await cache.put(indexUrl, secured.clone());
    return secured;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(indexUrl)) || (await cache.match(request)) || offlineResponse();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function offlineResponse() {
  return new Response("Still is saved on this phone, but this copy isn't cached yet. Open it once while online.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function iconUrl() {
  return new URL("icons/icon-192.png", self.registration.scope).href;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("still", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("schedule")) db.createObjectStore("schedule", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function allSlots(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction("schedule", "readonly").objectStore("schedule").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function replaceSlots(db, slots) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("schedule", "readwrite");
    const store = tx.objectStore("schedule");
    store.clear();
    for (const slot of slots) store.put(slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function showSlot(slot) {
  await self.registration.showNotification("Still", {
    body: slot.body || "A school task needs you.",
    tag: slot.id,
    lang: "en",
    data: { taskId: slot.taskId || null, kind: slot.kind || "" },
    icon: iconUrl(),
    badge: iconUrl(),
  });
}

async function runScheduleCheck() {
  const db = await openDB();
  try {
    const slots = await allSlots(db);
    const now = Date.now();
    const pending = [];
    let changed = false;
    for (const slot of slots) {
      if (slot.shown || slot.at > now) continue;
      const grace = slot.kind === "morning" ? 2 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
      if (now - slot.at > grace) {
        slot.shown = true;
        changed = true;
        continue;
      }
      pending.push(slot);
    }
    const latest = new Map();
    for (const slot of pending) {
      const key = slot.taskId || slot.id;
      const previous = latest.get(key);
      if (!previous || slot.at >= previous.at) latest.set(key, slot);
      slot.shown = true;
      changed = true;
    }
    for (const slot of latest.values()) {
      if (!slot.triggerSet) await showSlot(slot);
    }
    if (changed) await replaceSlots(db, slots);
  } finally {
    db.close();
  }
}

async function scheduleTriggers(slots) {
  const supported = typeof TimestampTrigger !== "undefined";
  const setIds = [];
  if (!supported) return { supported: false, setIds };
  for (const slot of slots) {
    if (!slot || slot.at <= Date.now()) continue;
    try {
      await self.registration.showNotification("Still", {
        body: slot.body || "A school task needs you.",
        tag: slot.id,
        lang: "en",
        showTrigger: new TimestampTrigger(slot.at),
        data: { taskId: slot.taskId || null, kind: slot.kind || "" },
        icon: iconUrl(),
        badge: iconUrl(),
      });
      setIds.push(slot.id);
    } catch {
      /* The constructor can exist while scheduling is still blocked. */
    }
  }
  return { supported: true, setIds };
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "still-reminders") event.waitUntil(runScheduleCheck());
});

self.addEventListener("sync", (event) => {
  if (event.tag === "still-reminders") event.waitUntil(runScheduleCheck());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "CAPABILITIES") {
    event.ports[0]?.postMessage({
      timestampTrigger: typeof TimestampTrigger !== "undefined",
      periodicSync: "periodicSync" in self.registration,
      backgroundSync: "sync" in self.registration,
    });
    return;
  }
  if (data.type === "SCHEDULE_TRIGGERS") {
    event.waitUntil(
      scheduleTriggers(data.slots || []).then((result) => {
        event.ports[0]?.postMessage(result);
      }),
    );
    return;
  }
  if (data.type === "SHOW_NOW" && data.slot) {
    event.waitUntil(showSlot(data.slot));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const taskId = event.notification.data?.taskId || "";
  const url = new URL("./", self.registration.scope);
  if (taskId) url.searchParams.set("task", taskId);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (!client.url.startsWith(self.registration.scope)) continue;
        client.postMessage({ type: "OPEN_TASK", taskId });
        return client.focus();
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
