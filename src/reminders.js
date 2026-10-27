/** Reminder times. Quiet hours apply only to the day-before slot. */

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const REMINDER_LABELS = {
  dayBefore: "Day before",
  hourBefore: "1 hour before",
  atDue: "At due time",
};

/**
 * If a day-before reminder would fall between 9:30 pm and 7:00 am,
 * move it to 7:00 pm so it doesn't arrive in the middle of the night.
 * Timed "1 hour before" and "at due time" reminders stay exact.
 */
export function shiftOutOfQuietHours(ts, dueAt) {
  const date = new Date(ts);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const quiet = minutes >= 21 * 60 + 30 || minutes < 7 * 60;
  if (!quiet) return { at: ts, shifted: false };
  const shifted = new Date(date);
  if (minutes < 7 * 60) shifted.setDate(shifted.getDate() - 1);
  shifted.setHours(19, 0, 0, 0);
  if (shifted.getTime() >= dueAt - 30 * 60_000) return { at: ts, shifted: false };
  return { at: shifted.getTime(), shifted: true };
}

export function slotsForTask(task) {
  const slots = [];
  if (task.reminders?.dayBefore) {
    const raw = task.dueAt - DAY;
    const shifted = shiftOutOfQuietHours(raw, task.dueAt);
    slots.push({ kind: "dayBefore", at: shifted.at, shifted: shifted.shifted });
  }
  if (task.reminders?.hourBefore) {
    slots.push({ kind: "hourBefore", at: task.dueAt - HOUR, shifted: false });
  }
  if (task.reminders?.atDue) {
    slots.push({ kind: "atDue", at: task.dueAt, shifted: false });
  }
  const kept = [];
  for (const slot of slots) {
    if (slot.at > task.dueAt) continue;
    const clash = kept.find((other) => Math.abs(other.at - slot.at) < 2 * 60_000);
    if (clash) {
      const rank = { dayBefore: 0, hourBefore: 1, atDue: 2 };
      if (rank[slot.kind] > rank[clash.kind]) {
        kept.splice(kept.indexOf(clash), 1, slot);
      }
    } else {
      kept.push(slot);
    }
  }
  return kept;
}

export function reminderBody(kind, title) {
  if (title) {
    if (kind === "dayBefore") return `${title} is due tomorrow.`;
    if (kind === "hourBefore") return `${title} is due in about an hour.`;
    if (kind === "atDue") return `${title} is due now.`;
  }
  if (kind === "dayBefore") return "Something is due tomorrow. Open Still when you want the details.";
  if (kind === "hourBefore") return "A task is due in about an hour.";
  if (kind === "atDue") return "A task is due now.";
  if (kind === "morning") return "Good morning. Your list is ready when you are.";
  return "A school task needs you.";
}

export function nextMorningTimes(hour, count, now = Date.now()) {
  const times = [];
  for (let i = 0; i < 10 && times.length < count; i += 1) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    date.setHours(hour, 0, 0, 0);
    if (date.getTime() > now + 60_000) times.push(date.getTime());
  }
  return times;
}

export function planSchedule(tasks, settings, now = Date.now()) {
  const slots = [];
  for (const task of tasks) {
    if (task.completedAt) continue;
    for (const slot of slotsForTask(task)) {
      if (slot.at <= now) continue;
      const title = settings.showTitlesInNotifications ? task.title : null;
      slots.push({
        id: `${task.id}:${slot.kind}`,
        taskId: task.id,
        kind: slot.kind,
        at: slot.at,
        title,
        body: reminderBody(slot.kind, title),
      });
    }
  }
  const morningHour = Number.isFinite(settings.morningHour) ? settings.morningHour : 7;
  for (const at of nextMorningTimes(morningHour, 2, now)) {
    const day = new Date(at);
    slots.push({
      id: `morning:${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`,
      taskId: null,
      kind: "morning",
      at,
      title: null,
      body: reminderBody("morning", null),
    });
  }
  return slots.sort((a, b) => a.at - b.at);
}

export function catchUpGrace(kind) {
  return kind === "morning" ? 2 * HOUR : 12 * HOUR;
}
