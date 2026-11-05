import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { firstFreeSeat, makeRoomCode, normalizeCode, sanitizeMember, sanitizeName, SEAT_COUNT } from "../src/room.js";

const port = Number(process.env.PRESENCE_PORT || 47322);
const rooms = new Map();
const sockets = new Map();

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Still room presence. Tasks are not stored here.\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  sockets.set(socket, { code: "", memberId: "" });
  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    if (message.type === "ping") return;
    if (message.type === "list") {
      send(socket, { type: "rooms", rooms: publicList() });
      return;
    }
    if (message.type === "create") {
      createRoom(socket, message);
      return;
    }
    if (message.type === "join") {
      joinRoom(socket, message);
      return;
    }
    if (message.type === "move") {
      moveSeat(socket, Number(message.seat));
      return;
    }
    if (message.type === "leave") leave(socket);
  });
  socket.on("close", () => {
    leave(socket);
    sockets.delete(socket);
  });
});

function createRoom(socket, message) {
  leave(socket);
  const profile = sanitizeMember({ displayName: message.displayName, chibi: message.chibi, seat: 0 });
  if (!profile) return fail(socket, "Add your name first.");
  let code = "";
  for (let i = 0; i < 6 && (!code || rooms.has(code)); i += 1) code = makeRoomCode();
  const room = {
    code,
    name: sanitizeName(message.name, 40) || "Study room",
    public: message.public !== false,
    members: new Map(),
  };
  const memberId = crypto.randomUUID();
  room.members.set(memberId, { id: memberId, ...profile, seat: 0 });
  rooms.set(code, room);
  sockets.get(socket).code = code;
  sockets.get(socket).memberId = memberId;
  broadcast(room);
  send(socket, { type: "rooms", rooms: publicList() });
}

function joinRoom(socket, message) {
  const code = normalizeCode(message.code);
  const room = rooms.get(code);
  if (!room || !room.members.size) return fail(socket, "No room uses that code.");
  leave(socket);
  const others = [...room.members.values()];
  const seat = firstFreeSeat(others, Number(message.seat));
  if (seat == null) return fail(socket, "Every seat is taken.");
  const profile = sanitizeMember({ displayName: message.displayName, chibi: message.chibi, seat });
  if (!profile) return fail(socket, "Add your name first.");
  const memberId = crypto.randomUUID();
  room.members.set(memberId, { id: memberId, ...profile });
  sockets.get(socket).code = code;
  sockets.get(socket).memberId = memberId;
  broadcast(room);
}

function moveSeat(socket, seat) {
  const session = sockets.get(socket);
  const room = rooms.get(session?.code);
  const member = room?.members.get(session?.memberId);
  if (!member) return fail(socket, "Join a room first.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) return fail(socket, "That seat is not in this room.");
  for (const other of room.members.values()) {
    if (other.id !== member.id && other.seat === seat) return fail(socket, "Someone is already in that seat.");
  }
  member.seat = seat;
  broadcast(room);
}

function leave(socket) {
  const session = sockets.get(socket);
  if (!session?.code) return;
  const room = rooms.get(session.code);
  room?.members.delete(session.memberId);
  const code = session.code;
  session.code = "";
  session.memberId = "";
  if (room && room.members.size === 0) rooms.delete(code);
  else if (room) broadcast(room);
  send(socket, { type: "left" });
}

function broadcast(room) {
  for (const [socket, session] of sockets) {
    if (session.code !== room.code || socket.readyState !== WebSocket.OPEN) continue;
    const you = room.members.get(session.memberId);
    socket.send(JSON.stringify({ type: "room", room: wireRoom(room), you: you ? { id: you.id, seat: you.seat } : null }));
  }
  const listed = JSON.stringify({ type: "rooms", rooms: publicList() });
  for (const [socket, session] of sockets) {
    if (session.code) continue;
    if (socket.readyState === WebSocket.OPEN) socket.send(listed);
  }
}

function wireRoom(room) {
  return {
    code: room.code,
    name: room.name,
    public: room.public,
    members: [...room.members.values()].map((member) => ({
      id: member.id,
      displayName: member.displayName,
      chibi: member.chibi,
      seat: member.seat,
    })),
  };
}

function publicList() {
  return [...rooms.values()]
    .filter((room) => room.public && room.members.size)
    .map((room) => ({ code: room.code, name: room.name, count: room.members.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function fail(socket, error) {
  send(socket, { type: "error", error });
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Still presence on ws://127.0.0.1:${port}`);
});
