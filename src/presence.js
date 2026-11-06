import { assignSeat, firstFreeSeat, gcRooms, listPublic, makeRoomCode, normalizeCode, sanitizeMember, sanitizeName } from "./room.js";

const STORE_KEY = "still-rooms-v1";
const CHANNEL = "still-rooms-v1";

export function connectPresence(url, handlers) {
  if (!url || url === "local") return connectLocal(handlers);
  return connectSocket(url, handlers);
}

function connectLocal(handlers) {
  const memberId = localMemberId();
  let closed = false;
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  const publish = () => {
    if (closed) return;
    const rooms = readRooms();
    handlers.onStatus?.("live", "");
    handlers.onRooms?.(listPublic(rooms, Date.now()));
    const mine = findMembership(rooms, memberId);
    if (mine) handlers.onRoom?.(publicRoom(mine.room), { id: memberId, seat: mine.member.seat });
  };
  const onMessage = () => publish();
  channel?.addEventListener("message", onMessage);
  window.addEventListener("storage", onMessage);
  const timer = setInterval(() => {
    touch(memberId);
    publish();
  }, 4000);
  publish();
  return {
    key: "local",
    mode: "local",
    list() {
      publish();
    },
    create(input) {
      const result = createLocal(memberId, input);
      broadcast(channel);
      publish();
      return result;
    },
    join(input) {
      const result = joinLocal(memberId, input);
      broadcast(channel);
      publish();
      return result;
    },
    move(seat) {
      const result = moveLocal(memberId, seat);
      broadcast(channel);
      publish();
      return result;
    },
    pose(focusing) {
      poseLocal(memberId, focusing);
      broadcast(channel);
      publish();
    },
    leave() {
      leaveLocal(memberId);
      broadcast(channel);
      publish();
    },
    close() {
      closed = true;
      clearInterval(timer);
      channel?.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onMessage);
      channel?.close();
    },
  };
}

function connectSocket(url, handlers) {
  let socket;
  let closed = false;
  let opened = false;
  const queue = [];
  const send = (message) => {
    const text = JSON.stringify(message);
    if (opened && socket?.readyState === WebSocket.OPEN) socket.send(text);
    else queue.push(text);
  };
  const connect = () => {
    if (closed) return;
    handlers.onStatus?.("connecting", "");
    try {
      socket = new WebSocket(url);
    } catch {
      handlers.onStatus?.("error", "That room server address could not be opened.");
      return;
    }
    socket.addEventListener("open", () => {
      opened = true;
      handlers.onStatus?.("live", "");
      while (queue.length && socket.readyState === WebSocket.OPEN) socket.send(queue.shift());
      send({ type: "list" });
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "rooms") handlers.onRooms?.(message.rooms || []);
      if (message.type === "room") handlers.onRoom?.(message.room, message.you);
      if (message.type === "left") handlers.onRoom?.(null, null);
      if (message.type === "error") handlers.onStatus?.("live", message.error || "The room could not do that.");
    });
    socket.addEventListener("close", () => {
      opened = false;
      if (!closed) handlers.onStatus?.("error", "The room server disconnected.");
    });
    socket.addEventListener("error", () => {
      if (!closed) handlers.onStatus?.("error", "The room server could not be reached.");
    });
  };
  connect();
  const ping = setInterval(() => send({ type: "ping" }), 8000);
  return {
    key: url,
    mode: "server",
    list() {
      send({ type: "list" });
    },
    create(input) {
      send({ type: "create", ...presenceBody(input) });
      return { ok: true };
    },
    join(input) {
      send({ type: "join", code: normalizeCode(input.code), ...presenceBody(input) });
      return { ok: true };
    },
    move(seat) {
      send({ type: "move", seat });
      return { ok: true };
    },
    pose(focusing) {
      send({ type: "focus", focusing: Boolean(focusing) });
    },
    leave() {
      send({ type: "leave" });
    },
    close() {
      closed = true;
      clearInterval(ping);
      socket?.close();
    },
  };
}

function presenceBody(input) {
  return {
    displayName: input.displayName,
    chibi: input.chibi,
    seat: input.seat,
    focusing: Boolean(input.focusing),
    name: input.name,
    public: input.public,
  };
}

function localMemberId() {
  const key = "still-room-member";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `local-${Math.random().toString(36).slice(2)}`;
  }
}

function readRooms() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return gcRooms(parsed.rooms || {}, Date.now());
  } catch {
    return {};
  }
}

function writeRooms(rooms) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ rooms: gcRooms(rooms, Date.now()) }));
}

function broadcast(channel) {
  try {
    channel?.postMessage({ type: "rooms" });
  } catch {
    /* another tab will notice on its timer */
  }
}

function findMembership(rooms, memberId) {
  for (const room of Object.values(rooms)) {
    const member = room.members.find((item) => item.id === memberId);
    if (member) return { room, member };
  }
  return null;
}

function publicRoom(room) {
  return {
    code: room.code,
    name: room.name,
    public: room.public,
    members: room.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      chibi: member.chibi,
      seat: member.seat,
      focusing: Boolean(member.focusing),
    })),
  };
}

function createLocal(memberId, input) {
  const profile = sanitizeMember({ displayName: input.displayName, chibi: input.chibi, seat: 0, focusing: input.focusing });
  if (!profile) return { ok: false, error: "Add your name first." };
  const rooms = readRooms();
  leaveId(rooms, memberId);
  let code = "";
  for (let i = 0; i < 5 && (!code || rooms[code]); i += 1) code = makeRoomCode();
  const seat = 0;
  rooms[code] = {
    code,
    name: sanitizeName(input.name, 40) || "Study room",
    public: input.public !== false,
    members: [{ id: memberId, ...profile, seat, seen: Date.now() }],
  };
  writeRooms(rooms);
  return { ok: true, code };
}

function joinLocal(memberId, input) {
  const code = normalizeCode(input.code);
  const rooms = readRooms();
  const room = rooms[code];
  if (!room) return { ok: false, error: "No room uses that code." };
  const others = room.members.filter((member) => member.id !== memberId);
  const seat = firstFreeSeat(others, Number(input.seat));
  if (seat == null) return { ok: false, error: "Every seat is taken." };
  const profile = sanitizeMember({ displayName: input.displayName, chibi: input.chibi, seat, focusing: input.focusing });
  if (!profile) return { ok: false, error: "Add your name first." };
  leaveId(rooms, memberId);
  rooms[code].members.push({ id: memberId, ...profile, seen: Date.now() });
  writeRooms(rooms);
  return { ok: true, code };
}

function poseLocal(memberId, focusing) {
  const rooms = readRooms();
  const found = findMembership(rooms, memberId);
  if (!found) return;
  found.member.focusing = Boolean(focusing);
  found.member.seen = Date.now();
  writeRooms(rooms);
}

function moveLocal(memberId, seat) {
  const rooms = readRooms();
  const found = findMembership(rooms, memberId);
  if (!found) return { ok: false, error: "Join a room first." };
  const moved = assignSeat(found.room.members, memberId, seat);
  if (!moved.ok) return moved;
  found.room.members = moved.members;
  writeRooms(rooms);
  return { ok: true };
}

function touch(memberId) {
  const rooms = readRooms();
  const found = findMembership(rooms, memberId);
  if (!found) return;
  found.member.seen = Date.now();
  writeRooms(rooms);
}

function leaveLocal(memberId) {
  const rooms = readRooms();
  leaveId(rooms, memberId);
  writeRooms(rooms);
}

function leaveId(rooms, memberId) {
  for (const room of Object.values(rooms)) {
    room.members = room.members.filter((member) => member.id !== memberId);
  }
}
