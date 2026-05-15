"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getStoredCreatorToken,
  getStoredSessionToken,
  setStoredSessionToken,
  wsUrlWithToken,
} from "@/lib/room-auth";
import { Chat } from "./Chat";
import { RoomControlsDock, type VideoLayoutMode } from "./room/RoomControlsDock";
import { ThemeToggle } from "./ThemeToggle";

const VIDEO_LAYOUT_KEY = "nexus-video-layout";

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    
    // Always set srcObject when stream changes
    el.srcObject = stream;
    
    // Try to play
    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.error("Video play error:", err);
      });
    }
    
    // Handle track additions
    const handleAddTrack = () => {
      if (el && el.srcObject === stream) {
        el.play().catch(() => {});
      }
    };
    
    // Handle track removals
    const handleRemoveTrack = () => {
      // If stream has no video tracks, might need to handle this
      if (stream.getVideoTracks().length === 0 && stream.getAudioTracks().length === 0) {
        el.srcObject = null;
      }
    };
    
    stream.addEventListener('addtrack', handleAddTrack);
    stream.addEventListener('removetrack', handleRemoveTrack);
    
    return () => {
      stream.removeEventListener('addtrack', handleAddTrack);
      stream.removeEventListener('removetrack', handleRemoveTrack);
      if (el) {
        el.srcObject = null;
      }
    };
  }, [stream]);
  
  return <video ref={ref} autoPlay playsInline muted={false} />;
}

