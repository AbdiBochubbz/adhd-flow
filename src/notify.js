import { scheduleAll, scheduleReplace, setNotifTitles } from "./db.js";
import { catchUpGrace, planSchedule } from "./reminders.js";

let capabilities = {
  notification: typeof Notification !== "undefined",
  timestampTrigger: false,
  periodicSync: false,
  backgroundSync: false,
  serviceWorker: false,
};
let foregroundTimer = 0;
let foregroundGeneration = 0;
let chain = Promise.resolve();

export function getCapabilities() {
  return capabilities;
}

function enqueue(work) {
  chain = chain.then(work, work);
  return chain;
}

function callSW(message) {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = (value) => resolve(value);
    const timer = setTimeout(() => finish(null), 1600);
    navigator.serviceWorker.ready
      .then((registration) => {
        const target = registration.active || navigator.serviceWorker.controller;
        if (!target) {
          clearTimeout(timer);
          finish(null);
          return;
        }
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          finish(event.data);
        };
        target.postMessage(message, [channel.port2]);
      })
      .catch(() => {
        clearTimeout(timer);
        finish(null);
      });
  });
}

export async function probeCapabilities() {
  capabilities = {
    ...capabilities,
    notification: typeof Notification !== "undefined",
    serviceWorker: "serviceWorker" in navigator,
  };
  const reported = await callSW({ type: "CAPABILITIES" });
  if (reported) {
    capabilities.timestampTrigger = Boolean(reported.timestampTrigger);
    capabilities.periodicSync = Boolean(reported.periodicSync);
    capabilities.backgroundSync = Boolean(reported.backgroundSync);
    capabilities.serviceWorker = true;
  }
  return capabilities;
}

export function permissionState() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function askNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

async function showSystem(slot) {
  if (permissionState() !== "granted") return false;
  const options = {
    body: slot.body,
    tag: slot.id,
    lang: "en",
    data: { taskId: slot.taskId, kind: slot.kind },
    icon: new URL("icons/icon-192.png", document.baseURI).href,
  };
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification("Still", options);
        return true;
      }
    }
  } catch {
    /* fall through to the page Notification constructor */
  }
  try {
    new Notification("Still", options);
    return true;
  } catch {
    return false;
  }
}

async function flushDueBody({ visible, suppressMorning = false, onInApp }) {
  const slots = await scheduleAll();
  const now = Date.now();
  const due = [];
  let changed = false;
  for (const slot of slots) {
    if (slot.shown || slot.at > now) continue;
    if (now - slot.at > catchUpGrace(slot.kind)) {
      slot.shown = true;
      changed = true;
      continue;
    }
    due.push(slot);
  }
  const latest = new Map();
  for (const slot of due) {
    const key = slot.taskId || slot.id;
    const previous = latest.get(key);
    if (!previous || slot.at >= previous.at) latest.set(key, slot);
    slot.shown = true;
    changed = true;
  }
  if (changed) await scheduleReplace(slots);
  for (const slot of latest.values()) {
    if (slot.kind === "morning" && suppressMorning) continue;
    if (visible && onInApp) onInApp(slot);
    if (!visible && !slot.triggerSet) await showSystem(slot);
  }
}

function resolveHooks(getHooks) {
  return typeof getHooks === "function" ? getHooks() : getHooks;
}

export function flushDue(getHooks) {
  return enqueue(() => flushDueBody(resolveHooks(getHooks)));
}

async function armTriggers(slots) {
  const upcoming = slots.filter((slot) => !slot.shown && slot.at > Date.now()).slice(0, 24);
  if (!upcoming.length) return;
  const result = await callSW({ type: "SCHEDULE_TRIGGERS", slots: upcoming });
  if (!result?.setIds?.length) return;
  const all = await scheduleAll();
  let changed = false;
  for (const slot of all) {
    if (result.setIds.includes(slot.id) && !slot.triggerSet) {
      slot.triggerSet = true;
      changed = true;
    }
  }
  if (changed) await scheduleReplace(all);
  capabilities.timestampTrigger = true;
}

export function syncSchedule(tasks, settings, hooks) {
  return enqueue(async () => {
    if (hooks) await flushDueBody(resolveHooks(hooks));
    await setNotifTitles(Boolean(settings.showTitlesInNotifications));
    const existing = await scheduleAll();
    const previous = new Map(existing.map((slot) => [slot.id, slot]));
    const planned = planSchedule(tasks, settings).map((slot) => {
      const prior = previous.get(slot.id);
      if (prior && prior.at === slot.at) {
        return { ...slot, shown: Boolean(prior.shown), triggerSet: Boolean(prior.triggerSet) };
      }
      return { ...slot, shown: false, triggerSet: false };
    });
    planned.sort((a, b) => a.at - b.at);
    await scheduleReplace(planned);
    await armTriggers(planned);
    armForeground(hooks);
  });
}

function armForeground(hooks) {
  const token = ++foregroundGeneration;
  clearTimeout(foregroundTimer);
  if (!hooks) return;
  const schedule = async () => {
    if (token !== foregroundGeneration) return;
    await flushDue(hooks);
    if (token !== foregroundGeneration) return;
    const slots = await scheduleAll().catch(() => []);
    const now = Date.now();
    const next = slots.filter((slot) => !slot.shown && slot.at > now).sort((a, b) => a.at - b.at)[0];
    const delay = next ? Math.min(20_000, Math.max(800, next.at - now)) : 20_000;
    if (token !== foregroundGeneration) return;
    foregroundTimer = setTimeout(schedule, delay);
  };
  foregroundTimer = setTimeout(schedule, 800);
}

export function stopForeground() {
  clearTimeout(foregroundTimer);
}

export async function registerBackgroundWork() {
  if (!("serviceWorker" in navigator)) return { periodic: false, oneShot: false };
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return { periodic: false, oneShot: false };
  let periodic = false;
  let oneShot = false;
  try {
    if (registration.periodicSync && navigator.permissions?.query) {
      const perm = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (perm.state === "granted") {
        await registration.periodicSync.register("still-reminders", { minInterval: 12 * 60 * 60 * 1000 });
        periodic = true;
      }
    }
  } catch {
    periodic = false;
  }
  try {
    if ("sync" in registration) {
      await registration.sync.register("still-reminders");
      oneShot = true;
    }
  } catch {
    oneShot = false;
  }
  capabilities.periodicSync = periodic || capabilities.periodicSync;
  capabilities.backgroundSync = oneShot || capabilities.backgroundSync;
  return { periodic, oneShot };
}

export async function updateBadge(count) {
  if (!("setAppBadge" in navigator)) return;
  try {
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
  } catch {
    /* badges are optional */
  }
}

export async function showTimerDone(body) {
  if (permissionState() !== "granted") return;
  if (document.visibilityState === "visible") return;
  await showSystem({ id: "timer-done", body, taskId: null, kind: "timer" });
}
