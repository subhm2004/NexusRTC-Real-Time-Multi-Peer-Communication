const crypto = require("crypto");
const roomState = require("./room-state");
const {
  getRoomByUuid,
  getSession,
  appendChatMessage,
  touchRoom,
  getMaxPeers,
} = roomState;
const { getSocketIp, rateLimiters } = require("./rate-limit");

const MAX_CHAT_PAYLOAD_BYTES = 3 * 1024 * 1024;

function sendToPeer(room, peerId, msg) {
  const p = room.peers.get(peerId);
  if (p?.socket?.connected) p.socket.emit("signaling", msg);
}

function sendToWaitingPeer(room, peerId, msg) {
  const p = room.waitingPeers.get(peerId);
  if (p?.socket?.connected) p.socket.emit("signaling", msg);
}

function broadcastExcept(room, excludePeerId, msg) {
  room.peers.forEach((p, pid) => {
    if (pid !== excludePeerId && p.socket?.connected) {
      p.socket.emit("signaling", msg);
    }
  });
}

function notifyHosts(room, msg) {
  room.peers.forEach((p) => {
    if (p.isHost && p.socket?.connected) {
      p.socket.emit("signaling", msg);
    }
  });
}

function emitViewerCount(io, roomId, room) {
  io.to(`room:${roomId}`).emit("viewer:count", room.peers.size);
}

function sendChatHistory(socket, room) {
  if (room.chatHistory?.length) {
    socket.emit("chat", { type: "history", messages: room.chatHistory.slice() });
  }
}

function buildPeerList(room, excludePeerId) {
  return Array.from(room.peers.entries())
    .filter(([k]) => k !== excludePeerId)
    .map(([pid, p]) => ({
      id: pid,
      name: p.name || `Peer ${pid.slice(0, 4)}`,
      handRaised: !!p.handRaised,
      screenSharing: !!p.screenSharing,
    }));
}

function completeActiveJoin(socket, room, peerId, io, roomId, isHost) {
  room.peers.set(peerId, {
    socket,
    id: peerId,
    name: null,
    isHost: !!isHost,
    isViewer: false,
    handRaised: false,
    screenSharing: false,
  });
  socket.peerId = peerId;

  socket.emit("signaling", {
    event: "joined",
    peerId,
    peers: buildPeerList(room, peerId),
    viewer: false,
    recordingPeer: room.recordingPeer || null,
    isHost: !!isHost,
    waitingRoomEnabled: !!room.waitingRoomEnabled,
  });

  sendChatHistory(socket, room);
  emitViewerCount(io, roomId, room);
  touchRoom(room);
}

function admitWaitingGuest(room, guestId, io, roomId) {
  const guest = room.waitingPeers.get(guestId);
  if (!guest?.socket?.connected) return false;
  if (room.peers.size >= getMaxPeers()) {
    sendToWaitingPeer(room, guestId, {
      event: "room-full",
      maxPeers: getMaxPeers(),
    });
    return false;
  }

  room.waitingPeers.delete(guestId);
  const guestSocket = guest.socket;
  guestSocket.peerId = guestId;
  room.peers.set(guestId, {
    socket: guestSocket,
    id: guestId,
    name: guest.name,
    isHost: false,
    isViewer: false,
    handRaised: false,
    screenSharing: false,
  });

  guestSocket.emit("signaling", {
    event: "admitted",
    peerId: guestId,
    peers: buildPeerList(room, guestId),
    recordingPeer: room.recordingPeer || null,
    waitingRoomEnabled: !!room.waitingRoomEnabled,
  });
  sendChatHistory(guestSocket, room);

  if (guest.name) {
    broadcastExcept(room, guestId, {
      event: "new-peer",
      peerId: guestId,
      name: guest.name,
      viewer: false,
    });
  }
  emitViewerCount(io, roomId, room);
  notifyHosts(room, { event: "waiting-peer-left", peerId: guestId });
  touchRoom(room);
  return true;
}

function broadcastWaitingRoomSetting(room) {
  const msg = { event: "waiting-room-updated", enabled: !!room.waitingRoomEnabled };
  room.peers.forEach((p) => {
    if (p.socket?.connected) p.socket.emit("signaling", msg);
  });
}