function CopyLinkButton({ roomLink, copy }: { roomLink: string; copy: (t: string) => void }) {
  const [copied, setCopied] = useState(false);
  const handleClick = () => {
    copy(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      className={"btn btn-copy btn-sm" + (copied ? " copied" : "")}
      onClick={handleClick}
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function getWsBase() {
  if (typeof window === "undefined") return "";
  return (window.location.protocol === "https:" ? "wss:" : "ws:") + "//" + window.location.host;
}

const CHAT_NAME_KEY = "nexus-chat-name";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

type ParticipantInfo = { id: string; stream: MediaStream; label: string };

async function createMeetingCompositeStream(
  getParticipants: () => ParticipantInfo[]
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d")!;

  const videoEls = new Map<string, HTMLVideoElement>();
  const audioCtx = new AudioContext();
  const audioDest = audioCtx.createMediaStreamDestination();
  const audioSources = new Map<string, MediaStreamAudioSourceNode>();

  function syncParticipants(current: ParticipantInfo[]) {
    const currentIds = new Set(current.map((p) => p.id));
    for (const id of Array.from(videoEls.keys())) {
      if (!currentIds.has(id)) {
        const v = videoEls.get(id)!;
        v.srcObject = null;
        videoEls.delete(id);
        const src = audioSources.get(id);
        if (src) {
          src.disconnect();
          audioSources.delete(id);
        }
      }
    }
    for (const p of current) {
      if (!videoEls.has(p.id)) {
        const v = document.createElement("video");
        v.srcObject = p.stream;
        v.muted = false;
        v.playsInline = true;
        v.autoplay = true;
        v.play().catch(() => {});
        videoEls.set(p.id, v);
        if (p.stream.getAudioTracks().length > 0) {
          const src = audioCtx.createMediaStreamSource(p.stream);
          src.connect(audioDest);
          audioSources.set(p.id, src);
        }
      }
    }
  }

  syncParticipants(getParticipants());

  let animationId: number;
  const draw = () => {
    const participants = getParticipants();
    syncParticipants(participants);

    const n = participants.length;
    if (n === 0) {
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      const cols = n <= 2 ? n : Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const cellW = CANVAS_WIDTH / cols;
      const cellH = CANVAS_HEIGHT / rows;

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const v = videoEls.get(p.id);
        if (!v) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * cellW;
        const y = row * cellH;
        if (v.readyState >= 2) {
          ctx.drawImage(v, x, y, cellW, cellH);
        }
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(x, y + cellH - 28, cellW, 28);
        ctx.fillStyle = "#fff";
        ctx.font = "14px system-ui";
        ctx.fillText(p.label, x + 8, y + cellH - 10);
      }
    }
    animationId = requestAnimationFrame(draw);
  };
  draw();

  const canvasStream = canvas.captureStream(30);

  const compositeStream = new MediaStream();
  canvasStream.getVideoTracks().forEach((t) => compositeStream.addTrack(t));
  if (audioDest.stream.getAudioTracks().length > 0) {
    audioDest.stream.getAudioTracks().forEach((t) => compositeStream.addTrack(t));
  }

  const cleanup = () => {
    cancelAnimationFrame(animationId);
    videoEls.forEach((v) => {
      v.srcObject = null;
    });
    videoEls.clear();
    audioSources.forEach((src) => src.disconnect());
    audioSources.clear();
    audioCtx.close();
  };

  return { stream: compositeStream, cleanup };
}

function PasswordModal({
  roomId,
  roomName,
  onSuccess,
}: {
  roomId: string;
  roomName?: string | null;
  onSuccess: (sessionToken: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = password.trim();
    if (trimmed.length < 4) {
      setError("Enter the room password (at least 4 characters)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/room/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, password: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          setError(
            "Room not found on the server. If the host restarted the app, ask them to create a new room."
          );
        } else if (res.status === 401) {
          setError("Incorrect password. Try again.");
        } else {
          setError(data.error || "Could not verify password");
        }
        return;
      }
      setStoredSessionToken(roomId, data.sessionToken);
      onSuccess(data.sessionToken);
    } catch {
      setError("Could not verify password. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="name-modal-overlay">
      <div className="name-modal name-modal-room">
        <div className="name-modal-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h2 className="name-modal-title">
          {roomName ? `Join "${roomName}"` : "Room password required"}
        </h2>
        <p className="name-modal-subtitle">
          This room is protected. Ask the host for the password to join.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            className="name-modal-input"
            placeholder="Room password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            maxLength={64}
            autoComplete="current-password"
          />
          {error && <div className="name-modal-error">{error}</div>}
          <button type="submit" className="btn btn-primary name-modal-btn" disabled={loading}>
            {loading ? "Verifying…" : "Continue"}
          </button>
        </form>
        <Link href="/" className="create-room-back">
          Back to home
        </Link>
      </div>
    </div>
  );
}

function NameInputModal({
  onJoin,
  isHost,
  roomName,
}: {
  onJoin: (name: string) => void;
  isHost?: boolean;
  roomName?: string | null;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isHost && typeof window !== "undefined") {
      const stored = localStorage.getItem(CHAT_NAME_KEY);
      if (stored?.trim()) {
        setName(stored.trim());
      }
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [isHost]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter your name");
      return;
    }
    if (trimmed.length > 30) {
      setError("Name must be 30 characters or less");
      return;
    }
    // Save to localStorage
    if (typeof window !== "undefined") {
      localStorage.setItem(CHAT_NAME_KEY, trimmed);
    }
    onJoin(trimmed);
  };

  return (
    <div className="name-modal-overlay">
      <div className="name-modal name-modal-room">
        <div className="name-modal-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="name-modal-title">
          {isHost ? "Enter your name as host" : roomName ? `Join "${roomName}"` : "Join the room"}
        </h2>
        <p className="name-modal-subtitle">
          {isHost
            ? "This is how others will see you in the meeting you just created."
            : "Pick a display name — friends will see this on your video tile"}
        </p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="name-modal-input"
            placeholder={isHost ? "Host name" : "Your name"}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            maxLength={30}
            autoFocus
          />
          {error && <div className="name-modal-error">{error}</div>}
          <button type="submit" className="btn btn-primary name-modal-btn">
            {isHost ? "Start meeting" : "Join room"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function RoomPage({ uuid, roomLink }: { uuid: string; roomLink: string }) {
  const [wsBase, setWsBase] = useState("");
  const [authState, setAuthState] = useState<"loading" | "notfound" | "password" | "ready">("loading");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [roomDisplayName, setRoomDisplayName] = useState<string | null>(null);
  const [isHostJoin, setIsHostJoin] = useState(false);
  const [noPerm, setNoPerm] = useState(false);
  const [connClosed, setConnClosed] = useState(false);
  const [viewerCount, setViewerCount] = useState("0");
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [userName, setUserName] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<"idle" | "uploading" | "saved" | "error">("idle");
  const [recordingPeer, setRecordingPeer] = useState<{ id: string; name: string } | null>(null);
  const [videoLayout, setVideoLayout] = useState<VideoLayoutMode>("auto");
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({});
  const [isHandRaised, setIsHandRaised] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const compositeCleanupRef = useRef<(() => void) | null>(null);
  const remoteStreamsRef = useRef(remoteStreams);
  const peerNamesRef = useRef(peerNames);
  useEffect(() => {
    remoteStreamsRef.current = remoteStreams;
    peerNamesRef.current = peerNames;
  }, [remoteStreams, peerNames]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const candidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  useEffect(() => {
    setWsBase(getWsBase());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(VIDEO_LAYOUT_KEY);
    if (stored === "auto" || stored === "grid" || stored === "spotlight" || stored === "sidebar") {
      setVideoLayout(stored);
    }
  }, []);

  const handleLayoutChange = useCallback((layout: VideoLayoutMode) => {
    setVideoLayout(layout);
    if (typeof window !== "undefined") {
      localStorage.setItem(VIDEO_LAYOUT_KEY, layout);
    }
  }, []);

  const roomWsUrl = wsBase
    ? wsUrlWithToken(`${wsBase}/room/${uuid}/websocket`, sessionToken)
    : "";
  const chatWsUrl = wsBase
    ? wsUrlWithToken(`${wsBase}/room/${uuid}/chat/websocket`, sessionToken)
    : "";
  const viewerWsUrl = wsBase
    ? wsUrlWithToken(`${wsBase}/room/${uuid}/viewer/websocket`, sessionToken)
    : "";

  useEffect(() => {
    let cancelled = false;

    async function initAuth() {
      try {
        const statusRes = await fetch(`/api/room/${uuid}/status`);
        const status = await statusRes.json();
        if (!status.exists) {
          if (!cancelled) setAuthState("notfound");
          return;
        }

        if (!cancelled && status.roomName) {
          setRoomDisplayName(status.roomName);
        }

        const stored = getStoredSessionToken(uuid);
        const creatorToken = getStoredCreatorToken(uuid);

        if (stored) {
          if (!cancelled) {
            setSessionToken(stored);
            setIsHostJoin(!!creatorToken);
            setAuthState("ready");
          }
          return;
        }

        if (creatorToken) {
          const verifyRes = await fetch("/api/room/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomId: uuid, creatorToken }),
          });
          if (verifyRes.ok) {
            const data = await verifyRes.json();
            setStoredSessionToken(uuid, data.sessionToken);
            if (!cancelled) {
              setSessionToken(data.sessionToken);
              setIsHostJoin(true);
              setAuthState("ready");
            }
            return;
          }
        }

        if (!cancelled) setAuthState("password");
      } catch {
        if (!cancelled) setAuthState("password");
      }
    }

    initAuth();
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {});
  };

  const send = useCallback(
    (msg: { to?: string; event: string; data?: string; name?: string; raised?: boolean }) => {
      if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(msg));
    },
    []
  );

  const flushCandidates = useCallback((peerId: string, pc: RTCPeerConnection) => {
    const q = candidateQueueRef.current.get(peerId);
    if (!q?.length) return;
    q.forEach((c) => pc.addIceCandidate(c).catch(() => {}));
    candidateQueueRef.current.delete(peerId);
  }, []);

  const createOfferTo = useCallback(
    (peerId: string, stream: MediaStream) => {
      if (peersRef.current.has(peerId)) return;
      const myId = myIdRef.current;
      if (!myId || myId >= peerId) return;
      const pc = new RTCPeerConnection(ICE);
      peersRef.current.set(peerId, pc);
      
      // Use screen stream if sharing, otherwise use camera stream
      const streamToUse = isScreenSharing && screenStreamRef.current 
        ? screenStreamRef.current 
        : stream;
      
      streamToUse.getTracks().forEach((t) => pc.addTrack(t, streamToUse));
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ to: peerId, event: "candidate", data: JSON.stringify(e.candidate.toJSON()) });
      };
      pc.ontrack = (e) => {
        console.log(`[${peerId}] Track received (offerer):`, e.track.kind, e.track.id, e.track.readyState, 'readyState:', e.track.readyState);
        const track = e.track;
        if (track.readyState === 'ended') {
          console.log(`[${peerId}] Track ended, ignoring`);
          return;
        }
        setRemoteStreams((prev) => {
          const ex = prev[peerId];
          if (ex) {
            // Check if track already exists
            if (ex.getTracks().some(t => t.id === track.id)) {
              console.log(`[${peerId}] Track ${track.id} already in stream`);
              return prev;
            }
            // Create new stream with all tracks including the new one
            const allTracks = [...ex.getTracks(), track];
            const newStream = new MediaStream(allTracks);
            console.log(`[${peerId}] Updated stream (offerer): ${allTracks.length} tracks`);
            return { ...prev, [peerId]: newStream };
          }
          // Create new stream for this peer
          const s = e.streams?.[0] || new MediaStream([track]);
          console.log(`[${peerId}] Created new stream (offerer) with ${s.getTracks().length} tracks`);
          return { ...prev, [peerId]: s };
        });
      };
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`[${peerId}] Connection state:`, state);
        if (state === 'failed' || state === 'disconnected') {
          // Try to reconnect or clean up
          console.warn(`[${peerId}] Connection ${state}, may need to reconnect`);
        }
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => send({ to: peerId, event: "offer", data: JSON.stringify(pc.localDescription) }))
        .catch((err) => console.error(`[${peerId}] Offer error:`, err));
    },
    [send, isScreenSharing]
  );

  const connectRoomWs = useCallback(() => {
    if (!roomWsUrl || !localStreamRef.current || !userName) return;
    if (wsRef.current?.readyState === 1) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    const ws = new WebSocket(roomWsUrl);
    wsRef.current = ws;
    setConnClosed(false);

    ws.onopen = () => {
      // Send our name IMMEDIATELY when WebSocket opens (before any other messages)
      // This ensures the server has our name before other peers see us
      // Send name immediately (this should be the first message)
      if (userName) {
        ws.send(JSON.stringify({ event: "set-name", name: userName }));
      }
    };

    ws.onclose = () => {
      setConnClosed(true);
      wsRef.current = null;
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      setRemoteStreams({});
      setTimeout(connectRoomWs, 1000);
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      const stream = localStreamRef.current!;
      // Use screen stream if sharing, otherwise use camera stream
      const activeStream = isScreenSharing && screenStreamRef.current 
        ? screenStreamRef.current 
        : stream;

        if (msg.event === "joined") {
        myIdRef.current = msg.peerId;
        // Store peer names from the joined message
        if (msg.peers && Array.isArray(msg.peers)) {
          const names: Record<string, string> = {};
          const hands: Record<string, boolean> = {};
          msg.peers.forEach((p: { id: string; name?: string; handRaised?: boolean } | string) => {
            if (typeof p === 'object' && p.id) {
              names[p.id] = p.name || `Peer ${p.id.slice(0, 4)}`;
              if (p.handRaised) hands[p.id] = true;
              createOfferTo(p.id, activeStream);
            } else if (typeof p === 'string') {
              createOfferTo(p, activeStream);
            }
          });
          setPeerNames(names);
          setRaisedHands((prev) => ({ ...prev, ...hands }));
        } else {
          // Backward compatibility
          (msg.peers || []).forEach((p: string) => createOfferTo(p, activeStream));
        }
        // Name should already be sent in onopen, but send again to be sure
        if (userName && ws.readyState === 1) {
          ws.send(JSON.stringify({ event: "set-name", name: userName }));
        }
        // Show who is recording if someone started before we joined
        if (msg.recordingPeer && msg.recordingPeer.peerId && msg.recordingPeer.name) {
          setRecordingPeer({
            id: msg.recordingPeer.peerId,
            name: msg.recordingPeer.name,
          });
        }
        return;
      }
      if (msg.event === "new-peer") {
        createOfferTo(msg.peerId, activeStream);
        // Store the peer's name (use provided name or wait for update)
        setPeerNames((prev) => {
          const newNames = { ...prev };
          if (msg.name && msg.name.trim()) {
            newNames[msg.peerId] = msg.name.trim();
          } else {
            // Don't set default name yet - wait for peer-name-updated
            newNames[msg.peerId] = `Peer ${msg.peerId.slice(0, 4)}`;
          }
          return newNames;
        });
        return;
      }
      if (msg.event === "peer-name-updated") {
        // Update peer name when it changes (this is the authoritative source)
        if (msg.peerId && msg.name && typeof msg.name === 'string') {
          const trimmedName = msg.name.trim();
          if (trimmedName) {
            setPeerNames((prev) => ({ ...prev, [msg.peerId]: trimmedName }));
            console.log(`[Name Update] Peer ${msg.peerId} name updated to: ${trimmedName}`);
          }
        }
        return;
      }
      if (msg.event === "peer-left") {
        const pc = peersRef.current.get(msg.peerId);
        if (pc) {
          pc.close();
          peersRef.current.delete(msg.peerId);
        }
        setRemoteStreams((prev) => {
          const n = { ...prev };
          delete n[msg.peerId];
          return n;
        });
        setPeerNames((prev) => {
          const n = { ...prev };
          delete n[msg.peerId];
          return n;
        });
        setRaisedHands((prev) => {
          const n = { ...prev };
          delete n[msg.peerId];
          return n;
        });
        setRecordingPeer((prev) => (prev?.id === msg.peerId ? null : prev));
        return;
      }
      if (msg.event === "hand-raised" && msg.peerId) {
        setRaisedHands((prev) => {
          const next = { ...prev };
          if (msg.raised) next[msg.peerId] = true;
          else delete next[msg.peerId];
          return next;
        });
        return;
      }
      if (msg.event === "recording-started") {
        setRecordingPeer({
          id: msg.peerId,
          name: msg.name || `Peer ${msg.peerId?.slice(0, 4) || "?"}`,
        });
        return;
      }
      if (msg.event === "recording-stopped") {
        setRecordingPeer((prev) => (prev?.id === msg.peerId ? null : prev));
        return;
      }
      if (msg.event === "offer") {
        const from = msg.from;
        let pc: RTCPeerConnection | undefined = peersRef.current.get(from);
        if (!pc) {
          pc = new RTCPeerConnection(ICE);
          peersRef.current.set(from, pc);
          
          // Add local tracks to the connection (use screen stream if sharing)
          const streamToUse = isScreenSharing && screenStreamRef.current 
            ? screenStreamRef.current 
            : activeStream;
          streamToUse.getTracks().forEach((t) => pc!.addTrack(t, streamToUse));
          
          pc!.onicecandidate = (e) => {
            if (e.candidate) send({ to: from, event: "candidate", data: JSON.stringify(e.candidate.toJSON()) });
          };
          pc!.ontrack = (e) => {
            const track = e.track;
            console.log(`[${from}] Track received (answerer):`, track.kind, track.id, track.readyState);
            if (track.readyState === 'ended') {
              console.log(`[${from}] Track ended, ignoring`);
              return;
            }
            setRemoteStreams((prev) => {
              const ex = prev[from];
              if (ex) {
                // Check if track already exists by ID
                if (ex.getTracks().some(t => t.id === track.id)) {
                  console.log(`[${from}] Track ${track.id} already in stream`);
                  return prev;
                }
                // Create new stream with all tracks including the new one
                const allTracks = [...ex.getTracks(), track];
                const newStream = new MediaStream(allTracks);
                console.log(`[${from}] Updated stream (answerer): ${allTracks.length} tracks`);
                return { ...prev, [from]: newStream };
              }
              // Create new stream for this peer
              const s = e.streams?.[0] || new MediaStream([track]);
              console.log(`[${from}] Created new stream (answerer) with ${s.getTracks().length} tracks`);
              return { ...prev, [from]: s };
            });
          };
          const pcForStateChange = pc;
          pcForStateChange.onconnectionstatechange = () => {
            const state = pcForStateChange.connectionState;
            console.log(`[${from}] Connection state (answerer):`, state);
            if (state === 'failed' || state === 'disconnected') {
              console.warn(`[${from}] Connection ${state} (answerer), may need to reconnect`);
            }
          };
        }
        const offer = JSON.parse(msg.data);
        if (!pc) return;
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => pc.createAnswer())
          .then((a) => pc.setLocalDescription(a))
          .then(() => send({ to: from, event: "answer", data: JSON.stringify(pc.localDescription) }))
          .then(() => flushCandidates(from, pc))
          .catch((err) => console.error(`[${from}] Answer error:`, err));
        return;
      }
      if (msg.event === "answer") {
        const pc = peersRef.current.get(msg.from);
        if (!pc) return;
        pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.data))).then(() => flushCandidates(msg.from, pc)).catch(() => {});
        return;
      }
      if (msg.event === "candidate") {
        const from = msg.from;
        const pc = peersRef.current.get(from);
        const c = JSON.parse(msg.data);
        if (pc && (pc.remoteDescription || pc.localDescription)) {
          pc.addIceCandidate(new RTCIceCandidate(c)).then(() => flushCandidates(from, pc)).catch(() => {});
        } else {
          if (!candidateQueueRef.current.has(from)) candidateQueueRef.current.set(from, []);
          candidateQueueRef.current.get(from)!.push(c);
        }
      }
    };
  }, [roomWsUrl, createOfferTo, send, flushCandidates, userName, isScreenSharing]);

  // Send name update when userName changes and WebSocket is connected
  useEffect(() => {
    if (userName && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ event: "set-name", name: userName }));
    }
  }, [userName]);

  // viewer count ws
  const viewerWsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (!viewerWsUrl) return;
    let t: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket(viewerWsUrl);
      viewerWsRef.current = ws;
      ws.onmessage = (e) => setViewerCount(String(e.data));
      ws.onclose = () => {
        viewerWsRef.current = null;
        setViewerCount("0");
        t = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      clearTimeout(t);
      viewerWsRef.current?.close();
    };
  }, [viewerWsUrl]);

  // getUserMedia + connect (only when userName is set)
  useEffect(() => {
    if (!roomWsUrl || !userName) return;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { max: 1280 }, height: { max: 720 }, frameRate: 30 }, audio: { echoCancellation: true } })
      .then((stream) => {
        setNoPerm(false);
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        // Initialize mute/video state based on tracks
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        setIsMuted(audioTracks.length > 0 && !audioTracks[0].enabled);
        setIsVideoEnabled(videoTracks.length > 0 && videoTracks[0].enabled);
        connectRoomWs();
      })
      .catch(() => setNoPerm(true));
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      wsRef.current?.close();
      peersRef.current.forEach((pc) => pc.close());
    };
  }, [roomWsUrl, connectRoomWs, userName]);

  const remoteCount = Object.keys(remoteStreams).length;
  const hasPeers = remoteCount > 0;
  const participantCount = 1 + remoteCount;
  const gridSizeClass = `video-grid--count-${Math.min(participantCount, 6)}`;
  const layoutMode = videoLayout === "auto" ? "auto" : videoLayout;
  const remoteIds = Object.keys(remoteStreams);
  const primaryPeerId =
    (layoutMode === "spotlight" || layoutMode === "sidebar") && remoteIds.length > 0
      ? remoteIds[0]
      : null;

  const toggleHandRaise = useCallback(() => {
    const next = !isHandRaised;
    setIsHandRaised(next);
    const myId = myIdRef.current;
    if (myId) {
      setRaisedHands((prev) => {
        const updated = { ...prev };
        if (next) updated[myId] = true;
        else delete updated[myId];
        return updated;
      });
    }
    send({ event: "hand-raise", raised: next });
  }, [isHandRaised, send]);

  const raisedHandNames = useMemo(() => {
    const names: string[] = [];
    const myId = myIdRef.current;
    if (isHandRaised && userName) names.push(userName);
    Object.entries(raisedHands).forEach(([id, up]) => {
      if (!up || id === myId) return;
      names.push(peerNames[id] || `Peer ${id.slice(0, 4)}`);
    });
    return names;
  }, [raisedHands, isHandRaised, userName, peerNames]);

  const videoGridClass = [
    "video-grid",
    gridSizeClass,
    `video-grid--layout-${layoutMode}`,
    primaryPeerId ? "video-grid--has-primary" : "",
  ].join(" ");

  const orderedRemoteIds = useMemo(() => {
    if (!primaryPeerId) return remoteIds;
    return [primaryPeerId, ...remoteIds.filter((id) => id !== primaryPeerId)];
  }, [remoteIds, primaryPeerId]);

  const useFocusLayout = layoutMode === "spotlight" || layoutMode === "sidebar";
  const localHandUp = isHandRaised || !!(myIdRef.current && raisedHands[myIdRef.current]);

  // Toggle audio mute/unmute
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    const newMuted = !isMuted;
    audioTracks.forEach((track) => {
      track.enabled = !newMuted;
    });
    setIsMuted(newMuted);
    
    // Update all peer connections
    peersRef.current.forEach((pc) => {
      const senders = pc.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = !newMuted;
        }
      });
    });
  }, [isMuted]);

  // Toggle video on/off
  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    const newVideoEnabled = !isVideoEnabled;
    videoTracks.forEach((track) => {
      track.enabled = newVideoEnabled;
    });
    setIsVideoEnabled(newVideoEnabled);
    
    // Update all peer connections
    peersRef.current.forEach((pc) => {
      const senders = pc.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === 'video') {
          sender.track.enabled = newVideoEnabled;
        }
      });
    });
  }, [isVideoEnabled]);

  // Replace video track in all peer connections
  const replaceVideoTrack = useCallback((newTrack: MediaStreamTrack | null) => {
    if (!newTrack) {
      console.warn('replaceVideoTrack called with null track');
      return;
    }
    
    console.log('Replacing video track in', peersRef.current.size, 'peer connections');
    console.log('New track ID:', newTrack.id, 'Kind:', newTrack.kind, 'Enabled:', newTrack.enabled);
    
    let replacedCount = 0;
    let failedCount = 0;
    
    peersRef.current.forEach((pc, peerId) => {
      // Only replace if connection is established
      const state = pc.connectionState;
      if (state === 'closed' || state === 'failed') {
        console.log(`[${peerId}] Skipping track replacement - connection state:`, state);
        return;
      }
      
      // Prefer "connected" state, but also allow "connecting" and "new"
      if (state !== 'connected' && state !== 'connecting' && state !== 'new') {
        console.log(`[${peerId}] Connection not ready for track replacement - state:`, state);
        // Don't return - still try to replace as it might work
      }
      
      console.log(`[${peerId}] Connection state:`, state);
      
      const senders = pc.getSenders();
      console.log(`[${peerId}] Total senders:`, senders.length);
      
      let videoSender = senders.find((s) => s.track && s.track.kind === 'video');
      
      if (videoSender) {
        // Replace existing video track
        const oldTrack = videoSender.track;
        console.log(`[${peerId}] Replacing existing video track. Old track ID:`, oldTrack?.id);
        
        videoSender.replaceTrack(newTrack).then(() => {
          replacedCount++;
          console.log(`[${peerId}] ✅ Video track replaced successfully. New track ID:`, newTrack.id);
        }).catch((err) => {
          failedCount++;
          console.error(`[${peerId}] ❌ Error replacing track:`, err);
        });
      } else {
        // No video sender exists - this shouldn't happen if connection was established properly
        console.warn(`[${peerId}] ⚠️ No video sender found! Connection might not be fully established.`);
        console.log(`[${peerId}] Available senders:`, senders.map(s => ({ kind: s.track?.kind, id: s.track?.id })));
        
        // Try to add the track anyway
        const stream = isScreenSharing && screenStreamRef.current 
          ? screenStreamRef.current 
          : localStreamRef.current;
        if (stream) {
          try {
            const sender = pc.addTrack(newTrack, stream);
            console.log(`[${peerId}] Track added as new sender. Sender:`, sender);
          } catch (err: any) {
            console.error(`[${peerId}] Error adding track:`, err);
          }
        } else {
          console.warn(`[${peerId}] No stream available to add track to`);
        }
      }
    });
    
    console.log(`Track replacement summary: ${replacedCount} succeeded, ${failedCount} failed`);
  }, [isScreenSharing]);

  // Start screen sharing
  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: 30 },
        audio: false, // Screen share typically doesn't include audio
      });
      
      screenStreamRef.current = screenStream;
      setIsScreenSharing(true);
      
      // Get the video track from screen stream
      const screenVideoTrack = screenStream.getVideoTracks()[0];
      
      if (!screenVideoTrack) {
        console.error('No video track in screen stream');
        return;
      }
      
      console.log('Starting screen share, replacing tracks in', peersRef.current.size, 'peer connections');
      console.log('Screen video track:', {
        id: screenVideoTrack.id,
        kind: screenVideoTrack.kind,
        enabled: screenVideoTrack.enabled,
        readyState: screenVideoTrack.readyState,
        label: screenVideoTrack.label
      });
      
      // Replace video track immediately
      replaceVideoTrack(screenVideoTrack);
      
      // Set up connection state listeners to replace track when connections become ready
      peersRef.current.forEach((pc, peerId) => {
        const handleConnectionStateChange = () => {
          const state = pc.connectionState;
          if (state === 'connected' && isScreenSharing && screenStreamRef.current) {
            console.log(`[${peerId}] Connection became connected, replacing track`);
            const senders = pc.getSenders();
            const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
            if (videoSender) {
              videoSender.replaceTrack(screenVideoTrack).then(() => {
                console.log(`[${peerId}] Track replaced after connection established`);
              }).catch((err) => {
                console.error(`[${peerId}] Error replacing track after connection:`, err);
              });
            }
          }
        };
        
        // Add listener if not already connected
        if (pc.connectionState !== 'connected') {
          pc.addEventListener('connectionstatechange', handleConnectionStateChange);
          // Remove listener after connection is established or after timeout
          setTimeout(() => {
            pc.removeEventListener('connectionstatechange', handleConnectionStateChange);
          }, 10000);
        }
      });
      
      // Retry after delays for connections that might not have been ready
      setTimeout(() => {
        console.log('Retrying track replacement after 500ms...');
        replaceVideoTrack(screenVideoTrack);
      }, 500);
      
      setTimeout(() => {
        console.log('Retrying track replacement after 2000ms...');
        replaceVideoTrack(screenVideoTrack);
      }, 2000);
      
      // Update local video display
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;
      }
      
      // Handle screen share end (user clicks stop sharing in browser UI)
      screenVideoTrack.onended = () => {
        stopScreenShare();
      };
      
    } catch (err) {
      console.error('Error starting screen share:', err);
      alert('Failed to start screen sharing. Please check your browser permissions.');
    }
  }, [replaceVideoTrack]);

  // Stop screen sharing
  const stopScreenShare = useCallback(() => {
    console.log('Stopping screen share');
    
    if (screenStreamRef.current) {
      // Stop all tracks in screen stream
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    
    setIsScreenSharing(false);
    
    // Restore camera video track
    if (localStreamRef.current) {
      const cameraVideoTrack = localStreamRef.current.getVideoTracks()[0];
      if (cameraVideoTrack) {
        console.log('Restoring camera track');
        replaceVideoTrack(cameraVideoTrack);
        
        // Update local video display
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
      } else {
        console.warn('No camera track available to restore');
      }
    }
  }, [replaceVideoTrack]);

  // Start recording - full meeting composite (all participants in one frame)
  const startRecording = useCallback(async () => {
    const localStream = isScreenSharing && screenStreamRef.current
      ? (() => {
          const s = new MediaStream();
          screenStreamRef.current!.getVideoTracks().forEach((t) => s.addTrack(t));
          localStreamRef.current?.getAudioTracks().forEach((t) => s.addTrack(t));
          return s;
        })()
      : localStreamRef.current;
    if (!localStream || localStream.getTracks().length === 0) {
      alert("No stream available to record.");
      return;
    }
    try {
      const getParticipants = () => {
        const remotes = remoteStreamsRef.current;
        const names = peerNamesRef.current;
        const local: ParticipantInfo = {
          id: "local",
          stream: localStream,
          label: userName || "You",
        };
        const remoteList: ParticipantInfo[] = Object.entries(remotes).map(([id, s]) => ({
          id,
          stream: s,
          label: names[id] || `Peer ${id.slice(0, 4)}`,
        }));
        return [local, ...remoteList];
      };
      const { stream: compositeStream, cleanup } = await createMeetingCompositeStream(getParticipants);
      compositeCleanupRef.current = cleanup;

      if (compositeStream.getTracks().length === 0) {
        cleanup();
        alert("Could not create meeting composite.");
        return;
      }

      recordingChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(compositeStream, {
        mimeType,
        videoBitsPerSecond: 2500000,
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        compositeCleanupRef.current?.();
        compositeCleanupRef.current = null;
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        setRecordingStatus("uploading");
        try {
          const formData = new FormData();
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          const dateTime =
            `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
            `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
          const filename = `recorded-meeting-${uuid}-${dateTime}.webm`;
          formData.append("file", blob, filename);
          formData.append("roomId", uuid);
          const res = await fetch("/api/recordings", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) throw new Error("Upload failed");
          const data = await res.json();
          setRecordingStatus("saved");
          setIsRecording(false);
          setTimeout(() => setRecordingStatus("idle"), 3000);
          const a = document.createElement("a");
          if (data.compressed && data.url) {
            const blobRes = await fetch(data.url);
            const compressedBlob = await blobRes.blob();
            a.href = URL.createObjectURL(compressedBlob);
          } else {
            a.href = URL.createObjectURL(blob);
          }
          a.download = data.filename || filename;
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (err) {
          console.error("Upload error:", err);
          setRecordingStatus("error");
          setIsRecording(false);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          const dateTime =
            `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
            `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
          a.download = `recorded-meeting-${dateTime}.webm`;
          a.click();
          URL.revokeObjectURL(a.href);
          setTimeout(() => setRecordingStatus("idle"), 3000);
          alert("Recording saved locally. Server upload failed.");
        }
        mediaRecorderRef.current = null;
      };
      recorder.start(1000);
      setIsRecording(true);
      setRecordingStatus("idle");
      send({ event: "recording-started", name: userName || "You" });
    } catch (err) {
      console.error("Recording error:", err);
      compositeCleanupRef.current?.();
      compositeCleanupRef.current = null;
      alert("Failed to start recording.");
    }
  }, [uuid, isScreenSharing, remoteStreams, peerNames, userName, send]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      send({ event: "recording-stopped" });
      mediaRecorderRef.current.stop();
      // isRecording stays true until onstop completes (shows "Saving…")
    }
  }, [send]);

  // Cleanup recorder on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      compositeCleanupRef.current?.();
      compositeCleanupRef.current = null;
    };
  }, []);

  if (authState === "loading") {
    return (
      <div className="loading-wrap room-auth-loading">
        <p>Checking room…</p>
      </div>
    );
  }

  if (authState === "notfound") {
    return (
      <div className="app-wrap">
        <div className="notif notif-danger room-not-found">
          <h2>Room not found</h2>
          <p>This room does not exist or was never created. Ask the host for a new link.</p>
          <Link href="/room/create" className="btn btn-primary btn-sm">
            Create a room
          </Link>
        </div>
      </div>
    );
  }

  if (authState === "password") {
    return (
      <PasswordModal
        roomId={uuid}
        roomName={roomDisplayName}
        onSuccess={(token) => {
          setSessionToken(token);
          setAuthState("ready");
        }}
      />
    );
  }

  if (!userName) {
    return (
      <NameInputModal
        isHost={isHostJoin}
        roomName={roomDisplayName}
        onJoin={(name) => setUserName(name)}
      />
    );
  }

  return (
    <div className="room-page">
      <div className="room-page-bg" aria-hidden>
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
      </div>

      <header className="room-nav">
        <Link href="/" className="landing-brand room-nav-brand">
          <span className="landing-brand-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </span>
          NexusRTC
        </Link>
        <div className="room-nav-meta">
          <span className="room-id-pill" title={roomDisplayName ? `${roomDisplayName} (${uuid})` : uuid}>
            {roomDisplayName || `Room · ${uuid.slice(0, 8)}`}
          </span>
          <span className="viewer-badge room-viewer-badge">
            <span className="viewer-badge-dot" />
            {viewerCount} in call
          </span>
        </div>
        <div className="room-nav-actions">
          <CopyLinkButton roomLink={roomLink} copy={copy} />
          <ThemeToggle />
          <Link href="/" className="btn btn-danger btn-sm room-leave-btn">
            Leave
          </Link>
        </div>
      </header>

      <Chat wsUrl={chatWsUrl} />

      <main className="room-main">
      {recordingPeer && !isRecording && (
        <div className="recording-by-peer-banner">
          <span className="recording-dot" />
          <span>{recordingPeer.name} is recording this meeting</span>
        </div>
      )}

      {noPerm && (
        <div className="notif notif-info">
          Camera and microphone permissions are needed to join.
        </div>
      )}

      {raisedHandNames.length > 0 && (
        <div className="room-hands-banner" role="status">
          <span className="room-hands-banner-icon" aria-hidden>✋</span>
          <span>
            {raisedHandNames.length === 1
              ? `${raisedHandNames[0]} raised their hand`
              : `${raisedHandNames.join(", ")} raised their hands`}
          </span>
        </div>
      )}

      {!noPerm && (
        <div className="room-stage" id="peers">
          <div className={videoGridClass} id="videos">
            {useFocusLayout && primaryPeerId && (() => {
              const stream = remoteStreams[primaryPeerId];
              if (!stream?.getTracks().length) return null;
              const handUp = !!raisedHands[primaryPeerId];
              const peerName = peerNames[primaryPeerId] || `Peer ${primaryPeerId.slice(0, 4)}`;
              return (
                <div key={primaryPeerId} className={`video-tile video-tile--primary ${handUp ? "video-tile--hand-raised" : ""}`}>
                  <RemoteVideo stream={stream} />
                  {handUp && <span className="video-tile-hand" title="Hand raised">✋</span>}
                  <span className="video-tile-label">{peerName}</span>
                </div>
              );
            })()}
            <div className={`video-tile you ${useFocusLayout && !primaryPeerId ? "video-tile--primary" : ""} ${localHandUp ? "video-tile--hand-raised" : ""}`}>
              <video ref={localVideoRef} className={isScreenSharing ? '' : 'mirror'} autoPlay muted playsInline style={{ opacity: isVideoEnabled || isScreenSharing ? 1 : 0.3 }} />
              {!isVideoEnabled && (
                <div className="video-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 7l-7 5 7 5V7z" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    <line x1="1" y1="1" x2="16" y2="16" />
                  </svg>
                  <span>Camera Off</span>
                </div>
              )}
              {localHandUp && <span className="video-tile-hand" title="Hand raised">✋</span>}
              <span className="video-tile-label">{userName}</span>
              {isScreenSharing && (
                <div className="screen-share-indicator">
                  <span>Sharing Screen</span>
                </div>
              )}
              {isRecording && (
                <div className="recording-indicator">
                  <span className="recording-dot" />
                  <span>{recordingStatus === "uploading" ? "Saving…" : recordingStatus === "saved" ? "Saved!" : "Recording"}</span>
                </div>
              )}
            </div>
            {connClosed && (
              <div className="room-alert room-alert-danger">
                Connection closed. Please refresh the page.
              </div>
            )}
            {orderedRemoteIds
              .filter((peerId) => !(useFocusLayout && primaryPeerId && peerId === primaryPeerId))
              .map((peerId) => {
                const stream = remoteStreams[peerId];
                if (!stream?.getTracks().length) return null;
                const handUp = !!raisedHands[peerId];
                const peerName = peerNames[peerId] || `Peer ${peerId.slice(0, 4)}`;
                return (
                  <div key={peerId} className={`video-tile ${handUp ? "video-tile--hand-raised" : ""}`}>
                    <RemoteVideo stream={stream} />
                    {handUp && <span className="video-tile-hand" title="Hand raised">✋</span>}
                    <span className="video-tile-label">{peerName}</span>
                  </div>
                );
              })}
          </div>
          {!hasPeers && !connClosed && (
            <aside className="room-empty-panel">
              <div className="room-empty-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                </svg>
              </div>
              <h3>Waiting for others</h3>
              <p>Share your room link — friends can join instantly from any browser.</p>
              <CopyLinkButton roomLink={roomLink} copy={copy} />
            </aside>
          )}
        </div>
      )}

      {!noPerm && (
        <RoomControlsDock
          userName={userName}
          isMuted={isMuted}
          isVideoEnabled={isVideoEnabled}
          isScreenSharing={isScreenSharing}
          isRecording={isRecording}
          isHandRaised={isHandRaised}
          videoLayout={videoLayout}
          onToggleMute={toggleMute}
          onToggleVideo={toggleVideo}
          onToggleScreenShare={isScreenSharing ? stopScreenShare : startScreenShare}
          onToggleRecording={isRecording ? stopRecording : startRecording}
          onToggleHandRaise={toggleHandRaise}
          onLayoutChange={handleLayoutChange}
        />
      )}
      </main>
    </div>
  );
}
