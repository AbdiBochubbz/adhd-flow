import {
  assignSeat,
  firstFreeSeat,
  gcRooms,
  listPublic,
  makeRoomCode,
  membersFromPresence,
  normalizeCode,
  presencePayload,
  publicRoomsFromPresence,
  resolveSeat,
  roomMetaFromPresence,
  sanitizeMember,
  sanitizeName,
} from "./room.js";
import { supabase } from "./supabase.js";

export const LOBBY_TOPIC = "still-lobby";
export const ROOM_TOPIC_PREFIX = "still-room:";

const STORE_KEY = "still-rooms-v1";
const CHANNEL = "still-rooms-v1";

/** Blank uses hosted Supabase presence. "local" stays on this device. A ws/wss address is optional. */
export function presenceTarget(url) {
  const value = String(url || "").trim();
  if (value === "local") return "local";
  if (/^wss?:\/\//i.test(value)) return value;
  return "hosted";
}

export function connectPresence(url, handlers, options) {
  const target = url === "local" || url === "hosted" || /^wss?:\/\//i.test(String(url || "")) ? url : presenceTarget(url);
  if (target === "local") return connectLocal(handlers);
  if (target === "hosted") return connectSupabase(handlers, options);
  return connectSocket(target, handlers);
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

export function connectSupabase(handlers, options = {}) {
  const client = options.client || supabase;
  const memberId = options.memberId || localMemberId();
  const lobbyTopic = options.lobbyTopic || LOBBY_TOPIC;
  const roomPrefix = options.roomPrefix || ROOM_TOPIC_PREFIX;
  let closed = false;
  let generation = 0;
  let current = null;
  let roomChannel = null;
  let lastMembers = [];
  const lobby = client.channel(lobbyTopic, {
    config: { presence: { key: memberId }, private: false },
  });

  const emitRoom = () => {
    if (!current) {
      handlers.onRoom?.(null, null);
      return;
    }
    handlers.onRoom?.(
      {
        code: current.code,
        name: current.name,
        public: current.public,
        members: lastMembers.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          chibi: member.chibi,
          seat: member.seat,
          focusing: member.focusing,
        })),
      },
      { id: memberId, seat: current.seat },
    );
  };

  const publishLobby = () => {
    if (closed || !current?.public) {
      lobby.untrack();
      return;
    }
    lobby.track({
      code: current.code,
      name: current.name,
      public: true,
    });
  };

  const publishRoom = () => {
    if (!roomChannel || !current) return;
    const payload = presencePayload({
      displayName: current.displayName,
      chibi: current.chibi,
      seat: current.seat,
      focusing: current.focusing,
      roomName: current.name,
      public: current.public,
      host: current.host,
    });
    if (!payload) return;
    roomChannel.track(payload);
  };

  const syncRoom = () => {
    if (!roomChannel || !current) return;
    const state = roomChannel.presenceState();
    const meta = roomMetaFromPresence(state);
    if (meta && !current.host) {
      if (meta.name && meta.name !== current.name) current.name = meta.name;
      if (meta.public !== current.public) current.public = meta.public;
    }
    let members = membersFromPresence(state);
    const seat = resolveSeat(members, memberId);
    if (seat != null && seat !== current.seat) {
      current.seat = seat;
      publishRoom();
      members = members.map((member) => (member.id === memberId ? { ...member, seat } : member));
    }
    lastMembers = members;
    emitRoom();
    publishLobby();
  };

  const closeRoom = async () => {
    generation += 1;
    const channel = roomChannel;
    roomChannel = null;
    current = null;
    lastMembers = [];
    if (channel) {
      await channel.untrack();
      await client.removeChannel(channel);
    }
    lobby.untrack();
  };

  const openRoom = (input, { host }) => {
    const code = host ? freshCode() : normalizeCode(input.code);
    if (!host && code.length !== 6) return { ok: false, error: "Enter the room code." };
    const seat = host ? 0 : firstFreeSeat([], Number(input.seat));
    const payload = presencePayload({
      displayName: input.displayName,
      chibi: input.chibi,
      seat: seat ?? 0,
      focusing: input.focusing,
      roomName: input.name,
      public: host ? input.public !== false : false,
      host,
    });
    if (!payload) return { ok: false, error: "Add your name first." };
    if (seat == null) return { ok: false, error: "Every seat is taken." };
    const gen = generation + 1;
    generation = gen;
    const previous = roomChannel;
    roomChannel = null;
    current = {
      code,
      name: payload.roomName,
      public: payload.public,
      displayName: payload.displayName,
      chibi: payload.chibi,
      seat: payload.seat,
      focusing: payload.focusing,
      host,
    };
    lastMembers = [];
    if (previous) {
      previous.untrack();
      client.removeChannel(previous);
    }
    const channel = client.channel(`${roomPrefix}${code}`, {
      config: { presence: { key: memberId }, private: false },
    });
    roomChannel = channel;
    channel.on("presence", { event: "sync" }, () => {
      if (gen !== generation || roomChannel !== channel) return;
      syncRoom();
    });
    channel.subscribe((status) => {
      if (gen !== generation || roomChannel !== channel) return;
      if (status === "SUBSCRIBED") {
        handlers.onStatus?.("live", "");
        publishRoom();
        syncRoom();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        handlers.onStatus?.("error", "Study rooms could not connect.");
      }
    });
    return { ok: true, code };
  };

  lobby.on("presence", { event: "sync" }, () => {
    if (closed) return;
    handlers.onRooms?.(publicRoomsFromPresence(lobby.presenceState()));
  });
  lobby.subscribe((status) => {
    if (closed) return;
    if (status === "SUBSCRIBED") {
      handlers.onStatus?.("live", "");
      publishLobby();
      handlers.onRooms?.(publicRoomsFromPresence(lobby.presenceState()));
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      handlers.onStatus?.("error", "Study rooms could not connect.");
    }
  });

  return {
    key: "hosted",
    mode: "hosted",
    list() {
      handlers.onRooms?.(publicRoomsFromPresence(lobby.presenceState()));
    },
    create(input) {
      return openRoom(input, { host: true });
    },
    join(input) {
      return openRoom(input, { host: false });
    },
    move(seat) {
      if (!current || !roomChannel) return { ok: false, error: "Join a room first." };
      const moved = assignSeat(lastMembers, memberId, seat);
      if (!moved.ok) return moved;
      current.seat = moved.seat;
      publishRoom();
      return { ok: true };
    },
    pose(focusing) {
      if (!current) return;
      current.focusing = Boolean(focusing);
      publishRoom();
    },
    leave() {
      closeRoom();
      handlers.onRoom?.(null, null);
    },
    close() {
      closed = true;
      closeRoom();
      client.removeChannel(lobby);
    },
  };
}

function freshCode() {
  let code = "";
  for (let i = 0; i < 5; i += 1) code = makeRoomCode();
  return code;
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
