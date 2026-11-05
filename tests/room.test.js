import assert from "node:assert/strict";
import test from "node:test";
import { firstFreeSeat, inviteLink, listPublic, makeRoomCode, normalizeCode, roomCodeFromUrl, sanitizeMember } from "../src/room.js";

test("room codes avoid ambiguous characters", () => {
  const code = makeRoomCode(() => 0);
  assert.equal(code, "AAAAAA");
  assert.equal(normalizeCode("ab-c1io"), "ABC");
});

test("presence keeps a name, look, and seat, and drops anything else", () => {
  const member = sanitizeMember({
    displayName: "  Ana  ",
    chibi: "moss",
    seat: 3,
    tasks: [{ title: "secret homework" }],
    notes: "do not share",
  });
  assert.deepEqual(member, { displayName: "Ana", chibi: "moss", seat: 3, focusing: false });
  assert.equal(JSON.stringify(member).includes("secret"), false);
  assert.equal(sanitizeMember({ displayName: "Ana", chibi: "komi", seat: 1 }), null);
});

test("invite links carry the room code", () => {
  assert.equal(inviteLink("AB23CD", "https://abdibochubbz.github.io/adhd-flow/"), "https://abdibochubbz.github.io/adhd-flow/?room=AB23CD");
  assert.equal(inviteLink("AB23CD", "https://localhost/"), "still://room?code=AB23CD");
  assert.equal(roomCodeFromUrl("https://example.com/app/?room=ab23cd"), "AB23CD");
  assert.equal(roomCodeFromUrl("still://room?code=ZZ99KK"), "ZZ99KK");
});

test("seats fill the first empty desk", () => {
  assert.equal(firstFreeSeat([{ seat: 0 }, { seat: 1 }], 0), 2);
  assert.equal(firstFreeSeat([{ seat: 0 }], 4), 4);
});

test("public list hides private rooms", () => {
  const now = 1_000_000;
  const rooms = {
    AB12CD: { code: "AB12CD", name: "Quiet hour", public: true, members: [{ id: "a", seen: now }] },
    ZZ99KK: { code: "ZZ99KK", name: "Private", public: false, members: [{ id: "b", seen: now }] },
  };
  assert.deepEqual(listPublic(rooms, now), [{ code: "AB12CD", name: "Quiet hour", count: 1 }]);
});
