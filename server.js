const http = require("http");
const { parse } = require("url");
const next = require("next");
const { WebSocketServer } = require("ws");
const {
  getOrCreateRoom,
  getRoomByUuid,
  broadcastChat,
  startViewerCountInterval,
} = require("./lib/room-state");
const crypto = require("crypto");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const wss = new WebSocketServer({ noServer: true });

function matchRoomWs(pathname) {
  const m = pathname.match(/^\/room\/([^/]+)\/websocket$/);
  return m ? { type: "room", id: m[1] } : null;
}
function matchRoomChatWs(pathname) {
  const m = pathname.match(/^\/room\/([^/]+)\/chat\/websocket$/);
  return m ? { type: "roomChat", id: m[1] } : null;
}
function matchRoomViewerWs(pathname) {
  const m = pathname.match(/^\/room\/([^/]+)\/viewer\/websocket$/);
  return m ? { type: "roomViewer", id: m[1] } : null;
}

function routeWs(pathname) {
  return matchRoomWs(pathname) || matchRoomChatWs(pathname) || matchRoomViewerWs(pathname);
}

function sendToPeer(room, peerId, msg) {
  const p = room.peers.get(peerId);
  if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}

function broadcastToRoomExcept(room, excludePeerId, msg) {
  room.peers.forEach((p, pid) => {
    if (pid !== excludePeerId && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify(msg));
    }
  });
}

app.prepare().then(() => {
  startViewerCountInterval();

  const server = http.createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    await handle(req, res, parsedUrl);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "");
    const r = routeWs(pathname);
    if (!r) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, r);
    });
  });

  wss.on("connection", (ws, req, r) => {
    const { type, id } = r;

    if (type === "room") {
      const room = getOrCreateRoom(id);
      const peerId = crypto.randomUUID();
      let peerName = null; // Will be set when client sends name
      let nameReceived = false;
      room.peers.set(peerId, { ws, name: peerName, isViewer: false });

      // Function to notify existing peers about new peer (called after name is received)
      const notifyNewPeer = (name) => {
        room.peers.forEach((p, pid) => {
          if (pid !== peerId && p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({ event: "new-peer", peerId, name: name, viewer: false }));
          }
        });
      };

      ws.send(
        JSON.stringify({
          event: "joined",
          peerId,
          peers: Array.from(room.peers.entries())
            .filter(([k]) => k !== peerId)
            .map(([pid, p]) => ({ id: pid, name: p.name || `Peer ${pid.slice(0, 4)}` })),
          viewer: false,
          recordingPeer: room.recordingPeer || null,
        })
      );

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const { to, event, data, name } = msg;
          
          // Handle name update - this should be the FIRST message sent
          if (event === "set-name" && typeof name === "string" && name.trim()) {
            const trimmedName = name.trim().slice(0, 30);
            const peer = room.peers.get(peerId);
            if (peer) {
              peer.name = trimmedName;
              peerName = trimmedName;
              
              // If this is the first time we're receiving the name, notify existing peers about new peer
              if (!nameReceived) {
                nameReceived = true;
                notifyNewPeer(trimmedName);
              } else {
                // Name was updated, notify all peers
                room.peers.forEach((p, pid) => {
                  if (p.ws.readyState === 1) {
                    p.ws.send(JSON.stringify({ event: "peer-name-updated", peerId, name: trimmedName }));
                  }
                });
              }
            }
            return;
          }
          
          if (to && (event === "offer" || event === "answer" || event === "candidate")) {
            sendToPeer(room, to, { event, from: peerId, data });
          }
          if (event === "recording-started") {
            const displayName = name || peerName || `Peer ${peerId.slice(0, 4)}`;
            room.recordingPeer = { peerId, name: displayName };
            broadcastToRoomExcept(room, peerId, {
              event: "recording-started",
              peerId,
              name: displayName,
            });
          }
          if (event === "recording-stopped") {
            if (room.recordingPeer && room.recordingPeer.peerId === peerId) {
              room.recordingPeer = null;
            }
            broadcastToRoomExcept(room, peerId, { event: "recording-stopped", peerId });
          }
        } catch (_) {}
      });

      ws.on("close", () => {
        room.peers.delete(peerId);
        if (room.recordingPeer && room.recordingPeer.peerId === peerId) {
          room.recordingPeer = null;
        }
        room.peers.forEach((p) => {
          if (p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({ event: "peer-left", peerId }));
          }
        });
      });
      return;
    }

    if (type === "roomChat") {
      const room = getRoomByUuid(id);
      if (!room || !room.hub) {
        ws.close();
        return;
      }
      room.hub.clients.add(ws);
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          // Handle typing and image messages
          if (msg.type === "typing" || msg.type === "image") {
            broadcastChat(room.hub, raw.toString());
          } else {
            // Regular chat message
            broadcastChat(room.hub, raw.toString());
          }
        } catch {
          // Fallback for plain text
          broadcastChat(room.hub, raw.toString());
        }
      });
      ws.on("close", () => {
        room.hub.clients.delete(ws);
      });
      return;
    }

    if (type === "roomViewer") {
      const room = getRoomByUuid(id);
      if (!room) {
        ws.close();
        return;
      }
      room.viewerSockets.add(ws);
      ws.send(String(room.peers.size));
      ws.on("close", () => {
        room.viewerSockets.delete(ws);
      });
    }
  });

  server
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, "0.0.0.0", () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
