import assert from "node:assert/strict";
import test from "node:test";
import { connectAccount, createSyncClient, createSyncKey, makeLoginProof, openSyncKey, sealForAccount, unwrapSyncKey, wrapSyncKey, makeWrapKey } from "../src/account.js";
import { importAesKey, randomBytes } from "../src/crypto.js";
import { planSync, mergePayloads } from "../src/merge.js";
import { assertCanCreate } from "../src/vault.js";
import { createAccountServer } from "../server/account.mjs";

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
    settings: { theme: "system", settingsUpdatedAt: extra.settingsUpdatedAt || 0, ...(extra.settings || {}) },
    accountEmail: extra.accountEmail || "",
    syncKeyB64: extra.syncKeyB64 || "",
  };
}

test("an existing vault header cannot be replaced by setup", () => {
  assert.throws(() => assertCanCreate({ salt: new Uint8Array(16), verifier: null, vault: null }), /already on this device/);
  assert.throws(() => assertCanCreate({ salt: new Uint8Array(16), verifier: { iv: 1 }, vault: { iv: 1 } }), /already/);
  assert.doesNotThrow(() => assertCanCreate({ salt: null, verifier: null, vault: null }));
  assert.doesNotThrow(() => assertCanCreate({ salt: new Uint8Array(16), verifier: { iv: 1 }, vault: { iv: 1 } }, true));
});

test("an empty remote list does not replace local tasks, and an empty local list does not erase remote tasks", () => {
  const local = payload([task("a", "Math homework", 10)]);
  const keep = planSync({ local, remote: payload([]), baseRevision: 1, remoteRevision: 2, dirty: true });
  assert.equal(keep.action, "push");
  assert.equal(keep.payload.tasks.length, 1);
  assert.equal(keep.payload.tasks[0].title, "Math homework");

  const adopt = planSync({ local: payload([]), remote: local, baseRevision: 0, remoteRevision: 2, dirty: false });
  assert.equal(adopt.action, "adopt");
  assert.equal(adopt.payload.tasks[0].title, "Math homework");

  const deleted = planSync({
    local: payload([], { tombstones: [{ id: "a", at: 50 }] }),
    remote: local,
    baseRevision: 1,
    remoteRevision: 2,
    dirty: true,
  });
  assert.equal(deleted.action, "push");
  assert.equal(deleted.payload.tasks.length, 0);
  assert.equal(deleted.payload.tombstones[0].id, "a");
});

test("merge keeps both tasks and the newer edit of a shared task", () => {
  const merged = mergePayloads(
    payload([task("a", "Math, revised", 20), task("b", "Essay", 5)]),
    payload([task("a", "Math", 10), task("c", "Lab", 8)]),
  );
  const titles = Object.fromEntries(merged.tasks.map((item) => [item.id, item.title]));
  assert.deepEqual(titles, { a: "Math, revised", b: "Essay", c: "Lab" });
});

