import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { connectSupabase } from "../src/presence.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/supabase.js";

function client() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { disconnectOnEmptyChannelsAfterMs: 0 },
  });
}

function waitFor(read, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      try {
        const value = read();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - started > timeout) {
          clearInterval(timer);
          reject(new Error("timed out waiting for presence"));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 50);
  });
}

test("two clients share a hosted room without an account or task data", { timeout: 45_000 }, async () => {
  const suffix = crypto.randomUUID();
  const lobbyTopic = `still-lobby-test-${suffix}`;
  const roomPrefix = `still-room-test-${suffix}:`;
  const seen = { a: null, b: null, rooms: [], status: "" };
  const hostClient = client();
  const guestClient = client();
  const host = connectSupabase(
    {
      onStatus(status, error) {
        seen.status = `${status} ${error || ""}`.trim();
      },
      onRoom(room) {
        seen.a = room;
      },
      onRooms(rooms) {
        seen.rooms = rooms;
      },
    },
    { client: hostClient, memberId: "ana", lobbyTopic, roomPrefix },
  );
  const guest = connectSupabase(
    {
      onRoom(room) {
        seen.b = room;
      },
    },
    { client: guestClient, memberId: "bo", lobbyTopic, roomPrefix },
  );
  try {
    const created = host.create({
      name: "Afternoon study",
      public: true,
      displayName: "Ana",
      chibi: "moss",
      focusing: false,
    });
    assert.equal(created.ok, true);
    const room = await waitFor(() => (seen.a?.members?.some((member) => member.displayName === "Ana") ? seen.a : null)).catch((error) => {
      throw new Error(`${error.message} (${seen.status || "no status"})`);
    });
    assert.equal(room.name, "Afternoon study");
    assert.equal(JSON.stringify(room).includes("task"), false);

    const joined = guest.join({ code: created.code, displayName: "Bo", chibi: "ink", seat: 0 });
    assert.equal(joined.ok, true);
    const together = await waitFor(() => {
      const names = (seen.b?.members || []).map((member) => member.displayName).sort();
      return names.includes("Ana") && names.includes("Bo") ? seen.b : null;
    });
    assert.deepEqual(
      together.members.map((member) => member.chibi).sort(),
      ["ink", "moss"],
    );
    assert.equal(JSON.stringify(together).includes("task"), false);

    const moved = guest.move(4);
    assert.equal(moved.ok, true);
    await waitFor(() => seen.a?.members?.find((member) => member.displayName === "Bo" && member.seat === 4));
    guest.pose(true);
    await waitFor(() => seen.a?.members?.find((member) => member.displayName === "Bo" && member.focusing));

    await waitFor(() => seen.rooms.some((item) => item.code === created.code && item.count >= 1));

    guest.leave();
    await waitFor(() => seen.a && !seen.a.members.some((member) => member.displayName === "Bo"));
    const rejoined = guest.join({ code: created.code, displayName: "Bo", chibi: "sun", seat: 3 });
    assert.equal(rejoined.ok, true);
    await waitFor(() => seen.a?.members?.some((member) => member.displayName === "Bo" && member.chibi === "sun"));
  } finally {
    host.close();
    guest.close();
    await hostClient.removeAllChannels();
    await guestClient.removeAllChannels();
    await hostClient.realtime.disconnect();
    await guestClient.realtime.disconnect();
  }
});
