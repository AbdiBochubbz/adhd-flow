import { defaultReminders } from "./model.js";
import { parseTask } from "./parse.js";
import { endOfDay, formatDue } from "./time.js";

export function freshComposer() {
  return {
    text: "",
    dueOverride: null,
    allDayOverride: null,
    reminders: null,
    subjectOverride: null,
  };
}

export function draftFrom(composer, now = new Date()) {
  const text = composer.text.trim();
  const parsed = text ? parseTask(text, now) : null;
  const dueAt = composer.dueOverride ?? parsed?.dueAt ?? endOfDay(now).getTime();
  let allDay;
  if (composer.allDayOverride != null) allDay = composer.allDayOverride;
  else if (composer.dueOverride != null) allDay = false;
  else allDay = parsed ? parsed.allDay : true;
  const subject = composer.subjectOverride != null ? composer.subjectOverride : parsed?.subject || "";
  const reminders = composer.reminders || defaultReminders(allDay);
  return {
    title: parsed?.title || "",
    dueAt,
    allDay,
    subject,
    reminders,
    inferred: parsed ? parsed.inferred : true,
    empty: !text,
  };
}

export function previewCopy(draft) {
  const when = formatDue(draft.dueAt)
    .replace(/^Today/, "today")
    .replace(/^Tomorrow/, "tomorrow")
    .replace(/^Yesterday/, "yesterday");
  if (draft.empty) return `Due ${when}, unless you say otherwise.`;
  if (draft.inferred) return `No time in that sentence, so it's due ${when}.`;
  return `Due ${when}.`;
}