test("email alone cannot read a vault, and two accounts stay apart", async () => {
  const server = await createAccountServer();
  try {
    const client = createSyncClient(server.url);
    const proof = await makeLoginProof("long-password", "ada@example.com", FAST);
    const otherProof = await makeLoginProof("other-password", "bea@example.com", FAST);
    const ada = await client.register("ada@example.com", proof);
    const key = await createSyncKey();
    const wrap = await makeWrapKey("long-password", "ada@example.com", ada.wrapSalt, FAST);
    const blob = await sealForAccount(key.key, payload([task("a", "Math homework", 1)], { syncKeyB64: key.syncKeyB64 }));
    await client.push(ada.token, { baseRevision: 0, blob, wrappedSyncKey: await wrapSyncKey(wrap, key.syncKeyB64) });

    const emailOnly = await fetch(`${server.url}/v1/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com" }),
    });
    assert.equal(emailOnly.status, 400);
    const peek = await fetch(`${server.url}/v1/vault?email=ada@example.com`);
    assert.equal(peek.status, 401);

    const bea = await client.register("bea@example.com", otherProof);
    const beaList = await client.pull(bea.token);
    assert.equal(beaList.blob, null);
    assert.notEqual(JSON.stringify(beaList), JSON.stringify(await client.pull(ada.token)));

    await client.logout(ada.token);
    await assert.rejects(() => client.pull(ada.token), (error) => error.status === 401);
  } finally {
    await server.close();
  }
});

test("two clients for one account merge offline edits and a wrong password changes nothing", async () => {
  const server = await createAccountServer();
  try {
    const local = payload([task("a", "Math homework", 10)]);
    const before = JSON.parse(JSON.stringify(local));
    const wrong = await connectAccount({
      url: server.url,
      email: "ada@example.com",
      password: "long-password",
      mode: "login",
      local,
      iterations: FAST,
    });
    assert.equal(wrong.ok, false);
    assert.deepEqual(local, before);

    const first = await connectAccount({
      url: server.url,
      email: "ada@example.com",
      password: "long-password",
      mode: "register",
      local,
      iterations: FAST,
    });
    assert.equal(first.ok, true);
    assert.equal(first.payload.tasks[0].title, "Math homework");
    assert.deepEqual(local, before);

    const phone = payload([task("b", "Essay", 12)], { accountEmail: "ada@example.com" });
    const second = await connectAccount({
      url: server.url,
      email: "ada@example.com",
      password: "long-password",
      mode: "login",
      local: phone,
      iterations: FAST,
    });
    assert.equal(second.ok, true);
    const titles = second.payload.tasks.map((item) => item.title).sort();
    assert.deepEqual(titles, ["Essay", "Math homework"]);

    const client = createSyncClient(server.url);
    const proof = await makeLoginProof("long-password", "ada@example.com", FAST);
    const again = await client.login("ada@example.com", proof);
    const stale = await openSyncKey(second.syncKeyB64);
    const staleBlob = await sealForAccount(stale, payload([task("a", "Math, old", 1)], { accountEmail: "ada@example.com", syncKeyB64: second.syncKeyB64 }));
    await assert.rejects(
      () => client.push(again.token, { baseRevision: 0, blob: staleBlob }),
      (error) => error.status === 409,
    );
    const stored = await client.pull(again.token);
    const opened = await (await import("../src/account.js")).openFromAccount(stale, stored.blob);
    assert.equal(opened.tasks.length, 2);

    const emptyPush = await fetch(`${server.url}/v1/vault`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${again.token}` },
      body: JSON.stringify({ baseRevision: stored.revision }),
    });
    assert.equal(emptyPush.status, 400);
    const stillThere = await client.pull(again.token);
    assert.equal(stillThere.blob.ct, stored.blob.ct);
  } finally {
    await server.close();
  }
});

test("a different account does not receive this device's tasks", async () => {
  const server = await createAccountServer();
  try {
    const local = payload([task("a", "Private essay", 4)], { accountEmail: "ada@example.com" });
    await connectAccount({
      url: server.url,
      email: "ada@example.com",
      password: "long-password",
      mode: "register",
      local,
      iterations: FAST,
    });
    const held = await connectAccount({
      url: server.url,
      email: "bea@example.com",
      password: "other-password",
      mode: "register",
      local,
      iterations: FAST,
    });
    assert.equal(held.ok, true);
    assert.equal(held.held, true);
    const client = createSyncClient(server.url);
    const bea = await client.login("bea@example.com", await makeLoginProof("other-password", "bea@example.com", FAST));
    const list = await client.pull(bea.token);
    assert.equal(list.blob, null);
  } finally {
    await server.close();
  }
});

test("the wrong wrap key cannot open the sync key", async () => {
  const raw = randomBytes(32);
  const syncKeyB64 = Buffer.from(raw).toString("base64");
  const wrap = await makeWrapKey("long-password", "ada@example.com", randomBytes(16), FAST);
  const packed = await wrapSyncKey(wrap, syncKeyB64);
  const wrong = await importAesKey(randomBytes(32));
  await assert.rejects(() => unwrapSyncKey(wrong, packed));
});
