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
      room.peers.set(peerId, { ws, isViewer: false });

      ws.send(
        JSON.stringify({
          event: "joined",
          peerId,
          peers: Array.from(room.peers.keys()).filter((k) => k !== peerId),
          viewer: false,
        })
      );
      room.peers.forEach((p, pid) => {
        if (pid !== peerId && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ event: "new-peer", peerId, viewer: false }));
        }
      });

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const { to, event, data } = msg;
          if (to && (event === "offer" || event === "answer" || event === "candidate")) {
            sendToPeer(room, to, { event, from: peerId, data });
          }
        } catch (_) {}
      });

      ws.on("close", () => {
        room.peers.delete(peerId);
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
        broadcastChat(room.hub, raw.toString());
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
