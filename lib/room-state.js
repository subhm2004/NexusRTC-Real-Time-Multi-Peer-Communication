const crypto = require("crypto");

const rooms = new Map();
const streams = new Map();

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function getOrCreateRoom(uuid) {
  if (rooms.has(uuid)) {
    const suuid = sha256(uuid);
    if (!streams.has(suuid)) streams.set(suuid, uuid);
    return rooms.get(uuid);
  }
  const suuid = sha256(uuid);
  const room = {
    peers: new Map(), // peerId -> { ws, name, isViewer }
    hub: { clients: new Set() },
    viewerSockets: new Set(),
  };
  rooms.set(uuid, room);
  streams.set(suuid, uuid);
  return room;
}

function getRoomByUuid(uuid) {
  return rooms.get(uuid) || null;
}

function getStreamBySuuid(suuid) {
  const uuid = streams.get(suuid);
  return uuid ? rooms.get(uuid) || null : null;
}

function getRoomForStream(suuid) {
  return getStreamBySuuid(suuid);
}

function broadcastChat(hub, message) {
  hub.clients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(message);
  });
}

function startViewerCountInterval() {
  setInterval(() => {
    rooms.forEach((room) => {
      const count = String(room.peers.size);
      room.viewerSockets.forEach((ws) => {
        if (ws.readyState === 1) ws.send(count);
      });
    });
  }, 1000);
}

module.exports = {
  getOrCreateRoom,
  getRoomByUuid,
  getStreamBySuuid,
  getRoomForStream,
  broadcastChat,
  startViewerCountInterval,
  streams,
  rooms,
};
