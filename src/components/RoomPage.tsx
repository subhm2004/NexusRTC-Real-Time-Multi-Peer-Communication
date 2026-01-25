"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "./Chat";

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} autoPlay playsInline />;
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

export function RoomPage({ uuid, roomLink }: { uuid: string; roomLink: string }) {
  const [wsBase, setWsBase] = useState("");
  const [noPerm, setNoPerm] = useState(false);
  const [connClosed, setConnClosed] = useState(false);
  const [viewerCount, setViewerCount] = useState("0");
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const candidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  useEffect(() => {
    setWsBase(getWsBase());
  }, []);

  const roomWsUrl = wsBase ? `${wsBase}/room/${uuid}/websocket` : "";
  const chatWsUrl = wsBase ? `${wsBase}/room/${uuid}/chat/websocket` : "";
  const viewerWsUrl = wsBase ? `${wsBase}/room/${uuid}/viewer/websocket` : "";

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {});
  };

  const send = useCallback((msg: { to?: string; event: string; data?: string }) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(msg));
  }, []);

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
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ to: peerId, event: "candidate", data: JSON.stringify(e.candidate.toJSON()) });
      };
      pc.ontrack = (e) => {
        const s = e.streams?.[0] || new MediaStream([e.track]);
        setRemoteStreams((prev) => {
          const ex = prev[peerId];
          if (ex && !ex.getTracks().includes(e.track)) {
            ex.addTrack(e.track);
            return { ...prev };
          }
          return { ...prev, [peerId]: s };
        });
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => send({ to: peerId, event: "offer", data: JSON.stringify(pc.localDescription) }))
        .catch(() => {});
    },
    [send]
  );

  const connectRoomWs = useCallback(() => {
    if (!roomWsUrl || !localStreamRef.current) return;
    if (wsRef.current?.readyState === 1) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    const ws = new WebSocket(roomWsUrl);
    wsRef.current = ws;
    setConnClosed(false);

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

      if (msg.event === "joined") {
        myIdRef.current = msg.peerId;
        (msg.peers || []).forEach((p: string) => createOfferTo(p, stream));
        return;
      }
      if (msg.event === "new-peer") {
        createOfferTo(msg.peerId, stream);
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
        return;
      }
      if (msg.event === "offer") {
        const from = msg.from;
        let pc = peersRef.current.get(from);
        if (!pc) {
          pc = new RTCPeerConnection(ICE);
          peersRef.current.set(from, pc);
          pc.onicecandidate = (e) => {
            if (e.candidate) send({ to: from, event: "candidate", data: JSON.stringify(e.candidate.toJSON()) });
          };
          pc.ontrack = (e) => {
            const s = e.streams?.[0] || new MediaStream([e.track]);
            setRemoteStreams((prev) => {
              const ex = prev[from];
              if (ex && !ex.getTracks().includes(e.track)) {
                ex.addTrack(e.track);
                return { ...prev };
              }
              return { ...prev, [from]: s };
            });
          };
        }
        const offer = JSON.parse(msg.data);
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => pc!.createAnswer())
          .then((a) => pc!.setLocalDescription(a))
          .then(() => send({ to: from, event: "answer", data: JSON.stringify(pc!.localDescription) }))
          .then(() => flushCandidates(from, pc!))
          .catch(() => {});
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
  }, [roomWsUrl, createOfferTo, send, flushCandidates]);

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

  // getUserMedia + connect
  useEffect(() => {
    if (!roomWsUrl) return;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { max: 1280 }, height: { max: 720 }, frameRate: 30 }, audio: { echoCancellation: true } })
      .then((stream) => {
        setNoPerm(false);
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        connectRoomWs();
      })
      .catch(() => setNoPerm(true));
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      wsRef.current?.close();
      peersRef.current.forEach((pc) => pc.close());
    };
  }, [roomWsUrl, connectRoomWs]);

  const hasPeers = Object.keys(remoteStreams).length > 0;

  return (
    <div className="app-wrap">
      <nav className="app-nav">
        <Link href="/" className="app-nav-brand">
          NexusRTC
        </Link>
        <div className="app-nav-end">
          <CopyLinkButton roomLink={roomLink} copy={copy} />
          <Link href="/" className="btn btn-danger btn-sm">
            Leave Room
          </Link>
        </div>
      </nav>

      <Chat wsUrl={chatWsUrl} />

      <div className="viewer-badge">Viewers: {viewerCount}</div>

      {noPerm && (
        <div className="notif notif-info">
          Camera and microphone permissions are needed to join.
        </div>
      )}

      {!noPerm && (
        <div id="peers">
          <div className="video-grid" id="videos">
            <div className="video-tile you">
              <video ref={localVideoRef} className="mirror" autoPlay muted playsInline />
              <span className="video-tile-label">You</span>
            </div>
            {!hasPeers && !connClosed && (
              <div className="notif notif-warn" style={{ gridColumn: "1 / -1" }}>
                No one else in the room yet. Share your room link with friends.
              </div>
            )}
            {connClosed && (
              <div className="notif notif-danger" style={{ gridColumn: "1 / -1" }}>
                Connection closed. Please refresh the page.
              </div>
            )}
            {Object.entries(remoteStreams).map(([peerId, stream]) => (
              <div key={peerId} className="video-tile">
                <RemoteVideo stream={stream} />
                <span className="video-tile-label">Peer</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p></p>
      </footer>
    </div>
  );
}
