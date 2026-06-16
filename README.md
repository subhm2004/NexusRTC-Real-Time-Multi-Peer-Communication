# NexusRTC

Browser-based peer-to-peer video conferencing. Create a password-protected room, share one link, and meet with camera, chat, screen share, and recording — **no user accounts required**.

Built for small teams and quick calls (2–6 people). Signaling runs over Socket.io; media flows directly between browsers via WebRTC mesh.

---

## Table of contents

- [Stack](#stack)
- [Features](#features)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [How a room works](#how-a-room-works)
- [Architecture](#architecture)
- [API routes](#api-routes)
- [Socket.io events](#socketio-events)
- [Deploy](#deploy)
- [Security](#security)
- [Scripts](#scripts)
- [CI](#ci)
- [Limitations & roadmap](#limitations--roadmap)
- [License](#license)

---

## Stack

| Layer | Technology |
|-------|------------|
| UI | Next.js 14, React 18, TypeScript |
| Realtime | **Socket.io** (signaling + chat on `/socket.io`) |
| Media | WebRTC mesh P2P (SRTP) |
| Server | Custom Node.js (`server.js`) + in-memory room state |
| Recording | Client `MediaRecorder` → private disk storage → optional FFmpeg MP4 |
| Auth | Room password (bcrypt) + session tokens + host creator token |
| Monitoring | Optional Sentry (`NEXT_PUBLIC_SENTRY_DSN`) |

---

## Features

### Video & audio calling

- **Mesh WebRTC** — each participant connects to every other participant (best for 2–6 people).
- Camera and microphone with mute / video off controls.
- **Dynamic ICE config** — client fetches STUN/TURN from `/api/ice-config` at runtime (TURN credentials never baked into the JS bundle).
- **Participant count** badge in the room nav.
- **Video layouts** — Auto, Grid, Spotlight, Sidebar (switch from the controls dock).
- Display names set before joining; names sync across peers.

### Waiting room (host-controlled)

- **On by default** for new rooms — guests land in a lobby until the host admits them.
- Host sees a **Waiting to join** panel with guest names.
- **Admit** / **Deny** per guest, or **Admit all** in one click.
- **Lobby on / Lobby off toggle** in the nav bar (host only):
  - **Lobby on** — new guests must wait for approval.
  - **Lobby off** — guests join the call directly.
  - Turning lobby **off** while guests are queued **auto-admits** everyone waiting.
- Room-full protection — guests are rejected if `MAX_PEERS` is reached.

### Live chat

- Real-time chat over Socket.io (`chat` event), separate from signaling.
- **End-to-end encryption (E2E)** — AES-256-GCM; key derived with PBKDF2 (100k iterations) from room password + room ID. Server only stores and relays ciphertext.
- **Chat history on rejoin** — last 200 messages kept in memory per room; sent to participants when they join or are admitted.
- **Typing indicators** — see who is typing.
- **Image sharing** — paste or upload images (max **2 MB** client-side).
- Secure chat UI badge when encryption is active.

### In-call interactions

- **Screen share** — share a tab/window; state synced to all peers; retries on track replacement.
- **Hand raise** — visible indicator on participant tiles.
- **Emoji reactions** — floating reactions on video tiles during the call.
- **Recording indicator** — shows when another participant is recording the meeting.

### Meeting recording

- Client-side composite recording of the meeting grid (all visible participants in one frame).
- **Date/time overlay** burned into the video while recording.
- Upload to server via authenticated `POST /api/recordings`.
- Files stored in private `data/recordings/` (not served as static files).
- **Signed one-time download URL** (1-hour TTL) after upload.
- Optional **FFmpeg** transcode to H.264 MP4 with metadata (title, recorded-at timestamp).
- Filename format: `NexusRTC-{RoomName}-{YYYY-MM-DD_HH-mm-ss}.webm`

### Reliability & reconnect

- **Socket.io auto-reconnect** — brief disconnects recover without a full page reload.
- **ICE restart** — on `failed` / `disconnected` peer connection states, offers are re-created with `iceRestart: true`.
- Reconnecting / connection-failed UI states in the room.
- Peer connections reset cleanly on socket disconnect.

### Security & production hardening

| Feature | Details |
|---------|---------|
| **bcrypt passwords** | Room passwords hashed with bcrypt (12 rounds). Legacy SHA-256 hashes auto-migrate on successful login. |
| **Session tokens** | UUID issued on verify; required for Socket.io auth and recording upload. Expire after `SESSION_TTL_MS` (default 24h). |
| **Creator token** | Host-only token stored in browser; used to rejoin as host without re-entering password. Valid while the room exists. |
| **Rate limiting** | Sliding-window limits on room create, password verify, recording upload, and socket connect (per IP). |
| **Room TTL** | Empty idle rooms deleted after `ROOM_IDLE_TTL_MS` (default 24h). |
| **Max peers** | Configurable cap per room (`MAX_PEERS`, default 6). |
| **Recording auth** | Upload requires valid session token; download requires short-lived signed token. |
| **TURN support** | Configure via env for corporate WiFi / strict NAT. |
| **Sentry** | Optional client error reporting. |

### Rate limits (defaults)

| Action | Window | Max attempts |
|--------|--------|--------------|
| Create room | 1 hour | 10 per IP |
| Verify password | 15 minutes | 30 per IP + room |
| Recording upload | 1 hour | 10 per IP |
| Socket connect | 1 minute | 40 per IP |

### UI & UX

- Dark / light **theme toggle**.
- Polished room controls dock (round buttons, layout picker, reaction picker).
- Password gate before joining; host auto-auth via stored creator token.
- Waiting-room overlay for guests in the lobby.
- Responsive video grid with spotlight / sidebar modes.

---

## Quick start

### Prerequisites

- Node.js 20+
- npm
- FFmpeg (optional — enables MP4 conversion after recording upload)

### Run locally

```bash
npm install --legacy-peer-deps
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. **Create a room** — set a name and password.
2. **Share the room link** — guests enter the same password to join.
3. As **host**, use the lobby toggle and admit/deny guests as needed.

If you hit stale Next.js cache issues:

```bash
npm run dev:fresh
```

### Docker

```bash
docker compose up --build
```

---

## Environment variables

Copy [`.env.example`](.env.example) to `.env`.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | `production` in deploy |
| `HOSTNAME` | `0.0.0.0` | Bind address |
| `TURN_URL` | — | TURN server URL (e.g. `turn:turn.example.com:3478`) |
| `TURN_USERNAME` | — | TURN username |
| `TURN_CREDENTIAL` | — | TURN credential |
| `SESSION_TTL_MS` | `86400000` (24h) | Session token lifetime |
| `ROOM_IDLE_TTL_MS` | `86400000` (24h) | Delete empty rooms after this idle period |
| `MAX_PEERS` | `6` | Maximum participants per room |
| `MAX_RECORDING_MB` | `200` | Max recording upload size |
| `NEXT_PUBLIC_SENTRY_DSN` | — | Optional Sentry DSN for client errors |

**TURN** is strongly recommended for production — without it, calls may fail on strict corporate networks or symmetric NAT.

---

## How a room works

### Creating a room

1. Host submits room name + password via `POST /api/room/create`.
2. Server creates an in-memory room with:
   - bcrypt password hash
   - creator token (host identity)
   - waiting room **enabled** by default
   - empty peer list, waiting queue, and chat history
3. Creator token and session token are stored in the browser (`sessionStorage`).

### Joining as a guest

1. Guest opens the room link and enters the password.
2. `POST /api/room/verify` checks the password → returns a **session token**.
3. Client opens a Socket.io connection with `{ roomId, token }`.
4. If **lobby is on** and the user is not the host → guest enters the **waiting room**.
5. Host admits → guest receives `admitted` and WebRTC negotiation begins.
6. If **lobby is off** → guest joins the call immediately.

### Joining as host (return visit)

- If a **creator token** is still in the browser and the room exists, the client auto-verifies and gets a fresh session token — no password prompt.
- Host privileges (lobby toggle, admit/deny) come from the `isHost` flag on the session.

### Tokens explained

| Token | Lifetime | Purpose |
|-------|----------|---------|
| **Session token** | `SESSION_TTL_MS` (default 24h) | Socket.io auth, recording upload |
| **Creator token** | Until room is deleted | Host rejoin without password |
| **Recording download token** | 1 hour, one-time use | Secure file download |

Session tokens are checked at **socket connect time**. An active call is not interrupted mid-session if the token expires, but reconnect or page refresh will require a new verify.

---

## Architecture

```
Browser A ←—— WebRTC media (SRTP, mesh) ——→ Browser B
    │                                         │
    └———— Socket.io (/socket.io) ————————————┘
                        │
              server.js + lib/socket-handlers.js
                        │
              lib/room-state.js (in-memory Map)
                        │
              Next.js API routes (/api/*)
```

### Data flow

| Path | What travels |
|------|--------------|
| WebRTC | Audio/video/screen — **peer to peer**, never through the server |
| Socket.io `signaling` | SDP offers/answers, ICE candidates, presence, reactions, waiting room |
| Socket.io `chat` | Chat messages (plaintext or E2E ciphertext) |
| `/api/recordings` | Recording blob upload (session-authenticated) |
| `/api/ice-config` | STUN + TURN server list |

Room state (peers, waiting queue, sessions, chat history, settings) lives in a **single Node process** global Map — shared between `server.js` and Next.js API routes.

---

## API routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/room/create` | POST | Rate limit | Create room → `{ roomId, creatorToken }` |
| `/api/room/verify` | POST | Rate limit | Password or creator token → `{ sessionToken }` |
| `/api/room/[uuid]/status` | GET | — | `{ exists, roomName }` |
| `/api/ice-config` | GET | — | `{ iceServers: RTCIceServer[] }` |
| `/api/recordings` | POST | Session token | Upload recording WebM; returns download URL |
| `/api/recordings/download` | GET | One-time token | Download recording file |
| `/api/health` | GET | — | Health check for deploy probes |

### Create room body

```json
{ "roomName": "Team standup", "password": "secret1234" }
```

### Verify room body

```json
{ "roomId": "uuid", "password": "secret1234" }
```

Host rejoin:

```json
{ "roomId": "uuid", "creatorToken": "..." }
```

---

## Socket.io events

Connect with auth:

```js
io("/", { auth: { roomId: "...", token: "session-token" } })
```

### Signaling (`signaling` event)

| Event | Direction | Description |
|-------|-----------|-------------|
| `set-name` | client → server | Set display name |
| `joined` | server → client | Active in call; includes peer list, recording state, lobby setting |
| `waiting-room` | server → client | Guest queued in lobby |
| `admitted` | server → client | Host approved — join call |
| `rejected` | server → client | Host denied — disconnect |
| `room-full` | server → client | Max peers reached |
| `waiting-peer` | server → host | New guest in lobby |
| `waiting-peer-updated` | server → host | Guest updated name |
| `waiting-peer-left` | server → host | Guest left lobby |
| `admit-guest` | host → server | Admit one guest by ID |
| `admit-all-guests` | host → server | Admit everyone waiting |
| `reject-guest` | host → server | Deny guest |
| `waiting-room-toggle` | host → server | `{ enabled: boolean }` — turn lobby on/off |
| `waiting-room-updated` | server → clients | Lobby setting changed |
| `new-peer` | server → clients | Someone joined the call |
| `peer-left` | server → clients | Someone left |
| `offer` / `answer` / `candidate` | peer ↔ peer (relayed) | WebRTC negotiation |
| `hand-raise` / `hand-raised` | client ↔ peers | Hand raise state |
| `screen-share` | client ↔ peers | Screen share active/inactive |
| `reaction` | client ↔ peers | Emoji reaction on tile |
| `recording-started` / `recording-stopped` | client ↔ peers | Recording state broadcast |

### Chat (`chat` event)

| Payload type | Description |
|--------------|-------------|
| `message` | Text chat (optionally E2E encrypted envelope `{ e: 1, c: "..." }`) |
| `image` | Image data URL |
| `typing` | Typing indicator |
| `history` | Server sends stored messages on join |

### Other

| Event | Description |
|-------|-------------|
| `viewer:count` | Live participant count |

---

## Deploy

### Render

Use the included [`render.yaml`](render.yaml) blueprint. In the Render dashboard, also set:

- `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`
- `NEXT_PUBLIC_SENTRY_DSN` (optional)

Health check: `/api/health`

### Important deploy notes

- **Single instance only** — room state is in-memory. Running multiple replicas without Redis will split rooms across processes.
- **Recordings on disk** — on ephemeral hosts (e.g. Render free tier), files are lost on redeploy. For production, plan S3/R2 or persistent volume storage.
- **FFmpeg** — include in your Docker image if you want automatic MP4 conversion.

---

## Security

- Passwords hashed with **bcrypt** (12 rounds); legacy SHA-256 auto-upgrades on login.
- Session tokens expire (`SESSION_TTL_MS`); checked on socket connect and recording upload.
- Rate limits on create, verify, upload, and socket connect.
- Recordings stored outside `public/` with **signed one-time download tokens**.
- Chat E2E: server relays ciphertext only; decryption key derived from room password client-side.
- TURN credentials fetched server-side via `/api/ice-config` — not embedded in client bundle.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server (Next.js + Socket.io) |
| `npm run dev:fresh` | Delete `.next` cache, then dev |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm run lint` | ESLint |

---

## CI

GitHub Actions (`.github/workflows/ci.yml`) on push/PR to `main` / `master`:

1. `npm ci --legacy-peer-deps`
2. `npx tsc --noEmit`
3. `npm run build`

---

## Limitations & roadmap

### Current limitations

| Limitation | Detail |
|------------|--------|
| Mesh topology | CPU and upload bandwidth grow with each participant — practical cap ~6 |
| In-memory state | Rooms, sessions, and chat history lost on server restart |
| Single process | No horizontal scaling without Redis or similar |
| No TURN by default | Must configure env vars for strict NAT / corporate networks |
| E2E chat key | Requires room password in browser session; clearing storage without re-entering password breaks decryption |
| No kick / lock room | Host can deny in lobby but cannot remove active participants yet |
| Recording storage | Local disk only — not suitable for multi-instance deploy without external storage |

### Possible next steps

- Kick participant, lock room, copy link + password
- Toast notifications instead of alerts
- Auto re-verify on expired session
- PWA / installable app
- SFU (mediasoup / LiveKit) for larger calls
- Redis-backed room state for multi-instance deploy
- S3/R2 recording storage

---

## License

MIT
