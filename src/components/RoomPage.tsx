"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getStoredCreatorToken,
  getStoredRoomPassword,
  getStoredSessionToken,
  setStoredRoomPassword,
  setStoredSessionToken,
} from "@/lib/room-auth";
import { deriveChatKey } from "@/lib/chat-crypto";
import { initErrorReporting, reportError } from "@/lib/error-reporting";
import { createRoomSocket, emitSignaling, type RoomSocket } from "@/lib/socket-client";
import { Chat } from "./Chat";
import { RoomControlsDock, type VideoLayoutMode } from "./room/RoomControlsDock";
import { ThemeToggle } from "./ThemeToggle";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { PageBackground } from "./ui/PageBackground";
import {
  buildRecordingFilename,
  formatRecordingElapsed,
  formatRecordingTimestamp,
} from "@/lib/recording-utils";

const VIDEO_LAYOUT_KEY = "nexus-video-layout";

/** Bind remote tracks to the browser MediaStream so replaceTrack (screen share) stays live. */
function bindRemoteTrack(
  peerId: string,
  event: RTCTrackEvent,
  setRemoteStreams: React.Dispatch<React.SetStateAction<Record<string, MediaStream>>>
) {
  const track = event.track;
  if (track.readyState === "ended") return;

  setRemoteStreams((prev) => {
    const pcStream = event.streams?.[0];
    if (pcStream) {
      return { ...prev, [peerId]: pcStream };
    }

    let stream = prev[peerId];
    if (!stream) stream = new MediaStream();

    const sameKind = stream.getTracks().find((t) => t.kind === track.kind && t.id !== track.id);
    if (sameKind) stream.removeTrack(sameKind);
    if (!stream.getTracks().some((t) => t.id === track.id)) {
      stream.addTrack(track);
    }
    return { ...prev, [peerId]: stream };
  });
}

function remoteVideoTrackId(stream: MediaStream | undefined): string {
  return stream?.getVideoTracks().find((t) => t.readyState === "live")?.id ?? "none";
}

type PeerConnectionCtx = {
  send: (msg: {
    to?: string;
    event: string;
    data?: string;
    name?: string;
    raised?: boolean;
    active?: boolean;
  }) => void;
  setRemoteStreams: React.Dispatch<React.SetStateAction<Record<string, MediaStream>>>;
  replaceVideoTrackOnPeer: (pc: RTCPeerConnection, track: MediaStreamTrack) => Promise<boolean>;
  isScreenSharingRef: React.MutableRefObject<boolean>;
  screenStreamRef: React.MutableRefObject<MediaStream | null>;
  iceRestartTimersRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
};

function attachPeerConnectionHandlers(
  peerId: string,
  pc: RTCPeerConnection,
  ctx: PeerConnectionCtx
) {
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ctx.send({ to: peerId, event: "candidate", data: JSON.stringify(e.candidate.toJSON()) });
    }
  };
  pc.ontrack = (e) => bindRemoteTrack(peerId, e, ctx.setRemoteStreams);
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (
      state === "connected" &&
      ctx.isScreenSharingRef.current &&
      ctx.screenStreamRef.current
    ) {
      const screenTrack = ctx.screenStreamRef.current.getVideoTracks()[0];
      if (screenTrack) ctx.replaceVideoTrackOnPeer(pc, screenTrack).catch(() => {});
      return;
    }
    if (state === "failed" || state === "disconnected") {
      const existing = ctx.iceRestartTimersRef.current.get(peerId);
      if (existing) clearTimeout(existing);
      const delay = state === "failed" ? 0 : 2500;
      const timer = setTimeout(() => {
        ctx.iceRestartTimersRef.current.delete(peerId);
        if (pc.connectionState !== "failed" && pc.connectionState !== "disconnected") return;
        if (pc.signalingState !== "stable") return;
        pc.createOffer({ iceRestart: true })
          .then((offer) => pc.setLocalDescription(offer))
          .then(() =>
            ctx.send({ to: peerId, event: "offer", data: JSON.stringify(pc.localDescription) })
          )
          .catch(() => {});
      }, delay);
      ctx.iceRestartTimersRef.current.set(peerId, timer);
    }
  };
}

function RemoteVideo({
  stream,
  isScreenShare = false,
  onVideoTrackChange,
}: {
  stream: MediaStream;
  isScreenShare?: boolean;
  onVideoTrackChange?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;

    const attach = () => {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch(() => {});
    };

    const hardRefresh = () => {
      el.srcObject = null;
      requestAnimationFrame(() => {
        el.srcObject = stream;
        el.play().catch(() => {});
        onVideoTrackChange?.();
      });
    };

    attach();

    const trackListeners: Array<{ track: MediaStreamTrack; fn: () => void }> = [];
    const watchTrack = (track: MediaStreamTrack) => {
      const onChange = () => {
        if (track.kind === "video") hardRefresh();
        else attach();
      };
      track.addEventListener("ended", onChange);
      track.addEventListener("mute", onChange);
      track.addEventListener("unmute", onChange);
      trackListeners.push({ track, fn: onChange });
    };

    stream.getTracks().forEach(watchTrack);

    const onAddTrack = (ev: MediaStreamTrackEvent) => {
      watchTrack(ev.track);
      if (ev.track.kind === "video") hardRefresh();
      else attach();
    };

    const onRemoveTrack = (ev: MediaStreamTrackEvent) => {
      if (ev.track.kind === "video") hardRefresh();
      else attach();
    };

    stream.addEventListener("addtrack", onAddTrack);
    stream.addEventListener("removetrack", onRemoveTrack);

    return () => {
      stream.removeEventListener("addtrack", onAddTrack);
      stream.removeEventListener("removetrack", onRemoveTrack);
      trackListeners.forEach(({ track, fn }) => {
        track.removeEventListener("ended", fn);
        track.removeEventListener("mute", fn);
        track.removeEventListener("unmute", fn);
      });
      if (el) el.srcObject = null;
    };
  }, [stream, onVideoTrackChange]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      className={isScreenShare ? "video-screen-share" : undefined}
    />
  );
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

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const REACTION_EMOJIS = ["👍", "❤️", "😂", "👏", "🔥"] as const;

