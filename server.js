const http = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { setupSocketIO } = require("./lib/socket-handlers");

function parseRequestUrl(req) {
  const base = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/", base);
  const query = Object.fromEntries(url.searchParams.entries());
  return {
    pathname: url.pathname,
    query,
    href: url.href,
    path: `${url.pathname}${url.search}`,
    search: url.search,
  };
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = parseRequestUrl(req);
    await handle(req, res, parsedUrl);
  });

  const io = new Server(server, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true,
  });

  setupSocketIO(io);

  server.once("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`> NexusRTC ready on http://localhost:${port}`);
    console.log(`> Socket.io on /socket.io`);
  });
});
