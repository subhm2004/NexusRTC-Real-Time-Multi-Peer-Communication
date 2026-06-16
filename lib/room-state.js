const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 12;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PEERS = 6;
const MAX_CHAT_HISTORY = 200;

/** Shared in-memory store across server.js and Next.js API routes (single Node process). */
const GLOBAL_KEY = "__NexusRTC_room_state__";

function getStore() {
  if (!global[GLOBAL_KEY]) {
    global[GLOBAL_KEY] = {
      rooms: new Map(),
      cleanupStarted: false,
    };
  }
  return global[GLOBAL_KEY];
}

function rooms() {
  return getStore().rooms;
}

function getSessionTtlMs() {
  return parseInt(process.env.SESSION_TTL_MS || String(DEFAULT_SESSION_TTL_MS), 10);
}

function getRoomIdleTtlMs() {
  return parseInt(process.env.ROOM_IDLE_TTL_MS || String(DEFAULT_ROOM_IDLE_TTL_MS), 10);
}

function getMaxPeers() {
  return parseInt(process.env.MAX_PEERS || String(DEFAULT_MAX_PEERS), 10);
}

function sha256Legacy(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function hashPasswordLegacy(password) {
  return sha256Legacy(`nexus-room:${password}`);
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function createRoom(uuid, password, roomName) {
  const r = rooms();
  if (r.has(uuid)) return null;

  const now = Date.now();
  const creatorToken = crypto.randomUUID();
  const room = {
    peers: new Map(),
    waitingPeers: new Map(),
    roomName: typeof roomName === "string" ? roomName.trim().slice(0, 50) : "Meeting",
    passwordHash: await hashPassword(password),
    creatorToken,
    sessions: new Map(),
    recordingPeer: null,
    chatHistory: [],
    waitingRoomEnabled: true,
    createdAt: now,
    lastActivityAt: now,
  };
  r.set(uuid, room);
  return { creatorToken };
}

function getRoomByUuid(uuid) {
  return rooms().get(uuid) || null;
}

function touchRoom(room) {
  if (room) room.lastActivityAt = Date.now();
}

async function verifyPassword(uuid, password) {
  const room = rooms().get(uuid);
  if (!room || !room.passwordHash || !password) return false;

  if (room.passwordHash.startsWith("$2")) {
    return bcrypt.compare(password, room.passwordHash);
  }

  const legacyOk = room.passwordHash === hashPasswordLegacy(password);
  if (legacyOk) {
    room.passwordHash = await hashPassword(password);
  }
  return legacyOk;
}

function verifyCreatorToken(uuid, creatorToken) {
  const room = rooms().get(uuid);
  if (!room || !creatorToken) return false;
  return room.creatorToken === creatorToken;
}

function createSession(uuid, { isHost = false } = {}) {
  const room = rooms().get(uuid);
  if (!room) return null;

  const token = crypto.randomUUID();
  const now = Date.now();
  room.sessions.set(token, {
    createdAt: now,
    expiresAt: now + getSessionTtlMs(),
    isHost: !!isHost,
  });
  touchRoom(room);
  return token;
}

function getSession(uuid, sessionToken) {
  const room = rooms().get(uuid);
  if (!room || !sessionToken) return null;

  const session = room.sessions.get(sessionToken);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    room.sessions.delete(sessionToken);
    return null;
  }

  return session;
}

function validateSession(uuid, sessionToken) {
  return !!getSession(uuid, sessionToken);
}

function revokeSession(uuid, sessionToken) {
  const room = rooms().get(uuid);
  if (room && sessionToken) room.sessions.delete(sessionToken);
}

function appendChatMessage(room, payload) {
  if (!room || !payload || typeof payload !== "object") return false;
  if (payload.type === "typing" || payload.type === "history") return false;

  room.chatHistory.push({ ...payload, at: Date.now() });
  if (room.chatHistory.length > MAX_CHAT_HISTORY) {
    room.chatHistory.splice(0, room.chatHistory.length - MAX_CHAT_HISTORY);
  }
  touchRoom(room);
  return true;
}

function pruneExpiredSessions() {
  const now = Date.now();
  rooms().forEach((room) => {
    for (const [token, session] of room.sessions.entries()) {
      if (now > session.expiresAt) room.sessions.delete(token);
    }
  });
}

function cleanupStaleRooms() {
  const now = Date.now();
  const idleTtl = getRoomIdleTtlMs();
  for (const [uuid, room] of rooms().entries()) {
    const active = room.peers.size + room.waitingPeers.size;
    if (active === 0 && now - room.lastActivityAt > idleTtl) {
      rooms().delete(uuid);
    }
  }
}

function startMaintenanceTimers() {
  const store = getStore();
  if (store.cleanupStarted) return;
  store.cleanupStarted = true;

  setInterval(() => {
    pruneExpiredSessions();
    cleanupStaleRooms();
  }, 15 * 60 * 1000).unref?.();
}

startMaintenanceTimers();

module.exports = {
  createRoom,
  getRoomByUuid,
  verifyPassword,
  verifyCreatorToken,
  createSession,
  getSession,
  validateSession,
  revokeSession,
  appendChatMessage,
  touchRoom,
  getMaxPeers,
  get rooms() {
    return rooms();
  },
};
