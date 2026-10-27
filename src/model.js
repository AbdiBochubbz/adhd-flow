import { endOfDay, startOfDay } from "./time.js";

export const SUBJECTS = ["Math", "English", "Science", "History", "Language", "Art"];

export function defaultReminders(allDay) {
  return allDay
    ? { dayBefore: true, hourBefore: false, atDue: false }
    : { dayBefore: true, hourBefore: true, atDue: true };
}

export function defaultSettings() {
  return {
    theme: "system",
    autoLockMin: 5,
    morningHour: 7,
    showTitlesInNotifications: false,
    pomodoroMin: 25,
    breakMin: 5,
    lastSummaryDay: null,
    askedNotify: false,
    voiceNoteSeen: false,
  };
}

export function createTask({ title, notes = "", dueAt, allDay, subject = "", reminders }) {
  return {
    id: crypto.randomUUID(),
    title: title.trim().slice(0, 200),
    notes: notes.slice(0, 2000),
    dueAt,
    allDay: Boolean(allDay),
    createdAt: Date.now(),
    completedAt: null,
    subject: subject.slice(0, 40),
    deferredUntil: null,
    steps: [],
    reminders: {
      dayBefore: Boolean(reminders.dayBefore),
      hourBefore: Boolean(reminders.hourBefore),
      atDue: Boolean(reminders.atDue),
    },
  };
}

export function sanitizeTask(task) {
  if (!task || typeof task !== "object") return null;
  if (typeof task.title !== "string" || !task.title.trim()) return null;
  if (typeof task.dueAt !== "number" || !Number.isFinite(task.dueAt)) return null;
  const reminders = task.reminders || defaultReminders(Boolean(task.allDay));
  const steps = Array.isArray(task.steps)
    ? task.steps
        .slice(0, 30)
        .map((step) => ({
          id: typeof step?.id === "string" ? step.id : crypto.randomUUID(),
          title: String(step?.title || "").trim().slice(0, 160),
          done: Boolean(step?.done),
        }))
        .filter((step) => step.title)
    : [];
  return {
    id: typeof task.id === "string" && task.id ? task.id : crypto.randomUUID(),
    title: task.title.trim().slice(0, 200),
    notes: typeof task.notes === "string" ? task.notes.slice(0, 2000) : "",
    dueAt: task.dueAt,
    allDay: Boolean(task.allDay),
    createdAt: typeof task.createdAt === "number" ? task.createdAt : Date.now(),
    completedAt: typeof task.completedAt === "number" ? task.completedAt : null,
    subject: typeof task.subject === "string" ? task.subject.slice(0, 40) : "",
    deferredUntil: typeof task.deferredUntil === "number" ? task.deferredUntil : null,
    steps,
    reminders: {
      dayBefore: Boolean(reminders.dayBefore),
      hourBefore: Boolean(reminders.hourBefore),
      atDue: Boolean(reminders.atDue),
    },
  };
}

export function sanitizeSettings(raw) {
  const settings = { ...defaultSettings(), ...(raw && typeof raw === "object" ? raw : {}) };
  settings.theme = ["dark", "light", "system"].includes(settings.theme) ? settings.theme : "system";
  settings.autoLockMin = [0, 1, 5, 15].includes(Number(settings.autoLockMin)) ? Number(settings.autoLockMin) : 5;
  const hour = Number(settings.morningHour);
  settings.morningHour = hour >= 5 && hour <= 11 ? hour : 7;
  settings.pomodoroMin = [15, 25, 50].includes(Number(settings.pomodoroMin)) ? Number(settings.pomodoroMin) : 25;
  settings.breakMin = [5, 10].includes(Number(settings.breakMin)) ? Number(settings.breakMin) : 5;
  settings.showTitlesInNotifications = Boolean(settings.showTitlesInNotifications);
  settings.lastSummaryDay = typeof settings.lastSummaryDay === "string" ? settings.lastSummaryDay : null;
  settings.askedNotify = Boolean(settings.askedNotify);
  settings.voiceNoteSeen = Boolean(settings.voiceNoteSeen);
  return settings;
}

export function sanitizePayload(data) {
  const tasks = Array.isArray(data?.tasks) ? data.tasks.map(sanitizeTask).filter(Boolean).slice(0, 500) : [];
  return { v: 1, tasks, settings: sanitizeSettings(data?.settings) };
}

export function urgencyOf(dueAt, now = new Date()) {
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  const today = startOfDay(now).getTime();
  const dueDay = startOfDay(due).getTime();
  if (dueDay === today) return "today";
  const tomorrow = startOfDay(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dueDay === tomorrow.getTime()) return "tomorrow";
  return "later";
}

export function nextTask(tasks, now = Date.now()) {
  return tasks
    .filter((task) => !task.completedAt && !(task.deferredUntil && task.deferredUntil > now))
    .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt)[0] || null;
}

export function groupTasks(tasks, now = new Date()) {
  const groups = { overdue: [], today: [], tomorrow: [], later: [], done: [] };
  for (const task of tasks) {
    if (task.completedAt) {
      groups.done.push(task);
      continue;
    }
    groups[urgencyOf(task.dueAt, now)].push(task);
  }
  for (const key of ["overdue", "today", "tomorrow", "later"]) {
    groups[key].sort((a, b) => a.dueAt - b.dueAt);
  }
  groups.done.sort((a, b) => b.completedAt - a.completedAt);
  return groups;
}

export function openCount(tasks, now = new Date()) {
  const end = endOfDay(now).getTime();
  return tasks.filter((task) => !task.completedAt && task.dueAt <= end).length;
}

export function firstOpenStep(task) {
  return task.steps?.find((step) => !step.done) || null;
}

export const DONE_PHRASES = [
  "Done. That’s one less thing.",
  "Nice. You can put that down.",
  "Checked off.",
  "Good. The list is lighter.",
  "That’s finished.",
  "One thing, done.",
];
