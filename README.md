# NexusRTC

A WebRTC video chat app built with **Next.js 14**, **React**, and **mesh** peer-to-peer signaling.

## Features

- **Create Room** – Generate a room and share the room link
- **Room** – Publish your camera/mic and see other publishers (mesh: each peer connects to each other)
- **Chat** – Per-room text chat over WebSockets
- **Viewer count** – Live count of peers in the room

## Architecture

- **Next.js** (App Router) for pages and API routes
- **Custom Node server** (`server.js`) that runs both Next.js and a **WebSocket** server for:
  - Room signaling (offer/answer/ICE)
  - Chat (broadcast per room)
  - Viewer count (periodic broadcast)
- **WebRTC mesh** – All media is peer-to-peer in the browser; the server only relays signaling. No TURN/STUN beyond a public STUN server.

## Prerequisites

- **Node.js 18+**
- **npm** or **yarn**

## Run

```bash
cd NexusRTC
npm install --legacy-peer-deps
npm run dev
```

Open **http://localhost:3000**.

- **Create Room** → you get `/room/{uuid}` and can copy the **room link** to share with others

## Production

```bash
npm run build
npm run start
```

## Docker

```bash
# Build and run
docker compose up --build

# Or with docker directly
docker build -t nexus-rtc .
docker run -p 3000:3000 nexus-rtc
```

Open **http://localhost:3000**.


## Project layout

- `server.js` – Custom HTTP + WebSocket server, wires Next and WS routes
- `lib/room-state.js` – In-memory rooms, chat hubs (shared by server and API)
- `src/app/` – App Router: welcome, `/room/create`, `/room/[uuid]`
- `src/components/` – `RoomPage`, `Chat` (client components with WebRTC and WS)
