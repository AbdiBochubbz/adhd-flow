const BY_CHIBI = {
  pebbles: "notebook",
  moss: "laptop",
  brick: "phone",
  mist: "books",
  sun: "books",
  ink: "laptop",
};

/** How long someone studies before a short snooze, then they wake and continue. */
export const STUDY_MS = 90_000;
export const SNOOZE_MS = 14_000;

export function studyActivity(chibi) {
  return BY_CHIBI[chibi] || "notebook";
}

/**
 * Idle time is measured from the later of sitting down and the last tap.
 * A tap wakes them. After the snooze they study again.
 */
export function studyPhase(seatedAt, lastActivity, now = Date.now(), studyMs = STUDY_MS, snoozeMs = SNOOZE_MS) {
  const sat = Number(seatedAt);
  const tap = Number(lastActivity);
  const since = Math.max(Number.isFinite(sat) ? sat : now, Number.isFinite(tap) ? tap : 0);
  const idle = Math.max(0, now - since);
  const cycle = studyMs + snoozeMs;
  return idle % cycle < studyMs ? "study" : "snooze";
}
