import assert from "node:assert/strict";
import test from "node:test";
import { ITERATIONS } from "../src/crypto.js";
import { afterSignOut, decideBoot, mergeKeptLists, sealLegacy, unlockLegacy } from "../src/migrate.js";

const FAST = 5_000;

function task(title, id = "task-1") {
  return {
    id,
    title,
    notes: "chapter 3",
    dueAt: Date.UTC(2026, 10, 8, 17),
    allDay: false,
    createdAt: 10,
    updatedAt: 10,
    completedAt: null,
    subject: "Math",
    deferredUntil: null,
    steps: [],
    reminders: { dayBefore: true, hourBefore: true, atDue: true },
  };
}

test("a new install opens with no PIN and no vault", () => {
  const decision = decideBoot({ localList: null, legacy: "empty" });
  assert.equal(decision.screen, "app");
  assert.equal(decision.fresh, true);
});

test("a Still 1.3 vault migrates with its PIN and survives restart", async () => {
  const original = {
    tasks: [task("Math homework")],
    settings: { theme: "dark", morningHour: 7, settingsUpdatedAt: 4 },
    tombstones: [],
    accountEmail: "",
    syncKeyB64: "",
  };
  const record = await sealLegacy("2468", original, FAST);
  const before = {
    saltLength: record.salt.byteLength,
    vaultLength: record.vault.ct.byteLength,
  };
  const opened = await unlockLegacy("2468", record);
  assert.equal(opened.ok, true);
  assert.equal(opened.data.tasks[0].title, "Math homework");
  assert.equal(opened.data.tasks[0].notes, "chapter 3");
  assert.equal(opened.data.settings.theme, "dark");
  assert.equal(record.salt.byteLength, before.saltLength);
  assert.equal(record.vault.ct.byteLength, before.vaultLength);

  const saved = opened.data;
  const restart = decideBoot({ localList: saved, legacy: "empty" });
  assert.equal(restart.screen, "app");
  assert.equal(restart.data.tasks[0].title, "Math homework");
  const again = decideBoot({ localList: restart.data, legacy: "empty" });
  assert.equal(again.data.tasks[0].title, "Math homework");
});

test("a wrong PIN does not open or alter a Still 1.3 vault", async () => {
  const record = await sealLegacy("2468", { tasks: [task("Essay")], settings: { theme: "light" } }, FAST);
  const copy = record.vault.ct.slice();
  const failed = await unlockLegacy("0000", record);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "bad-pin");
  assert.equal(failed.data, undefined);
  assert.deepEqual(record.vault.ct, copy);
  const stillThere = decideBoot({ localList: null, legacy: "ready" });
  assert.equal(stillThere.screen, "migrate");
});

test("the production vault algorithm can still open a sealed list", async () => {
  const record = await sealLegacy("2468", { tasks: [task("Lab")], settings: {} }, ITERATIONS);
  const opened = await unlockLegacy("2468", record);
  assert.equal(opened.ok, true);
  assert.equal(opened.data.tasks[0].title, "Lab");
});

test("signing out and restoring keep the on-device list", () => {
  const list = { tasks: [task("Math homework")], settings: { theme: "dark" } };
  const signedOut = afterSignOut(list);
  assert.equal(signedOut.clearedList, false);
  assert.equal(signedOut.localList.tasks[0].title, "Math homework");
  const restored = mergeKeptLists(
    { tasks: [task("New task", "task-2")], settings: { theme: "light", settingsUpdatedAt: 2 } },
    { tasks: [task("Math homework")], settings: { theme: "dark", settingsUpdatedAt: 9 }, tombstones: [] },
  );
  const titles = restored.tasks.map((item) => item.title).sort();
  assert.deepEqual(titles, ["Math homework", "New task"]);
});

test("offline boot uses only the saved list", () => {
  const list = { tasks: [task("Offline essay")], settings: { theme: "system" } };
  const decision = decideBoot({ localList: list, legacy: "empty" });
  assert.equal(decision.screen, "app");
  assert.equal(decision.data.tasks[0].title, "Offline essay");
});
