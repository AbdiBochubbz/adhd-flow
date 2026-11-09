import assert from "node:assert/strict";
import test from "node:test";
import {
  assignSeat,
  firstFreeSeat,
  inviteLink,
  listPublic,
  makeRoomCode,
  membersFromPresence,
  normalizeCode,
  presencePayload,
  publicRoomsFromPresence,
  resolveSeat,
  roomCodeFromUrl,
  sanitizeMember,
} from "../src/room.js";

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

test("invite links carry the room code on the website", () => {
  assert.equal(inviteLink("AB23CD"), "https://abdibochubbz.github.io/adhd-flow/?room=AB23CD");
  assert.equal(inviteLink("ab-23cd"), "https://abdibochubbz.github.io/adhd-flow/?room=AB23CD");
  assert.equal(roomCodeFromUrl("https://abdibochubbz.github.io/adhd-flow/?room=ab23cd"), "AB23CD");
  assert.equal(roomCodeFromUrl("https://localhost/?room=AB23CD"), "AB23CD");
  assert.equal(roomCodeFromUrl("still://room?code=ZZ99KK"), "ZZ99KK");
});

test("leaving a desk frees it so you can sit there again", () => {
  const start = [{ id: "ana", displayName: "Ana", chibi: "pebbles", seat: 0, seen: 1 }];
  const atB = assignSeat(start, "ana", 4);
  assert.equal(atB.ok, true);
  assert.equal(atB.members.length, 1);
  assert.equal(atB.members[0].seat, 4);
  const back = assignSeat(atB.members, "ana", 0);
  assert.equal(back.ok, true);
  assert.equal(back.members.length, 1);
  assert.equal(back.members[0].seat, 0);
});

test("seats fill the first empty desk", () => {
  assert.equal(firstFreeSeat([{ seat: 0 }, { seat: 1 }], 0), 2);
  assert.equal(firstFreeSeat([{ seat: 0 }], 4), 4);
});

test("presence payloads keep a name, look, and seat, and drop tasks", () => {
  const payload = presencePayload({
    displayName: "Ana",
    chibi: "moss",
    seat: 2,
    focusing: true,
    roomName: "Afternoon",
    public: true,
    host: true,
    tasks: [{ title: "secret homework" }],
  });
  assert.equal(JSON.stringify(payload).includes("secret"), false);
  assert.equal(JSON.stringify(payload).includes("tasks"), false);
  assert.deepEqual(Object.keys(payload).sort(), ["chibi", "displayName", "focusing", "host", "public", "roomName", "seat"]);
});

test("presence state becomes members and a public list", () => {
  const state = {
    ana: [{ displayName: "Ana", chibi: "moss", seat: 0, focusing: false, roomName: "Quiet", public: true, host: true, tasks: [{ title: "nope" }] }],
    bo: [{ displayName: "Bo", chibi: "ink", seat: 0, focusing: true, roomName: "Quiet", public: true }],
  };
  const members = membersFromPresence(state);
  assert.deepEqual(members.map((member) => member.displayName), ["Ana", "Bo"]);
  assert.equal(JSON.stringify(members).includes("nope"), false);
  assert.equal(resolveSeat(members, "bo"), 1);
  assert.equal(resolveSeat(members, "ana"), 0);
  const listed = publicRoomsFromPresence({
    ana: [{ code: "AB23CD", name: "Quiet", public: true }],
    bo: [{ code: "AB23CD", name: "Quiet", public: true }],
    cy: [{ code: "ZZ99KK", name: "Hidden", public: false }],
  });
  assert.deepEqual(listed, [{ code: "AB23CD", name: "Quiet", count: 2 }]);
});

test("public list hides private rooms", () => {
  const now = 1_000_000;
  const rooms = {
    AB12CD: { code: "AB12CD", name: "Quiet hour", public: true, members: [{ id: "a", seen: now }] },
    ZZ99KK: { code: "ZZ99KK", name: "Private", public: false, members: [{ id: "b", seen: now }] },
  };
  assert.deepEqual(listPublic(rooms, now), [{ code: "AB12CD", name: "Quiet hour", count: 1 }]);
});
