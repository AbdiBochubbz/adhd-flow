import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { nativeAlarms, widgetCopy } from "./native-plan.js";

export const StillNative = registerPlugin("StillNative");

const CHANNEL = "still-reminders";
let nativePermission = "default";
let channelReady = false;
let listening = false;
let promptedExact = false;

export function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePermissionState() {
  return nativePermission;
}

export async function prepareNativeNotifications() {
  if (!isNative()) return nativePermission;
  try {
    if (!channelReady) {
      await LocalNotifications.createChannel({
        id: CHANNEL,
        name: "Reminders",
        description: "Due times and the morning list",
        importance: 4,
        visibility: 1,
      });
      channelReady = true;
    }
    const current = await LocalNotifications.checkPermissions();
    nativePermission = current.display === "granted" ? "granted" : current.display === "denied" ? "denied" : "default";
  } catch {
    nativePermission = "default";
  }
  return nativePermission;
}

export async function requestNativeNotifications() {
  if (!isNative()) return "unsupported";
  try {
    const result = await LocalNotifications.requestPermissions();
    nativePermission = result.display === "granted" ? "granted" : "denied";
    if (nativePermission === "granted") await prepareNativeNotifications();
    return nativePermission;
  } catch {
    nativePermission = "denied";
    return nativePermission;
  }
}

async function exactAlarmsGranted() {
  try {
    const setting = await LocalNotifications.checkExactNotificationSetting();
    return setting.exact_alarm === "granted";
  } catch {
    return false;
  }
}

export async function scheduleNativeAlarms(slots) {
  if (!isNative()) return false;
  let permission = await prepareNativeNotifications();
  if (permission !== "granted") permission = await requestNativeNotifications();
  if (permission !== "granted") return false;
  const alarms = nativeAlarms(slots);
  const exact = await exactAlarmsGranted();
  try {
    if (alarms.length) {
      await LocalNotifications.schedule({
        notifications: alarms.map((alarm) => ({
          id: alarm.id,
          title: alarm.title,
          body: alarm.body,
          channelId: CHANNEL,
          isExactNotification: exact,
          schedule: { at: new Date(alarm.at), allowWhileIdle: true },
          extra: { taskId: alarm.taskId, kind: alarm.kind, slotId: alarm.slotId },
        })),
      });
    }
    const pending = await LocalNotifications.getPending();
    const keep = new Set(alarms.map((alarm) => alarm.id));
    const stale = (pending.notifications || []).filter((item) => !keep.has(item.id));
    if (stale.length) {
      await LocalNotifications.cancel({ notifications: stale.map((item) => ({ id: item.id })) });
    }
    if (!exact && !promptedExact) {
      promptedExact = true;
      LocalNotifications.changeExactNotificationSetting().catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

export async function publishWidget(tasks, settings) {
  if (!isNative()) return;
  const copy = widgetCopy(tasks, settings);
  try {
    await StillNative.updateWidget(copy);
  } catch {
    /* the widget plugin is only in the Android shell */
  }
}

export async function clearWidget() {
  if (!isNative()) return;
  try {
    await StillNative.updateWidget({ line: "Nothing is waiting", detail: "Add a task" });
  } catch {
    /* ignore */
  }
}

export function watchNativeLinks(onUrl) {
  if (!isNative()) return;
  App.getLaunchUrl()
    .then((launch) => {
      if (launch?.url) onUrl(launch.url);
    })
    .catch(() => {});
  App.addListener("appUrlOpen", (event) => {
    if (event?.url) onUrl(event.url);
  }).catch(() => {});
  LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const taskId = event?.notification?.extra?.taskId;
    if (taskId) onUrl(`still://task?task=${encodeURIComponent(taskId)}`);
  }).catch(() => {});
}

export function nativeActionFromUrl(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = (parsed.hostname || parsed.host || "").toLowerCase();
  const path = parsed.pathname.replace(/^\/+/, "").toLowerCase();
  const action = host || path;
  const task = parsed.searchParams.get("task");
  const room = parsed.searchParams.get("code");
  if (action === "add" || action === "speak" || action === "open") return { action: action === "open" ? null : action, task: null, room: "" };
  if (action === "task" && task) return { action: null, task, room: "" };
  if (action === "room" && room) return { action: null, task: null, room };
  return null;
}

/**
 * Android speech recognizer. Resolves a stop function.
 * Falls back by calling onError("unsupported") when the plugin is missing.
 */
export function startNativeListening({ onText, onError, onEnd }) {
  if (!isNative()) {
    onError("unsupported");
    onEnd();
    return () => {};
  }
  let handle = null;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    onEnd();
  };
  StillNative.addListener("speech", (event) => {
    if (stopped) return;
    if (event?.error) {
      onError(event.error);
      finish();
      return;
    }
    if (event?.text) onText(String(event.text), Boolean(event.final));
    if (event?.final) finish();
  })
    .then((listener) => {
      handle = listener;
      if (stopped) listener.remove();
    })
    .catch(() => {
      onError("unsupported");
      finish();
    });
  StillNative.listen()
    .then((result) => {
      if (stopped) return;
      if (result?.text) onText(String(result.text), true);
      finish();
    })
    .catch((error) => {
      if (stopped) return;
      const message = String(error?.message || error || "");
      onError(message.includes("not-allowed") ? "not-allowed" : message.includes("unsupported") ? "unsupported" : "error");
      finish();
    });
  listening = true;
  return () => {
    listening = false;
    stopped = true;
    handle?.remove();
    StillNative.stop().catch(() => {});
  };
}

export function nativeListening() {
  return listening;
}
