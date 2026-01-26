"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "./Chat";
import { ThemeToggle } from "./ThemeToggle";

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

function NameInputModal({ onJoin }: { onJoin: (name: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if name already exists in localStorage
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(CHAT_NAME_KEY);
      if (stored?.trim()) {
        setName(stored.trim());
      }
    }
    // Focus input
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

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
      <div className="name-modal">
        <h2 className="name-modal-title">Enter Your Name</h2>
        <p className="name-modal-subtitle">Choose a name to join the room</p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="name-modal-input"
            placeholder="Your name"
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
            Join Room
          </button>
        </form>
      </div>
    </div>
  );
}

export function RoomPage({ uuid, roomLink }: { uuid: string; roomLink: string }) {
  const [wsBase, setWsBase] = useState("");
  const [noPerm, setNoPerm] = useState(false);
  const [connClosed, setConnClosed] = useState(false);
  const [viewerCount, setViewerCount] = useState("0");
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [userName, setUserName] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});

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
    [send]
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

      if (msg.event === "joined") {
        myIdRef.current = msg.peerId;
        // Store peer names from the joined message
        if (msg.peers && Array.isArray(msg.peers)) {
          const names: Record<string, string> = {};
          msg.peers.forEach((p: { id: string; name?: string } | string) => {
            if (typeof p === 'object' && p.id) {
              names[p.id] = p.name || `Peer ${p.id.slice(0, 4)}`;
              createOfferTo(p.id, stream);
            } else if (typeof p === 'string') {
              // Backward compatibility
              createOfferTo(p, stream);
            }
          });
          setPeerNames(names);
        } else {
          // Backward compatibility
          (msg.peers || []).forEach((p: string) => createOfferTo(p, stream));
        }
        // Name should already be sent in onopen, but send again to be sure
        if (userName && ws.readyState === 1) {
          ws.send(JSON.stringify({ event: "set-name", name: userName }));
        }
        return;
      }
      if (msg.event === "new-peer") {
        createOfferTo(msg.peerId, stream);
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
        return;
      }
      if (msg.event === "offer") {
        const from = msg.from;
        let pc: RTCPeerConnection | undefined = peersRef.current.get(from);
        if (!pc) {
          pc = new RTCPeerConnection(ICE);
          peersRef.current.set(from, pc);
          
          // Add local tracks to the connection
          stream.getTracks().forEach((t) => pc!.addTrack(t, stream));
          
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
  }, [roomWsUrl, createOfferTo, send, flushCandidates, userName]);

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
      wsRef.current?.close();
      peersRef.current.forEach((pc) => pc.close());
    };
  }, [roomWsUrl, connectRoomWs, userName]);

  const hasPeers = Object.keys(remoteStreams).length > 0;

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

  // Show name input modal if name not set
  if (!userName) {
    return <NameInputModal onJoin={(name) => setUserName(name)} />;
  }

  return (
    <div className="app-wrap">
      <nav className="app-nav">
        <Link href="/" className="app-nav-brand">
          NexusRTC
        </Link>
        <div className="app-nav-end">
          <a
            href="https://github.com/subhm2004/NexusRTC-Real-Time-Multi-Peer-Communication"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
            title="View on GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
          <ThemeToggle />
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
              <video ref={localVideoRef} className="mirror" autoPlay muted playsInline style={{ opacity: isVideoEnabled ? 1 : 0.3 }} />
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
              <span className="video-tile-label">{userName}</span>
              <div className="video-controls">
                <button
                  type="button"
                  className={`video-control-btn ${isMuted ? 'active' : ''}`}
                  onClick={toggleMute}
                  title={isMuted ? 'Unmute' : 'Mute'}
                  aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {isMuted ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1L8 5H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4l4 4V1z" />
                      <line x1="23" y1="1" x2="1" y2="23" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1L8 5H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4l4 4V1z" />
                      <path d="M19 10a2 2 0 0 0-2-2m-2 4a2 2 0 0 0 2 2m2-4a2 2 0 0 1 2 2m-2-4v4m0-4a2 2 0 0 0-2-2" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className={`video-control-btn ${!isVideoEnabled ? 'active' : ''}`}
                  onClick={toggleVideo}
                  title={isVideoEnabled ? 'Turn off video' : 'Turn on video'}
                  aria-label={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
                >
                  {isVideoEnabled ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 7l-7 5 7 5V7z" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 7l-7 5 7 5V7z" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      <line x1="1" y1="1" x2="16" y2="16" />
                    </svg>
                  )}
                </button>
              </div>
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
            {Object.entries(remoteStreams).map(([peerId, stream]) => {
              const trackCount = stream.getTracks().length;
              const videoTracks = stream.getVideoTracks().length;
              const audioTracks = stream.getAudioTracks().length;
              
              console.log(`Rendering peer ${peerId}: ${trackCount} total tracks (${videoTracks} video, ${audioTracks} audio)`);
              
              if (trackCount === 0) {
                console.log(`Skipping peer ${peerId} - no tracks`);
                return null;
              }
              
              const peerName = peerNames[peerId] || `Peer ${peerId.slice(0, 4)}`;
              
              return (
                <div key={peerId} className="video-tile">
                  <RemoteVideo stream={stream} />
                  <span className="video-tile-label">{peerName}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Debug info - remove in production */}
      {process.env.NODE_ENV === 'development' && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-muted)', borderRadius: 'var(--radius)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <div>Remote streams: {Object.keys(remoteStreams).length}</div>
          <div>Peers connected: {peersRef.current.size}</div>
          {Object.entries(remoteStreams).map(([pid, s]) => (
            <div key={pid}>
              {pid.slice(0, 8)}: {s.getTracks().length} tracks (V:{s.getVideoTracks().length} A:{s.getAudioTracks().length})
            </div>
          ))}
        </div>
      )}

      <footer className="app-footer">
        <p></p>
      </footer>
    </div>
  );
}
