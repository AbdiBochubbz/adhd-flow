import assert from "node:assert/strict";
import test from "node:test";
import { nativeAlarms, notificationId, widgetCopy } from "../src/native-plan.js";

test("notification ids are stable positive 32-bit numbers", () => {
  const first = notificationId("task-1:atDue");
  assert.equal(first, notificationId("task-1:atDue"));
  assert.ok(first >= 1 && first <= 2147483647);
  assert.notEqual(first, notificationId("task-1:hourBefore"));
});

test("the widget hides the title unless the user opted in", () => {
  const tasks = [{ id: "a", title: "Math homework", dueAt: Date.parse("2026-10-30T17:00:00"), completedAt: null, steps: [] }];
  const hidden = widgetCopy(tasks, { showTitlesInNotifications: false }, new Date("2026-10-27T15:00:00"));
  assert.equal(hidden.line, "A task is waiting");
  assert.equal(hidden.detail.includes("Math"), false);
  const shown = widgetCopy(tasks, { showTitlesInNotifications: true }, new Date("2026-10-27T15:00:00"));
  assert.equal(shown.line, "Math homework");
});

test("an empty list tells the widget there is nothing waiting", () => {
  const copy = widgetCopy([], { showTitlesInNotifications: true });
  assert.equal(copy.line, "Nothing is waiting");
});

test("native alarms skip past slots and keep the generic body", () => {
  const now = Date.parse("2026-10-27T15:00:00");
  const alarms = nativeAlarms(
    [
      { id: "old:atDue", at: now - 1000, shown: false, body: "A task is due now.", taskId: "a", kind: "atDue" },
      { id: "soon:atDue", at: now + 60_000, shown: false, body: "A task is due now.", taskId: "b", kind: "atDue" },
    ],
    now,
  );
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].slotId, "soon:atDue");
  assert.equal(alarms[0].body, "A task is due now.");
  assert.equal(alarms[0].title, "Still");
});