const CHAT_NAME_KEY = "nexus-chat-name";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const RECORDING_HEADER_H = 44;

type RecordingMeta = {
  roomName: string;
  startedAt: Date;
};

type ParticipantInfo = { id: string; stream: MediaStream; label: string };

async function createMeetingCompositeStream(
  getParticipants: () => ParticipantInfo[],
  meta?: RecordingMeta
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
    const stageTop = meta ? RECORDING_HEADER_H : 0;
    const stageH = CANVAS_HEIGHT - stageTop;

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (meta) {
      const { display } = formatRecordingTimestamp(meta.startedAt);
      const elapsed = formatRecordingElapsed(Date.now() - meta.startedAt.getTime());

      ctx.fillStyle = "rgba(15, 23, 42, 0.96)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, RECORDING_HEADER_H);

      ctx.fillStyle = "#34d399";
      ctx.font = "600 14px system-ui, sans-serif";
      ctx.fillText("NexusRTC", 14, 28);

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "500 13px system-ui, sans-serif";
      const roomLabel =
        meta.roomName.length > 28 ? `${meta.roomName.slice(0, 26)}…` : meta.roomName;
      ctx.fillText(roomLabel, 108, 28);

      ctx.textAlign = "right";
      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 12px system-ui, sans-serif";
      ctx.fillText(`Recorded · ${display}`, CANVAS_WIDTH - 14, 28);
      ctx.textAlign = "left";
    }

    if (n === 0) {
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, stageTop, CANVAS_WIDTH, stageH);
    } else {
      const cols = n <= 2 ? n : Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const cellW = CANVAS_WIDTH / cols;
      const cellH = stageH / rows;

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, stageTop, CANVAS_WIDTH, stageH);

      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const v = videoEls.get(p.id);
        if (!v) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * cellW;
        const y = stageTop + row * cellH;
        if (v.readyState >= 2) {
          ctx.drawImage(v, x, y, cellW, cellH);
        }
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(x, y + cellH - 28, cellW, 28);
        ctx.fillStyle = "#fff";
        ctx.font = "14px system-ui, sans-serif";
        ctx.fillText(p.label, x + 8, y + cellH - 10);
      }
    }

    if (meta) {
      const elapsed = formatRecordingElapsed(Date.now() - meta.startedAt.getTime());
      const badgeW = 88;
      const badgeH = 26;
      const badgeX = CANVAS_WIDTH - badgeW - 12;
      const badgeY = CANVAS_HEIGHT - badgeH - 12;
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
      ctx.fill();
      ctx.fillStyle = "#f87171";
      ctx.beginPath();
      ctx.arc(badgeX + 14, badgeY + badgeH / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillText(elapsed, badgeX + 24, badgeY + 17);
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
      setStoredRoomPassword(roomId, trimmed);
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
  const [authState, setAuthState] = useState<"loading" | "notfound" | "password" | "ready">("loading");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [roomDisplayName, setRoomDisplayName] = useState<string | null>(null);
  const [isHostJoin, setIsHostJoin] = useState(false);
  const [noPerm, setNoPerm] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connFailed, setConnFailed] = useState(false);
  const [viewerCount, setViewerCount] = useState("0");
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [userName, setUserName] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<"idle" | "uploading" | "saved" | "error">("idle");
  const [recordingSavedLabel, setRecordingSavedLabel] = useState<string | null>(null);
  const [recordingPeer, setRecordingPeer] = useState<{ id: string; name: string } | null>(null);
  const [videoLayout, setVideoLayout] = useState<VideoLayoutMode>("auto");
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({});
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [remoteScreenShare, setRemoteScreenShare] = useState<Record<string, boolean>>({});
  const [remoteVideoEpoch, setRemoteVideoEpoch] = useState<Record<string, number>>({});
  const [inWaitingRoom, setInWaitingRoom] = useState(false);
  const [waitingGuests, setWaitingGuests] = useState<{ id: string; name: string }[]>([]);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(true);
  const [peerReactions, setPeerReactions] = useState<Record<string, { emoji: string; id: number }[]>>({});
  const [chatKey, setChatKey] = useState<CryptoKey | null>(null);
  const [roomRejected, setRoomRejected] = useState(false);
  const [roomFull, setRoomFull] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);

  const [roomSocket, setRoomSocket] = useState<RoomSocket | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const compositeCleanupRef = useRef<(() => void) | null>(null);
  const recordingStartedAtRef = useRef<Date | null>(null);
  const remoteStreamsRef = useRef(remoteStreams);
  const peerNamesRef = useRef(peerNames);
  useEffect(() => {
    remoteStreamsRef.current = remoteStreams;
    peerNamesRef.current = peerNames;
  }, [remoteStreams, peerNames]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isScreenSharingRef = useRef(false);
  const screenShareRetryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketRef = useRef<RoomSocket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const candidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const iceRestartTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const leavingRoomRef = useRef(false);
  const reactionIdRef = useRef(0);

  useEffect(() => {
    initErrorReporting().catch(() => {});
    fetch("/api/ice-config")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.iceServers) && data.iceServers.length) {
          iceServersRef.current = data.iceServers;
        }
      })
      .catch((err) => reportError(err, { context: "ice-config" }));
  }, []);

  useEffect(() => {
    const password = getStoredRoomPassword(uuid);
    if (!password) {
      setChatKey(null);
      return;
    }
    deriveChatKey(uuid, password)
      .then(setChatKey)
      .catch((err) => reportError(err, { context: "chat-key" }));
  }, [uuid, sessionToken]);

  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
  }, [isScreenSharing]);

  const getOutboundVideoTrack = useCallback((): MediaStreamTrack | null => {
    if (isScreenSharingRef.current && screenStreamRef.current) {
      const screenTrack = screenStreamRef.current.getVideoTracks()[0];
      if (screenTrack && screenTrack.readyState !== "ended") return screenTrack;
    }
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraTrack && cameraTrack.readyState !== "ended") return cameraTrack;
    return null;
  }, []);

  const attachLocalTracksToPeer = useCallback(
    (pc: RTCPeerConnection) => {
      const local = localStreamRef.current;
      if (!local) return;

      local.getAudioTracks().forEach((track) => {
        if (!pc.getSenders().some((s) => s.track?.id === track.id)) {
          pc.addTrack(track, local);
        }
      });

      const videoTrack = getOutboundVideoTrack();
      if (!videoTrack) return;

      const videoStream =
        isScreenSharingRef.current && screenStreamRef.current
          ? screenStreamRef.current
          : local;

      if (!pc.getSenders().some((s) => s.track?.id === videoTrack.id)) {
        pc.addTrack(videoTrack, videoStream);
      }
    },
    [getOutboundVideoTrack]
  );

  const replaceVideoTrackOnPeer = useCallback(
    async (pc: RTCPeerConnection, track: MediaStreamTrack): Promise<boolean> => {
      if (pc.connectionState === "closed" || pc.connectionState === "failed") {
        return false;
      }

      const videoSender =
        pc.getSenders().find((s) => s.track?.kind === "video") ??
        pc.getTransceivers().find((t) => t.sender.track?.kind === "video")?.sender;

      if (videoSender) {
        await videoSender.replaceTrack(track);
        return true;
      }

      const local = localStreamRef.current;
      const stream =
        isScreenSharingRef.current && screenStreamRef.current
          ? screenStreamRef.current
          : local;
      if (stream) {
        pc.addTrack(track, stream);
        return true;
      }
      return false;
    },
    []
  );

  const replaceVideoTrackOnAllPeers = useCallback(
    async (track: MediaStreamTrack) => {
      await Promise.all(
        Array.from(peersRef.current.entries()).map(([peerId, pc]) =>
          replaceVideoTrackOnPeer(pc, track).catch((err) => {
            console.warn(`[${peerId}] replaceTrack failed:`, err);
            return false;
          })
        )
      );
    },
    [replaceVideoTrackOnPeer]
  );

  const clearScreenShareRetries = useCallback(() => {
    screenShareRetryTimersRef.current.forEach(clearTimeout);
    screenShareRetryTimersRef.current = [];
  }, []);

  const scheduleScreenShareRetries = useCallback(
    (track: MediaStreamTrack) => {
      clearScreenShareRetries();
      [300, 1000, 2500].forEach((ms) => {
        const timer = setTimeout(() => {
          if (
            isScreenSharingRef.current &&
            screenStreamRef.current?.getVideoTracks()[0]?.id === track.id
          ) {
            replaceVideoTrackOnAllPeers(track);
          }
        }, ms);
        screenShareRetryTimersRef.current.push(timer);
      });
    },
    [clearScreenShareRetries, replaceVideoTrackOnAllPeers]
  );

  const updateLocalPreview = useCallback(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (isScreenSharingRef.current && screenStreamRef.current) {
      el.srcObject = screenStreamRef.current;
      return;
    }
    if (localStreamRef.current) {
      el.srcObject = localStreamRef.current;
    }
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

  const bumpRemoteVideo = useCallback((peerId: string) => {
    setRemoteVideoEpoch((prev) => ({ ...prev, [peerId]: (prev[peerId] ?? 0) + 1 }));
  }, []);

  const send = useCallback(
    (msg: {
      to?: string;
      event: string;
      data?: string;
      name?: string;
      raised?: boolean;
      active?: boolean;
      guestId?: string;
      emoji?: string;
      enabled?: boolean;
    }) => {
      emitSignaling(socketRef.current, msg);
    },
    []
  );

  const renegotiateAllPeers = useCallback(async () => {
    await Promise.all(
      Array.from(peersRef.current.entries()).map(async ([peerId, pc]) => {
        if (pc.connectionState === "closed" || pc.connectionState === "failed") return;
        if (pc.signalingState !== "stable") return;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({ to: peerId, event: "offer", data: JSON.stringify(pc.localDescription) });
        } catch (err) {
          console.warn(`[${peerId}] renegotiate failed:`, err);
        }
      })
    );
  }, [send]);

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

  const flushCandidates = useCallback((peerId: string, pc: RTCPeerConnection) => {
    const q = candidateQueueRef.current.get(peerId);
    if (!q?.length) return;
    q.forEach((c) => pc.addIceCandidate(c).catch(() => {}));
    candidateQueueRef.current.delete(peerId);
  }, []);

  const peerConnectionCtx = useMemo<PeerConnectionCtx>(
    () => ({
      send,
      setRemoteStreams,
      replaceVideoTrackOnPeer,
      isScreenSharingRef,
      screenStreamRef,
      iceRestartTimersRef,
    }),
    [send, replaceVideoTrackOnPeer]
  );

  const createOfferTo = useCallback(
    (peerId: string, _stream?: MediaStream) => {
      if (peersRef.current.has(peerId)) return;
      const myId = myIdRef.current;
      if (!myId || myId >= peerId) return;
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      peersRef.current.set(peerId, pc);

      attachLocalTracksToPeer(pc);
      attachPeerConnectionHandlers(peerId, pc, peerConnectionCtx);

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => send({ to: peerId, event: "offer", data: JSON.stringify(pc.localDescription) }))
        .catch((err) => console.error(`[${peerId}] Offer error:`, err));
    },
    [send, attachLocalTracksToPeer, peerConnectionCtx]
  );

  const showPeerReaction = useCallback((peerId: string, emoji: string) => {
    const id = ++reactionIdRef.current;
    setPeerReactions((prev) => ({
      ...prev,
      [peerId]: [...(prev[peerId] || []), { emoji, id }],
    }));
    setTimeout(() => {
      setPeerReactions((prev) => ({
        ...prev,
        [peerId]: (prev[peerId] || []).filter((r) => r.id !== id),
      }));
    }, 3000);
  }, []);

  const sendReaction = useCallback(
    (emoji: string) => {
      const myId = myIdRef.current;
      send({ event: "reaction", emoji });
      if (myId) showPeerReaction(myId, emoji);
    },
    [send, showPeerReaction]
  );

  const admitGuest = useCallback(
    (guestId: string) => {
      send({ event: "admit-guest", guestId });
      setWaitingGuests((prev) => prev.filter((g) => g.id !== guestId));
    },
    [send]
  );

  const rejectGuest = useCallback(
    (guestId: string) => {
      send({ event: "reject-guest", guestId });
      setWaitingGuests((prev) => prev.filter((g) => g.id !== guestId));
    },
    [send]
  );

  const admitAllGuests = useCallback(() => {
    send({ event: "admit-all-guests" });
    setWaitingGuests([]);
  }, [send]);

  const toggleWaitingRoom = useCallback(() => {
    const next = !waitingRoomEnabled;
    setWaitingRoomEnabled(next);
    send({ event: "waiting-room-toggle", enabled: next });
    if (!next) setWaitingGuests([]);
  }, [send, waitingRoomEnabled]);

  const applyJoinedState = useCallback(
    (msg: Record<string, unknown>) => {
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      candidateQueueRef.current.clear();
      iceRestartTimersRef.current.forEach((t) => clearTimeout(t));
      iceRestartTimersRef.current.clear();
      setRemoteStreams({});
      setReconnecting(false);
      setConnFailed(false);
      setInWaitingRoom(false);

      myIdRef.current = msg.peerId as string;
      setMyPeerId(msg.peerId as string);
      if (msg.peers && Array.isArray(msg.peers)) {
        const names: Record<string, string> = {};
        const hands: Record<string, boolean> = {};
        const screenShare: Record<string, boolean> = {};
        msg.peers.forEach(
          (p: { id: string; name?: string; handRaised?: boolean; screenSharing?: boolean } | string) => {
            if (typeof p === "object" && p.id) {
              names[p.id] = p.name || `Peer ${p.id.slice(0, 4)}`;
              if (p.handRaised) hands[p.id] = true;
              if (p.screenSharing) screenShare[p.id] = true;
              createOfferTo(p.id);
            } else if (typeof p === "string") {
              createOfferTo(p);
            }
          }
        );
        setPeerNames(names);
        setRaisedHands(hands);
        setRemoteScreenShare(screenShare);
      } else {
        setPeerNames({});
        setRaisedHands({});
        setRemoteScreenShare({});
        ((msg.peers as string[]) || []).forEach((p: string) => createOfferTo(p));
      }
      if (userName && socketRef.current?.connected) {
        emitSignaling(socketRef.current, { event: "set-name", name: userName });
      }
      const rec = msg.recordingPeer as { peerId?: string; name?: string } | null;
      if (rec?.peerId && rec?.name) {
        setRecordingPeer({ id: rec.peerId, name: rec.name });
      } else {
        setRecordingPeer(null);
      }
      if (typeof msg.waitingRoomEnabled === "boolean") {
        setWaitingRoomEnabled(msg.waitingRoomEnabled);
      }
    },
    [createOfferTo, userName]
  );

  const handleSignalingMessage = useCallback(
    (msg: Record<string, unknown>) => {
      if (msg.event === "waiting-room") {
        setInWaitingRoom(true);
        myIdRef.current = msg.peerId as string;
      setMyPeerId(msg.peerId as string);
        return;
      }
      if (msg.event === "admitted") {
        applyJoinedState(msg);
        return;
      }
      if (msg.event === "rejected") {
        setRoomRejected(true);
        setInWaitingRoom(false);
        return;
      }
      if (msg.event === "room-full") {
        setRoomFull(true);
        setInWaitingRoom(false);
        return;
      }
      if (msg.event === "waiting-peer" && isHostJoin) {
        const pid = msg.peerId as string;
        const name = typeof msg.name === "string" && msg.name.trim()
          ? msg.name.trim()
          : `Guest ${pid.slice(0, 4)}`;
        setWaitingGuests((prev) => {
          if (prev.some((g) => g.id === pid)) return prev;
          return [...prev, { id: pid, name }];
        });
        return;
      }
      if (msg.event === "waiting-peer-updated" && isHostJoin) {
        const pid = msg.peerId as string;
        const name = String(msg.name || "").trim();
        if (!name) return;
        setWaitingGuests((prev) =>
          prev.map((g) => (g.id === pid ? { ...g, name } : g))
        );
        return;
      }
      if (msg.event === "waiting-peer-left" && isHostJoin) {
        setWaitingGuests((prev) => prev.filter((g) => g.id !== msg.peerId));
        return;
      }
      if (msg.event === "waiting-room-updated" && typeof msg.enabled === "boolean") {
        setWaitingRoomEnabled(msg.enabled);
        if (!msg.enabled) setWaitingGuests([]);
        return;
      }
      if (msg.event === "reaction" && msg.peerId && msg.emoji) {
        showPeerReaction(msg.peerId as string, String(msg.emoji));
        return;
      }
      if (msg.event === "joined") {
        applyJoinedState(msg);
        return;
      }
      if (msg.event === "new-peer") {
        createOfferTo(msg.peerId as string);
        setPeerNames((prev) => {
          const newNames = { ...prev };
          const pid = msg.peerId as string;
          if (typeof msg.name === "string" && msg.name.trim()) {
            newNames[pid] = msg.name.trim();
          } else {
            newNames[pid] = `Peer ${pid.slice(0, 4)}`;
          }
          return newNames;
        });
        return;
      }
      if (msg.event === "peer-name-updated" && msg.peerId && msg.name) {
        const trimmedName = String(msg.name).trim();
        if (trimmedName) {
          setPeerNames((prev) => ({ ...prev, [msg.peerId as string]: trimmedName }));
        }
        return;
      }
      if (msg.event === "peer-left") {
        const peerId = msg.peerId as string;
        const iceTimer = iceRestartTimersRef.current.get(peerId);
        if (iceTimer) {
          clearTimeout(iceTimer);
          iceRestartTimersRef.current.delete(peerId);
        }
        const pc = peersRef.current.get(peerId);
        if (pc) {
          pc.close();
          peersRef.current.delete(peerId);
        }
        setRemoteStreams((prev) => {
          const n = { ...prev };
          delete n[peerId];
          return n;
        });
        setPeerNames((prev) => {
          const n = { ...prev };
          delete n[peerId];
          return n;
        });
        setRaisedHands((prev) => {
          const n = { ...prev };
          delete n[peerId];
          return n;
        });
        setRemoteScreenShare((prev) => {
          const n = { ...prev };
          delete n[peerId];
          return n;
        });
        setRecordingPeer((prev) => (prev?.id === peerId ? null : prev));
        return;
      }
      if (msg.event === "hand-raised" && msg.peerId) {
        setRaisedHands((prev) => {
          const next = { ...prev };
          if (msg.raised) next[msg.peerId as string] = true;
          else delete next[msg.peerId as string];
          return next;
        });
        return;
      }
      if (msg.event === "screen-share" && msg.peerId) {
        setRemoteScreenShare((prev) => {
          const next = { ...prev };
          if (msg.active) next[msg.peerId as string] = true;
          else delete next[msg.peerId as string];
          return next;
        });
        return;
      }
      if (msg.event === "recording-started") {
        setRecordingPeer({
          id: msg.peerId as string,
          name: (msg.name as string) || `Peer ${String(msg.peerId).slice(0, 4)}`,
        });
        return;
      }
      if (msg.event === "recording-stopped") {
        setRecordingPeer((prev) => (prev?.id === msg.peerId ? null : prev));
        return;
      }
      if (msg.event === "offer") {
        const from = msg.from as string;
        let pc: RTCPeerConnection | undefined = peersRef.current.get(from);
        if (!pc) {
          pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
          peersRef.current.set(from, pc);
          attachLocalTracksToPeer(pc);
          attachPeerConnectionHandlers(from, pc, peerConnectionCtx);
        }
        const offer = JSON.parse(msg.data as string);
        if (!pc) return;
        const applyOffer = async () => {
          if (pc!.signalingState === "have-local-offer") {
            await pc!.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
          }
          await pc!.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc!.createAnswer();
          await pc!.setLocalDescription(answer);
          send({ to: from, event: "answer", data: JSON.stringify(pc!.localDescription) });
          flushCandidates(from, pc!);
        };
        applyOffer().catch(() => {});
        return;
      }
      if (msg.event === "answer") {
        const pc = peersRef.current.get(msg.from as string);
        if (!pc) return;
        pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.data as string)))
          .then(() => flushCandidates(msg.from as string, pc))
          .catch(() => {});
        return;
      }
      if (msg.event === "candidate") {
        const from = msg.from as string;
        const pc = peersRef.current.get(from);
        const c = JSON.parse(msg.data as string);
        if (pc && (pc.remoteDescription || pc.localDescription)) {
          pc.addIceCandidate(new RTCIceCandidate(c))
            .then(() => flushCandidates(from, pc))
            .catch(() => {});
        } else {
          if (!candidateQueueRef.current.has(from)) candidateQueueRef.current.set(from, []);
          candidateQueueRef.current.get(from)!.push(c);
        }
      }
    },
    [createOfferTo, send, flushCandidates, userName, attachLocalTracksToPeer, peerConnectionCtx, applyJoinedState, showPeerReaction, isHostJoin]
  );

  const resetPeerConnections = useCallback(() => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    candidateQueueRef.current.clear();
    iceRestartTimersRef.current.forEach((t) => clearTimeout(t));
    iceRestartTimersRef.current.clear();
    setRemoteStreams({});
  }, []);

  const connectRoomSocket = useCallback(() => {
    if (!sessionToken || !localStreamRef.current || !userName) return;
    if (socketRef.current?.connected) return;

    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    leavingRoomRef.current = false;
    const socket = createRoomSocket(uuid, sessionToken);
    socketRef.current = socket;
    setReconnecting(false);
    setConnFailed(false);

    socket.on("connect", () => {
      if (leavingRoomRef.current) return;
      setReconnecting(false);
      setConnFailed(false);
      setRoomSocket(socket);
      if (userName) emitSignaling(socket, { event: "set-name", name: userName });
    });

    socket.on("disconnect", () => {
      if (leavingRoomRef.current) return;
      setRoomSocket(null);
      setReconnecting(true);
      resetPeerConnections();
    });

    socket.io.on("reconnect_failed", () => {
      if (leavingRoomRef.current) return;
      setReconnecting(false);
      setConnFailed(true);
    });

    socket.on("signaling", handleSignalingMessage);
    socket.on("viewer:count", (count: number) => setViewerCount(String(count)));
  }, [uuid, sessionToken, userName, handleSignalingMessage, resetPeerConnections]);

  useEffect(() => {
    if (userName && socketRef.current?.connected) {
      emitSignaling(socketRef.current, { event: "set-name", name: userName });
    }
  }, [userName]);

  useEffect(() => {
    if (!sessionToken || !userName) return;
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { max: 1280 }, height: { max: 720 }, frameRate: 30 },
        audio: { echoCancellation: true },
      })
      .then((stream) => {
        setNoPerm(false);
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        setIsMuted(audioTracks.length > 0 && !audioTracks[0].enabled);
        setIsVideoEnabled(videoTracks.length > 0 && videoTracks[0].enabled);
        connectRoomSocket();
      })
      .catch(() => setNoPerm(true));
    return () => {
      leavingRoomRef.current = true;
      clearScreenShareRetries();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      isScreenSharingRef.current = false;
      iceRestartTimersRef.current.forEach((t) => clearTimeout(t));
      iceRestartTimersRef.current.clear();
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
      setRoomSocket(null);
      peersRef.current.forEach((pc) => pc.close());
    };
  }, [sessionToken, connectRoomSocket, userName, clearScreenShareRetries]);

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

  // Toggle video on/off (disabled while screen sharing — screen track is separate)
  const toggleVideo = useCallback(() => {
    if (isScreenSharingRef.current) return;
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    const newVideoEnabled = !isVideoEnabled;
    videoTracks.forEach((track) => {
      track.enabled = newVideoEnabled;
    });
    setIsVideoEnabled(newVideoEnabled);

    peersRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === "video") {
          sender.track.enabled = newVideoEnabled;
        }
      });
    });
  }, [isVideoEnabled]);

  const stopScreenShare = useCallback(async () => {
    if (!isScreenSharingRef.current && !screenStreamRef.current) return;

    clearScreenShareRetries();
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    isScreenSharingRef.current = false;
    setIsScreenSharing(false);
    send({ event: "screen-share", active: false });

    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraTrack) {
      cameraTrack.enabled = isVideoEnabled;
      await replaceVideoTrackOnAllPeers(cameraTrack);
      await renegotiateAllPeers();
    }
    updateLocalPreview();
  }, [
    clearScreenShareRetries,
    isVideoEnabled,
    replaceVideoTrackOnAllPeers,
    renegotiateAllPeers,
    send,
    updateLocalPreview,
  ]);

  const startScreenShare = useCallback(async () => {
    if (isScreenSharingRef.current) return;

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      const screenVideoTrack = screenStream.getVideoTracks()[0];
      if (!screenVideoTrack) {
        screenStream.getTracks().forEach((t) => t.stop());
        return;
      }

      screenVideoTrack.contentHint = "detail";
      screenStreamRef.current = screenStream;
      isScreenSharingRef.current = true;
      setIsScreenSharing(true);

      send({ event: "screen-share", active: true });

      await replaceVideoTrackOnAllPeers(screenVideoTrack);
      await renegotiateAllPeers();
      scheduleScreenShareRetries(screenVideoTrack);
      updateLocalPreview();

      screenVideoTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError" || name === "AbortError") return;
      console.error("Screen share error:", err);
      alert("Screen sharing failed. Allow permission and try again.");
    }
  }, [
    replaceVideoTrackOnAllPeers,
    renegotiateAllPeers,
    scheduleScreenShareRetries,
    send,
    stopScreenShare,
    updateLocalPreview,
  ]);

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
      const recordingStartedAt = new Date();
      recordingStartedAtRef.current = recordingStartedAt;

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
      const { stream: compositeStream, cleanup } = await createMeetingCompositeStream(
        getParticipants,
        {
          roomName: roomDisplayName || "Meeting",
          startedAt: recordingStartedAt,
        }
      );
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
          const recordedAt = recordingStartedAtRef.current ?? new Date();
          const formData = new FormData();
          const filename = buildRecordingFilename({
            roomId: uuid,
            roomName: roomDisplayName,
            date: recordedAt,
            ext: "webm",
          });
          formData.append("file", blob, filename);
          formData.append("roomId", uuid);
          formData.append("sessionToken", sessionToken || "");
          formData.append("roomName", roomDisplayName || "Meeting");
          formData.append("recordedAt", recordedAt.toISOString());
          const res = await fetch("/api/recordings", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) throw new Error("Upload failed");
          const data = await res.json();
          setRecordingStatus("saved");
          setRecordingSavedLabel(
            typeof data.recordedAtDisplay === "string" ? data.recordedAtDisplay : null
          );
          setIsRecording(false);
          setTimeout(() => {
            setRecordingStatus("idle");
            setRecordingSavedLabel(null);
          }, 4000);
          const a = document.createElement("a");
          if (data.downloadUrl) {
            const blobRes = await fetch(data.downloadUrl);
            const fileBlob = await blobRes.blob();
            a.href = URL.createObjectURL(fileBlob);
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
          const recordedAt = recordingStartedAtRef.current ?? new Date();
          const fallbackName = buildRecordingFilename({
            roomId: uuid,
            roomName: roomDisplayName,
            date: recordedAt,
            ext: "webm",
          });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = fallbackName;
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
  }, [uuid, roomDisplayName, sessionToken, isScreenSharing, remoteStreams, peerNames, userName, send]);

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

  const renderReactions = (peerId: string) =>
    (peerReactions[peerId] || []).map((r) => (
      <span key={r.id} className="video-tile-reaction" aria-hidden>
        {r.emoji}
      </span>
    ));

  if (authState === "loading") {
    return (
      <div className="landing">
        <PageBackground />
        <header className="landing-nav">
          <Link href="/" className="landing-brand">
            <span className="landing-brand-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </span>
            NexusRTC
          </Link>
        </header>
        <main className="create-room-main">
          <LoadingSpinner label="Connecting to room…" />
        </main>
      </div>
    );
  }

  if (authState === "notfound") {
    return (
      <div className="landing">
        <PageBackground />
        <header className="landing-nav">
          <Link href="/" className="landing-brand">
            <span className="landing-brand-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </span>
            NexusRTC
          </Link>
          <ThemeToggle />
        </header>
        <main className="create-room-main">
          <div className="status-card">
            <div className="status-card-icon status-card-icon--danger" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h1 className="status-card-title">Room not found</h1>
            <p className="status-card-text">
              This room doesn&apos;t exist or the server was restarted. Ask the host for a new link.
            </p>
            <div className="status-card-actions">
              <Link href="/room/create" className="btn btn-primary">
                Create a room
              </Link>
              <Link href="/" className="btn btn-ghost">
                Go home
              </Link>
            </div>
          </div>
        </main>
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
          {isHostJoin && (
            <button
              type="button"
              className={`waiting-room-toggle ${waitingRoomEnabled ? "is-on" : ""}`}
              onClick={toggleWaitingRoom}
              title={waitingRoomEnabled ? "Waiting room on — guests need approval" : "Waiting room off — guests join directly"}
              aria-pressed={waitingRoomEnabled}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>{waitingRoomEnabled ? "Lobby on" : "Lobby off"}</span>
            </button>
          )}
        </div>
        <div className="room-nav-actions">
          <CopyLinkButton roomLink={roomLink} copy={copy} />
          <ThemeToggle />
          <Link href="/" className="btn btn-danger btn-sm room-leave-btn">
            Leave
          </Link>
        </div>
      </header>

      <Chat socket={roomSocket} chatKey={chatKey} encrypted={!!chatKey} />

      {isHostJoin && waitingRoomEnabled && waitingGuests.length > 0 && (
        <aside className="waiting-room-panel" role="region" aria-label="Waiting room">
          <div className="waiting-room-panel-head">
            <h3>Waiting to join ({waitingGuests.length})</h3>
            <button type="button" className="btn btn-primary btn-sm" onClick={admitAllGuests}>
              Admit all
            </button>
          </div>
          <ul className="waiting-room-list">
            {waitingGuests.map((guest) => (
              <li key={guest.id} className="waiting-room-item">
                <span>{guest.name}</span>
                <div className="waiting-room-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => admitGuest(guest.id)}>
                    Admit
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => rejectGuest(guest.id)}>
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <main className="room-main">
      {inWaitingRoom && (
        <div className="waiting-room-overlay">
          <div className="status-card">
            <h2 className="status-card-title">Waiting for host</h2>
            <p className="status-card-text">The host will let you in shortly…</p>
            <LoadingSpinner label="In waiting room" />
          </div>
        </div>
      )}

      {roomRejected && (
        <div className="room-main-center">
          <div className="status-card">
            <h2 className="status-card-title">Entry denied</h2>
            <p className="status-card-text">The host declined your request to join.</p>
            <Link href="/" className="btn btn-primary">Go home</Link>
          </div>
        </div>
      )}

      {roomFull && (
        <div className="room-main-center">
          <div className="status-card">
            <h2 className="status-card-title">Room is full</h2>
            <p className="status-card-text">This meeting has reached the maximum number of participants.</p>
            <Link href="/" className="btn btn-primary">Go home</Link>
          </div>
        </div>
      )}

      {!inWaitingRoom && !roomRejected && !roomFull && (
        <>
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
              const sharingScreen = !!remoteScreenShare[primaryPeerId];
              const peerName = peerNames[primaryPeerId] || `Peer ${primaryPeerId.slice(0, 4)}`;
              const videoKey = `${primaryPeerId}-${remoteVideoEpoch[primaryPeerId] ?? 0}-${remoteVideoTrackId(stream)}`;
              return (
                <div
                  key={primaryPeerId}
                  className={`video-tile video-tile--primary ${handUp ? "video-tile--hand-raised" : ""} ${sharingScreen ? "video-tile--screen-share" : ""}`}
                >
                  <RemoteVideo
                    key={videoKey}
                    stream={stream}
                    isScreenShare={sharingScreen}
                    onVideoTrackChange={() => bumpRemoteVideo(primaryPeerId)}
                  />
                  {handUp && <span className="video-tile-hand" title="Hand raised">✋</span>}
                  <span className="video-tile-label">{peerName}</span>
                  {sharingScreen && (
                    <div className="screen-share-indicator">
                      <span>Sharing Screen</span>
                    </div>
                  )}
                  {renderReactions(primaryPeerId)}
                </div>
              );
            })()}
            <div className={`video-tile you ${useFocusLayout && !primaryPeerId ? "video-tile--primary" : ""} ${localHandUp ? "video-tile--hand-raised" : ""} ${isScreenSharing ? "video-tile--screen-share" : ""}`}>
              <video ref={localVideoRef} className={isScreenSharing ? "video-screen-share" : "mirror"} autoPlay muted playsInline style={{ opacity: isVideoEnabled || isScreenSharing ? 1 : 0.3 }} />
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
              {myPeerId && renderReactions(myPeerId)}
              {isRecording && (
                <div className="recording-indicator">
                  <span className="recording-dot" />
                  <span>
                    {recordingStatus === "uploading"
                      ? "Saving…"
                      : recordingStatus === "saved"
                        ? recordingSavedLabel
                          ? `Saved · ${recordingSavedLabel}`
                          : "Saved!"
                        : recordingStatus === "error"
                          ? "Save failed"
                          : "Recording"}
                  </span>
                </div>
              )}
            </div>
            {reconnecting && (
              <div className="room-alert room-alert-warning" role="status">
                Reconnecting…
              </div>
            )}
            {connFailed && (
              <div className="room-alert room-alert-danger">
                Connection lost. Refresh the page to rejoin.
              </div>
            )}
            {orderedRemoteIds
              .filter((peerId) => !(useFocusLayout && primaryPeerId && peerId === primaryPeerId))
              .map((peerId) => {
                const stream = remoteStreams[peerId];
                if (!stream?.getTracks().length) return null;
                const handUp = !!raisedHands[peerId];
                const sharingScreen = !!remoteScreenShare[peerId];
                const peerName = peerNames[peerId] || `Peer ${peerId.slice(0, 4)}`;
                const videoKey = `${peerId}-${remoteVideoEpoch[peerId] ?? 0}-${remoteVideoTrackId(stream)}`;
                return (
                  <div
                    key={peerId}
                    className={`video-tile ${handUp ? "video-tile--hand-raised" : ""} ${sharingScreen ? "video-tile--screen-share" : ""}`}
                  >
                    <RemoteVideo
                      key={videoKey}
                      stream={stream}
                      isScreenShare={sharingScreen}
                      onVideoTrackChange={() => bumpRemoteVideo(peerId)}
                    />
                    {handUp && <span className="video-tile-hand" title="Hand raised">✋</span>}
                    <span className="video-tile-label">{peerName}</span>
                    {sharingScreen && (
                      <div className="screen-share-indicator">
                        <span>Sharing Screen</span>
                      </div>
                    )}
                    {renderReactions(peerId)}
                  </div>
                );
              })}
          </div>
          {!hasPeers && !reconnecting && !connFailed && (
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
          onSendReaction={sendReaction}
        />
      )}
        </>
      )}
      </main>
    </div>
  );
}
