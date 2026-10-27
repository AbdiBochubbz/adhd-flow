/** Local date helpers. All "days" are the phone's calendar, not UTC. */

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return d;
}

export function dayKey(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function toDatetimeLocal(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromDatetimeLocal(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function weekdayName(date) {
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

function monthDay(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clock(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Human due label, e.g. "Friday, Oct 30, 5:00 PM" or "Today, end of day". */
export function formatDue(ts, now = new Date()) {
  const due = new Date(ts);
  const today = startOfDay(now).getTime();
  const dueDay = startOfDay(due).getTime();
  const diff = Math.round((dueDay - today) / 86_400_000);
  let day;
  if (diff === 0) day = "Today";
  else if (diff === 1) day = "Tomorrow";
  else if (diff === -1) day = "Yesterday";
  else if (diff > 1 && diff < 7) day = weekdayName(due);
  else day = `${weekdayName(due)}, ${monthDay(due)}`;

  const allDay = due.getHours() === 23 && due.getMinutes() === 59;
  if (allDay) return `${day}, end of day`;
  if (diff >= 7 || diff < -1) return `${weekdayName(due)}, ${monthDay(due)}, ${clock(due)}`;
  return `${day}, ${clock(due)}`;
}

export function formatDistance(ts, now = Date.now()) {
  const ms = ts - now;
  const past = ms < 0;
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 1) return past ? "just now" : "due now";
  if (minutes < 60) {
    const word = minutes === 1 ? "minute" : "minutes";
    return past ? `${minutes} ${word} overdue` : `due in ${minutes} ${word}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 36) {
    const word = hours === 1 ? "hour" : "hours";
    return past ? `${hours} ${word} overdue` : `due in ${hours} ${word}`;
  }
  const days = Math.round(hours / 24);
  const word = days === 1 ? "day" : "days";
  return past ? `${days} ${word} overdue` : `due in ${days} ${word}`;
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatShortDay(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