function setupSocketIO(io) {
  io.use((socket, next) => {
    const ip = getSocketIp(socket);
    const rl = rateLimiters.socketConnect.check(ip);
    if (!rl.allowed) {
      return next(new Error("Too many connection attempts"));
    }

    const roomId = socket.handshake.auth?.roomId;
    const token = socket.handshake.auth?.token;
    const session = roomId && token ? getSession(roomId, token) : null;
    if (!session) {
      return next(new Error("Unauthorized"));
    }

    const room = getRoomByUuid(roomId);
    if (!room) return next(new Error("Room not found"));

    socket.roomId = roomId;
    socket.room = room;
    socket.session = session;
    socket.isHost = !!session.isHost;
    next();
  });

  io.on("connection", (socket) => {
    const room = socket.room;
    const roomId = socket.roomId;
    const isHost = !!socket.isHost;
    const peerId = crypto.randomUUID();
    let peerName = null;
    let nameReceived = false;
    let isWaiting = false;

    socket.join(`room:${roomId}`);

    if (!isHost && room.waitingRoomEnabled) {
      if (room.peers.size >= getMaxPeers()) {
        socket.emit("signaling", { event: "room-full", maxPeers: getMaxPeers() });
        socket.disconnect(true);
        return;
      }

      isWaiting = true;
      room.waitingPeers.set(peerId, {
        socket,
        id: peerId,
        name: null,
        isHost: false,
      });
      socket.peerId = peerId;
      socket.emit("signaling", {
        event: "waiting-room",
        peerId,
        message: "Waiting for the host to let you in…",
      });
      notifyHosts(room, { event: "waiting-peer", peerId, name: null });
      touchRoom(room);
    } else {
      if (room.peers.size >= getMaxPeers()) {
        socket.emit("signaling", { event: "room-full", maxPeers: getMaxPeers() });
        socket.disconnect(true);
        return;
      }
      completeActiveJoin(socket, room, peerId, io, roomId, isHost);
    }

    const notifyNewPeer = (name) => {
      broadcastExcept(room, peerId, { event: "new-peer", peerId, name, viewer: false });
    };

    socket.on("signaling", (msg) => {
      if (!msg || typeof msg !== "object") return;
      const { to, event, data, name } = msg;

      if (event === "set-name" && typeof name === "string" && name.trim()) {
        const trimmedName = name.trim().slice(0, 30);
        const peer = isWaiting
          ? room.waitingPeers.get(peerId)
          : room.peers.get(peerId);
        if (peer) {
          peer.name = trimmedName;
          peerName = trimmedName;
          if (isWaiting) {
            notifyHosts(room, {
              event: "waiting-peer-updated",
              peerId,
              name: trimmedName,
            });
            return;
          }
          if (!nameReceived) {
            nameReceived = true;
            notifyNewPeer(trimmedName);
          } else {
            room.peers.forEach((p) => {
              if (p.socket?.connected) {
                p.socket.emit("signaling", {
                  event: "peer-name-updated",
                  peerId,
                  name: trimmedName,
                });
              }
            });
          }
        }
        return;
      }

      if (isHost && event === "admit-guest" && typeof msg.guestId === "string") {
        admitWaitingGuest(room, msg.guestId, io, roomId);
        return;
      }

      if (isHost && event === "admit-all-guests") {
        const guestIds = Array.from(room.waitingPeers.keys());
        guestIds.forEach((guestId) => admitWaitingGuest(room, guestId, io, roomId));
        return;
      }

      if (isHost && event === "waiting-room-toggle" && typeof msg.enabled === "boolean") {
        room.waitingRoomEnabled = msg.enabled;
        touchRoom(room);
        broadcastWaitingRoomSetting(room);
        if (!room.waitingRoomEnabled) {
          const guestIds = Array.from(room.waitingPeers.keys());
          guestIds.forEach((guestId) => admitWaitingGuest(room, guestId, io, roomId));
        }
        return;
      }

      if (isHost && event === "reject-guest" && typeof msg.guestId === "string") {
        const guestId = msg.guestId;
        const guest = room.waitingPeers.get(guestId);
        if (guest?.socket?.connected) {
          guest.socket.emit("signaling", { event: "rejected" });
          guest.socket.disconnect(true);
        }
        room.waitingPeers.delete(guestId);
        notifyHosts(room, { event: "waiting-peer-left", peerId: guestId });
        return;
      }

      if (isWaiting) return;

      if (to && (event === "offer" || event === "answer" || event === "candidate")) {
        sendToPeer(room, to, { event, from: peerId, data });
      }

      if (event === "hand-raise" && typeof msg.raised === "boolean") {
        const peer = room.peers.get(peerId);
        if (peer) {
          peer.handRaised = msg.raised;
          broadcastExcept(room, peerId, {
            event: "hand-raised",
            peerId,
            raised: msg.raised,
          });
        }
        return;
      }

      if (event === "screen-share" && typeof msg.active === "boolean") {
        const peer = room.peers.get(peerId);
        if (peer) peer.screenSharing = msg.active;
        broadcastExcept(room, peerId, {
          event: "screen-share",
          peerId,
          active: msg.active,
        });
        return;
      }

      if (event === "reaction" && typeof msg.emoji === "string") {
        const emoji = msg.emoji.slice(0, 8);
        broadcastExcept(room, peerId, { event: "reaction", peerId, emoji });
        return;
      }

      if (event === "recording-started") {
        const displayName = name || peerName || `Peer ${peerId.slice(0, 4)}`;
        room.recordingPeer = { peerId, name: displayName };
        broadcastExcept(room, peerId, {
          event: "recording-started",
          peerId,
          name: displayName,
        });
      }

      if (event === "recording-stopped") {
        if (room.recordingPeer?.peerId === peerId) {
          room.recordingPeer = null;
        }
        broadcastExcept(room, peerId, { event: "recording-stopped", peerId });
      }
    });

    socket.on("chat", (payload) => {
      if (!payload || typeof payload !== "object") return;

      if (payload.type === "typing") {
        socket.broadcast.to(`room:${roomId}`).emit("chat", payload);
        return;
      }

      let serialized;
      try {
        serialized = JSON.stringify(payload);
      } catch {
        return;
      }
      if (serialized.length > MAX_CHAT_PAYLOAD_BYTES) return;

      if (!isWaiting) {
        appendChatMessage(room, payload);
      }

      socket.broadcast.to(`room:${roomId}`).emit("chat", payload);
    });

    socket.on("disconnect", () => {
      if (isWaiting) {
        room.waitingPeers.delete(peerId);
        notifyHosts(room, { event: "waiting-peer-left", peerId });
        return;
      }

      room.peers.delete(peerId);
      if (room.recordingPeer?.peerId === peerId) {
        room.recordingPeer = null;
      }
      broadcastExcept(room, peerId, { event: "peer-left", peerId });
      emitViewerCount(io, roomId, room);
    });
  });

  setInterval(() => {
    roomState.rooms.forEach((room, roomId) => {
      emitViewerCount(io, roomId, room);
    });
  }, 1000);
}

module.exports = { setupSocketIO };
