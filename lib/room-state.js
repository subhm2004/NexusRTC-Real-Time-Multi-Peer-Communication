const crypto = require("crypto");

/** Shared in-memory store across server.js and Next.js API routes (single Node process). */
const GLOBAL_KEY = "__NexusRTC_room_state__";

function getStore() {
  if (!global[GLOBAL_KEY]) {
    global[GLOBAL_KEY] = {
      rooms: new Map(),
      streams: new Map(),
      viewerIntervalStarted: false,
    };
  }
  return global[GLOBAL_KEY];
}

function rooms() {
  return getStore().rooms;
}

function streams() {
  return getStore().streams;
}

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function hashPassword(password) {
  return sha256(`nexus-room:${password}`);
}

function createRoom(uuid, password, roomName) {
  const r = rooms();
  const s = streams();
  if (r.has(uuid)) {
    return null;
  }
  const suuid = sha256(uuid);
  const creatorToken = crypto.randomUUID();
  const room = {
    peers: new Map(),
    hub: { clients: new Set() },
    viewerSockets: new Set(),
    roomName: typeof roomName === "string" ? roomName.trim().slice(0, 50) : "Meeting",
    passwordHash: hashPassword(password),
    creatorToken,
    sessions: new Set(),
    recordingPeer: null,
  };
  r.set(uuid, room);
  s.set(suuid, uuid);
  return { creatorToken };
}

function getRoomByUuid(uuid) {
  return rooms().get(uuid) || null;
}

/** @deprecated Use createRoom + getRoomByUuid. */
function getOrCreateRoom(uuid) {
  const r = rooms();
  if (r.has(uuid)) {
    const suuid = sha256(uuid);
    const s = streams();
    if (!s.has(suuid)) s.set(suuid, uuid);
    return r.get(uuid);
  }
  return null;
}

function getStreamBySuuid(suuid) {
  const uuid = streams().get(suuid);
  return uuid ? rooms().get(uuid) || null : null;
}

function getRoomForStream(suuid) {
  return getStreamBySuuid(suuid);
}

function verifyPassword(uuid, password) {
  const room = rooms().get(uuid);
  if (!room || !room.passwordHash) return false;
  return room.passwordHash === hashPassword(password);
}

function verifyCreatorToken(uuid, creatorToken) {
  const room = rooms().get(uuid);
  if (!room || !creatorToken) return false;
  return room.creatorToken === creatorToken;
}

function createSession(uuid) {
  const room = rooms().get(uuid);
  if (!room) return null;
  const token = crypto.randomUUID();
  room.sessions.add(token);
  return token;
}

function validateSession(uuid, sessionToken) {
  const room = rooms().get(uuid);
  if (!room || !sessionToken) return false;
  return room.sessions.has(sessionToken);
}

function revokeSession(uuid, sessionToken) {
  const room = rooms().get(uuid);
  if (room && sessionToken) room.sessions.delete(sessionToken);
}

function broadcastChat(hub, message, excludeWs = null) {
  hub.clients.forEach((ws) => {
    if (ws === excludeWs) return;
    if (ws.readyState === 1) ws.send(message);
  });
}

function startViewerCountInterval() {
  const store = getStore();
  if (store.viewerIntervalStarted) return;
  store.viewerIntervalStarted = true;

  setInterval(() => {
    rooms().forEach((room) => {
      const count = String(room.peers.size);
      room.viewerSockets.forEach((ws) => {
        if (ws.readyState === 1) ws.send(count);
      });
    });
  }, 1000);
}

module.exports = {
  createRoom,
  getOrCreateRoom,
  getRoomByUuid,
  getStreamBySuuid,
  getRoomForStream,
  verifyPassword,
  verifyCreatorToken,
  createSession,
  validateSession,
  revokeSession,
  broadcastChat,
  startViewerCountInterval,
  get rooms() {
    return rooms();
  },
  get streams() {
    return streams();
  },
};
