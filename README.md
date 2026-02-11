# NexusRTC

A modern, real-time video conferencing application built with **Next.js 14**, **React 18**, and **WebRTC** mesh peer-to-peer signaling. Experience seamless video calls, screen sharing, and chat functionality with a beautiful, responsive UI.

## ✨ Features

### 🎥 Video & Audio

- **Multi-peer Video Calls** – Connect with multiple participants simultaneously
- **Mute/Unmute Controls** – Toggle microphone and camera on/off with one click
- **Real-time Video Streaming** – Low-latency peer-to-peer video communication
- **Audio Support** – Crystal clear audio with echo cancellation
- **Video Recording** – Record the **entire meeting** (all participants in one frame, like the screen view); recordings are compressed (H.264/AAC) and saved to the server

### 💬 Chat & Communication

- **Real-time Chat** – Text messaging with instant delivery
- **Typing Indicators** – See when someone is typing
- **Emoji Support** – Express yourself with emojis
- **Image Sharing** – Share images directly in the chat
- **User Names** – Set and display custom names for all participants

### 🎨 User Experience

- **Dark/Light Theme** – Toggle between themes with persistent preference
- **Modern UI** – Beautiful, responsive design that works on all devices
- **Name Input Modal** – Set your display name before joining a room
- **Viewer Count** – See how many participants are in the room
- **Room Link Sharing** – Easy one-click copy to share rooms

### 🔧 Technical Features

- **WebRTC Mesh Topology** – Direct peer-to-peer connections for optimal performance
- **WebSocket Signaling** – Real-time signaling for connection establishment
- **STUN Servers** – NAT traversal support for better connectivity
- **Responsive Design** – Works seamlessly on desktop and mobile devices

## 🏗️ Architecture

### Frontend

- **Next.js 14** with App Router for server and client components
- **React 18** with hooks for state management
- **TypeScript** for type safety
- **CSS Variables** for theming and responsive design

### Backend

- **Custom Node.js HTTP Server** (`server.js`) that integrates Next.js and WebSocket server
- **WebSocket Server** (`ws` library) for real-time communication:
  - Room signaling (WebRTC offer/answer/ICE candidates)
  - Chat message broadcasting
  - Viewer count updates
  - Peer name synchronization

### WebRTC Implementation

- **Mesh Topology** – Each peer connects directly to every other peer
- **STUN Servers** – Google's public STUN servers for NAT traversal
- **Track Management** – Dynamic video track replacement for screen sharing
- **Connection Handling** – Robust error handling and reconnection logic

### Key Technologies

- `navigator.mediaDevices.getUserMedia()` – Camera and microphone access
- `navigator.mediaDevices.getDisplayMedia()` – Screen sharing
- `RTCPeerConnection` – WebRTC peer connections
- `RTCRtpSender.replaceTrack()` – Dynamic track replacement for screen sharing
- `MediaStream` API – Stream management

## 📋 Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm** or **yarn** package manager
- **FFmpeg** (for recording compression; optional – recordings fall back to `.webm` if unavailable)
- Modern web browser with WebRTC support (Chrome, Firefox, Safari, Edge)

## 🚀 Quick Start

### Development

```bash
# Clone the repository
git clone https://github.com/subhm2004/NexusRTC.git
cd NexusRTC

# Install dependencies
npm install --legacy-peer-deps

# Start development server
npm run dev
```

Open **http://localhost:3000** in your browser.

### Usage

1. **Create a Room** – Click "Create Room" on the landing page
2. **Set Your Name** – Enter your display name when prompted
3. **Share the Link** – Copy the room link and share it with participants
4. **Join the Room** – Participants can join by clicking the shared link
5. **Start Video Call** – Allow camera/microphone permissions when prompted
6. **Screen Share** – Click the screen share button to share your screen
7. **Record** – Click the record button to start/stop recording; recordings are saved to the server and downloaded automatically
8. **Chat** – Use the chat panel to send messages, emojis, or images

## 🏭 Production

### Build

```bash
npm run build
npm run start
```

The application will run on port 3000 (or the port specified in `PORT` environment variable).

### Environment Variables

- `PORT` – Server port (default: 3000)
- `NODE_ENV` – Environment mode (`production` or `development`)

### Recordings

Recordings capture the **full meeting view** — all participants (you + remote peers) in a single grid frame, exactly as they appear on screen. Audio from all participants is mixed. Recordings are stored in `public/recordings/` on the server, compressed with **FFmpeg** (H.264 + AAC), and auto-downloaded. Requires **FFmpeg** on the server (included in Docker image).

## 🐳 Docker

### Using Docker Compose (Recommended)

```bash
# Build and run
docker compose up --build

# Run in detached mode
docker compose up -d --build

# Stop containers
docker compose down
```

### Using Docker Directly

```bash
# Build image
docker build -t nexus-rtc .

# Run container
docker run -p 3000:3000 nexus-rtc

# Run with custom port
docker run -p 8080:3000 nexus-rtc
```

Open **http://localhost:3000** (or your configured port).

## 📁 Project Structure

```
NexusRTC/
├── server.js                 # Custom HTTP + WebSocket server
├── lib/
│   └── room-state.js        # In-memory room and chat state management
├── src/
│   ├── app/
│   │   ├── page.tsx         # Landing page
│   │   ├── layout.tsx       # Root layout with theme provider
│   │   ├── globals.css      # Global styles and theme variables
│   │   └── room/
│   │       └── [uuid]/
│   │           └── page.tsx # Room page (server component)
│   └── components/
│       ├── RoomPage.tsx     # Main room component (WebRTC, video, controls)
│       ├── Chat.tsx         # Chat component with emoji/image support
│       ├── ThemeToggle.tsx  # Dark/light theme toggle
│       └── ThemeProvider.tsx # Theme initialization
├── Dockerfile               # Docker image configuration
├── docker-compose.yml      # Docker Compose configuration
└── package.json            # Dependencies and scripts
```

## 🛠️ Available Scripts

- `npm run dev` – Start development server
- `npm run build` – Build for production
- `npm run start` – Start production server
- `npm run clean` – Remove `.next` build directory
- `npm run reinstall` – Clean reinstall of dependencies
- `npm run lint` – Run ESLint

## 🔒 Browser Permissions

The application requires the following browser permissions:

- **Camera** – For video streaming
- **Microphone** – For audio communication
- **Screen Sharing** – For screen share functionality (when requested)

## 🌐 Browser Support

- ✅ Chrome/Edge (Chromium) 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Opera 76+

## 📝 License

This project is open source and available for use.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Contact

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Built with ❤️ using Next.js, React, and WebRTC**
