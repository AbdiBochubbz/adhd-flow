import assert from "node:assert/strict";
import test from "node:test";
import { planSchedule, shiftOutOfQuietHours, slotsForTask } from "../src/reminders.js";

test("a late day-before reminder moves to 7pm", () => {
  const due = new Date(2026, 9, 30, 23, 59, 0, 0).getTime();
  const shifted = shiftOutOfQuietHours(due - 86_400_000, due);
  assert.equal(shifted.shifted, true);
  assert.equal(shifted.at, new Date(2026, 9, 29, 19, 0, 0, 0).getTime());
});

test("an afternoon day-before reminder stays put", () => {
  const due = new Date(2026, 9, 30, 17, 0, 0, 0).getTime();
  const shifted = shiftOutOfQuietHours(due - 86_400_000, due);
  assert.equal(shifted.shifted, false);
  assert.equal(shifted.at, new Date(2026, 9, 29, 17, 0, 0, 0).getTime());
});

test("an early-morning day-before reminder moves to the previous evening", () => {
  const due = new Date(2026, 9, 30, 6, 0, 0, 0).getTime();
  const shifted = shiftOutOfQuietHours(due - 86_400_000, due);
  assert.equal(shifted.shifted, true);
  assert.equal(shifted.at, new Date(2026, 9, 28, 19, 0, 0, 0).getTime());
});

test("timed tasks schedule three distinct reminders", () => {
  const due = new Date(2026, 9, 30, 17, 0, 0, 0).getTime();
  const slots = slotsForTask({
    dueAt: due,
    reminders: { dayBefore: true, hourBefore: true, atDue: true },
  });
  assert.deepEqual(
    slots.map((slot) => slot.kind),
    ["dayBefore", "hourBefore", "atDue"],
  );
  assert.equal(slots[1].at, due - 3_600_000);
  assert.equal(slots[2].at, due);
});

test("the schedule omits past slots and hides titles unless asked", () => {
  const now = new Date(2026, 9, 27, 15, 0, 0, 0).getTime();
  const soon = now + 2 * 3_600_000;
  const slots = planSchedule(
    [
      {
        id: "t1",
        title: "Secret lab",
        dueAt: soon,
        completedAt: null,
        reminders: { dayBefore: true, hourBefore: true, atDue: true },
      },
    ],
    { showTitlesInNotifications: false, morningHour: 7 },
    now,
  );
  const taskSlots = slots.filter((slot) => slot.taskId === "t1");
  assert.deepEqual(
    taskSlots.map((slot) => slot.kind),
    ["hourBefore", "atDue"],
  );
  assert.equal(taskSlots[0].title, null);
  assert.match(taskSlots[0].body, /about an hour/);
  assert.equal(taskSlots[0].body.includes("Secret"), false);
  assert.ok(slots.some((slot) => slot.kind === "morning"));
});

test("opt-in notification titles are the only place a name appears", () => {
  const now = Date.parse("2026-10-27T15:00:00");
  const slots = planSchedule(
    [
      {
        id: "t1",
        title: "Secret lab",
        dueAt: now + 2 * 3_600_000,
        completedAt: null,
        reminders: { dayBefore: false, hourBefore: true, atDue: false },
      },
    ],
    { showTitlesInNotifications: true, morningHour: 7 },
    now,
  );
  const slot = slots.find((item) => item.taskId === "t1");
  assert.equal(slot.title, "Secret lab");
  assert.match(slot.body, /Secret lab/);
});
