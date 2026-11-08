import assert from "node:assert/strict";
import test from "node:test";
import { connectAccount, createFakeAuth, createMemoryVaults, openSyncKey, syncExisting, unwrapSyncKey, wrapSyncKey, makeWrapKey } from "../src/account.js";
import { randomBytes } from "../src/crypto.js";
import { afterSignOut } from "../src/migrate.js";

const FAST = 1000;

function task(id, title, updatedAt) {
  return {
    id,
    title,
    notes: "",
    dueAt: Date.UTC(2026, 10, 8, 17),
    allDay: true,
    createdAt: updatedAt,
    updatedAt,
    completedAt: null,
    subject: "",
    deferredUntil: null,
    steps: [],
    reminders: { dayBefore: true, hourBefore: false, atDue: false },
  };
}

function payload(tasks, extra = {}) {
  return {
    tasks,
    tombstones: extra.tombstones || [],
    settings: { theme: "system", settingsUpdatedAt: extra.settingsUpdatedAt || 0 },
    accountEmail: extra.accountEmail || "",
    syncKeyB64: extra.syncKeyB64 || "",
  };
}

test("signup does not upload before the email is confirmed", async () => {
  const vaults = createMemoryVaults();
  const auth = createFakeAuth(vaults);
  const local = payload([task("a", "Math homework", 1)]);
  const pending = await connectAccount({
    email: "ada@example.com",
    password: "long-password",
    mode: "register",
    local,
    iterations: FAST,
    auth,
    redirectTo: "http://127.0.0.1:47321/",
  });
  assert.equal(pending.needsConfirmation, true);
  assert.equal(vaults.rows.size, 0);
  assert.equal(local.tasks[0].title, "Math homework");
  const early = await connectAccount({
    email: "ada@example.com",
    password: "long-password",
    mode: "login",
    local,
    iterations: FAST,
    auth,
  });
  assert.equal(early.ok, false);
  assert.equal(vaults.rows.size, 0);
});

test("two confirmed clients merge offline edits and a second account cannot read them", async () => {
  const vaults = createMemoryVaults();
  const users = new Map();
  const phone = createFakeAuth(vaults, users);
  const laptop = createFakeAuth(vaults, users);
  await connectAccount({
    email: "ada@example.com",
    password: "long-password",
    mode: "register",
    local: payload([]),
    iterations: FAST,
    auth: phone,
  });
  await phone.confirm("ada@example.com");
  const first = await connectAccount({
    email: "ada@example.com",
    password: "long-password",
    mode: "login",
    local: payload([task("a", "Math homework", 10)]),
    iterations: FAST,
    auth: phone,
  });
  assert.equal(first.ok, true);
  assert.equal(first.payload.tasks[0].title, "Math homework");

  const second = await connectAccount({
    email: "ada@example.com",
    password: "long-password",
    mode: "login",
    local: payload([task("b", "Essay", 12)], { accountEmail: "ada@example.com" }),
    iterations: FAST,
    auth: laptop,
  });
  assert.equal(second.ok, true);
  assert.deepEqual(second.payload.tasks.map((item) => item.title).sort(), ["Essay", "Math homework"]);

  const offline = payload(second.payload.tasks, { accountEmail: "ada@example.com", syncKeyB64: second.syncKeyB64 });
  offline.tasks.push(task("c", "Lab", 20));
  const key = await openSyncKey(second.syncKeyB64);
  const synced = await syncExisting({
    store: laptop.storeForCurrent(),
    syncKey: key,
    local: offline,
    baseRevision: second.session.revision,
    dirty: true,
  });
  assert.equal(synced.payload.tasks.length, 3);

  const other = createFakeAuth(vaults, users);
  await connectAccount({
    email: "bea@example.com",
    password: "other-password",
    mode: "register",
    local: payload([task("a", "Private essay", 4)], { accountEmail: "ada@example.com" }),
    iterations: FAST,
    auth: other,
  });
  await other.confirm("bea@example.com");
  const held = await connectAccount({
    email: "bea@example.com",
    password: "other-password",
    mode: "login",
    local: payload([task("a", "Private essay", 4)], { accountEmail: "ada@example.com" }),
    iterations: FAST,
    auth: other,
  });
  assert.equal(held.held, true);
  const beaRow = vaults.rows.get(held.session.userId);
  assert.equal(beaRow, undefined);
  assert.equal(vaults.rows.get(first.session.userId).blob.ct.length > 16, true);
});

test("sign-out keeps the local list and a wrong wrap key fails", async () => {
  const list = payload([task("a", "Math homework", 3)]);
  const signedOut = afterSignOut(list);
  assert.equal(signedOut.clearedList, false);
  assert.equal(signedOut.localList, list);
  const wrap = await makeWrapKey("long-password", "user-1", FAST);
  const packed = await wrapSyncKey(wrap, "abc");
  const wrong = await makeWrapKey("other-password", "user-1", FAST);
  await assert.rejects(() => unwrapSyncKey(wrong, packed));
  assert.equal(list.tasks.length, 1);
});
