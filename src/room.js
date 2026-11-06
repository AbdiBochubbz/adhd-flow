export const CHIBIS = [
  { id: "pebbles", label: "Pebbles" },
  { id: "moss", label: "Moss" },
  { id: "brick", label: "Brick" },
  { id: "mist", label: "Mist" },
  { id: "sun", label: "Sun" },
  { id: "ink", label: "Ink" },
];

export const SEAT_COUNT = 12;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MEMBER_TTL = 15_000;

export function isChibi(id) {
  return CHIBIS.some((item) => item.id === id);
}

export function makeRoomCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

export function normalizeCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .replace(/[01IO]/g, "")
    .slice(0, 6);
}

export function sanitizeName(value, max = 24) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Only a display name, a look, and a seat. Tasks are never part of this. */
export function sanitizeMember(raw) {
  const displayName = sanitizeName(raw?.displayName);
  const chibi = isChibi(raw?.chibi) ? raw.chibi : "";
  const seat = Number(raw?.seat);
  if (!displayName || !chibi) return null;
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) return null;
  return { displayName, chibi, seat, focusing: Boolean(raw?.focusing) };
}

/** One person, one seat. Leaving a desk frees it, including the desk you just left. */
export function assignSeat(members, memberId, seat) {
  const target = Number(seat);
  if (!Number.isInteger(target) || target < 0 || target >= SEAT_COUNT) {
    return { ok: false, error: "That seat is not in this room." };
  }
  const mine = (members || []).filter((member) => member.id === memberId);
  if (!mine.length) return { ok: false, error: "Join a room first." };
  const taken = (members || []).some((member) => member.id !== memberId && Number(member.seat) === target);
  if (taken) return { ok: false, error: "Someone is already in that seat." };
  const profile = sanitizeMember({ ...mine[mine.length - 1], seat: target });
  if (!profile) return { ok: false, error: "That seat is not in this room." };
  const next = (members || []).filter((member) => member.id !== memberId);
  next.push({ ...mine[mine.length - 1], id: memberId, ...profile, seen: Date.now() });
  return { ok: true, members: next, seat: target };
}

export function firstFreeSeat(members, preferred) {
  const taken = new Set((members || []).map((member) => member.seat));
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < SEAT_COUNT && !taken.has(preferred)) return preferred;
  for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
    if (!taken.has(seat)) return seat;
  }
  return null;
}

export function inviteLink(code, href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return `still://room?code=${code}`;
  }
  if ((url.protocol === "https:" || url.protocol === "http:") && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
    url.search = `?room=${code}`;
    url.hash = "";
    return url.toString();
  }
  return `still://room?code=${code}`;
}

export function roomCodeFromUrl(href) {
  try {
    const url = new URL(href, "https://still.local/");
    if (url.protocol === "still:") {
      const host = (url.hostname || url.host || "").toLowerCase();
      if (host === "room") return normalizeCode(url.searchParams.get("code"));
      return "";
    }
    return normalizeCode(url.searchParams.get("room"));
  } catch {
    return "";
  }
}

export function gcRooms(rooms, now, ttl = MEMBER_TTL) {
  const next = {};
  for (const room of Object.values(rooms || {})) {
    if (!room?.code) continue;
    const members = (room.members || []).filter((member) => member?.id && now - Number(member.seen) < ttl);
    if (!members.length) continue;
    next[room.code] = {
      code: room.code,
      name: sanitizeName(room.name, 40) || "Study room",
      public: Boolean(room.public),
      members,
    };
  }
  return next;
}

export function listPublic(rooms, now) {
  return Object.values(gcRooms(rooms, now))
    .filter((room) => room.public)
    .map((room) => ({ code: room.code, name: room.name, count: room.members.length }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}
