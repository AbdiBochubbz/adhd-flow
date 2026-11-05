import { nextTask } from "./model.js";
import { formatDue } from "./time.js";

/** Stable positive 32-bit id. Android notification ids are Java ints. */
export function notificationId(slotId) {
  let hash = 2166136261;
  const text = String(slotId);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 2147483646) + 1;
}

export function widgetCopy(tasks, settings, now = new Date()) {
  const next = nextTask(tasks || [], now.getTime());
  if (!next) return { line: "Nothing is waiting", detail: "Add a task" };
  const due = formatDue(next.dueAt, now);
  if (settings?.showTitlesInNotifications) return { line: next.title, detail: due };
  return { line: "A task is waiting", detail: due };
}

/** Future reminder slots the Android app can hand to the alarm manager. */
export function nativeAlarms(slots, now = Date.now()) {
  return (slots || [])
    .filter((slot) => slot && !slot.shown && slot.at > now)
    .slice(0, 48)
    .map((slot) => ({
      id: notificationId(slot.id),
      slotId: slot.id,
      title: "Still",
      body: slot.body || "A school task needs you.",
      at: slot.at,
      taskId: slot.taskId || "",
      kind: slot.kind || "",
    }));
}
