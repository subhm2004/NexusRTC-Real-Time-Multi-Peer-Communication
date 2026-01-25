"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "./Chat";

const ICE = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function getWsBase() {
  if (typeof window === "undefined") return "";
  return (window.location.protocol === "https:" ? "wss:" : "ws:") + "//" + window.location.host;
}

export function StreamPage({ suuid }: { suuid: string }) {
  const [wsBase, setWsBase] = useState("");
  const [exists, setExists] = useState<boolean | null>(null);
  const [connClosed, setConnClosed] = useState(false);
  const [viewerCount, setViewerCount] = useState("0");
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const candidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  useEffect(() => {
    setWsBase(getWsBase());
  }, []);

  useEffect(() => {
    fetch(`/api/stream/${suuid}/exists`)
      .then((r) => r.json())
      .then((d) => setExists(d.exists))
      .catch(() => setExists(false));
  }, [suuid]);

  const streamWsUrl = wsBase ? `${wsBase}/stream/${suuid}/websocket` : "";
  const chatWsUrl = wsBase ? `${wsBase}/stream/${suuid}/chat/websocket` : "";
  const viewerWsUrl = wsBase ? `${wsBase}/stream/${suuid}/viewer/websocket` : "";

  const send = useCallback((msg: { to?: string; event: string; data?: string }) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(msg));
  }, []);

  const flushCandidates = useCallback((peerId: string, pc: RTCPeerConnection) => {
    const q = candidateQueueRef.current.get(peerId);
    if (!q?.length) return;
    q.forEach((c) => pc.addIceCandidate(c).catch(() => {}));
    candidateQueueRef.current.delete(peerId);
  }, []);

  const checkExists = useCallback(() => {
    setExists(null);
    fetch(`/api/stream/${suuid}/exists`)
      .then((r) => r.json())
      .then((d) => setExists(d.exists))
      .catch(() => setExists(false));
  }, [suuid]);

  const connectStreamWs = useCallback(() => {
    if (!streamWsUrl) return;
    if (wsRef.current?.readyState === 1) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    const ws = new WebSocket(streamWsUrl);
    wsRef.current = ws;
    setConnClosed(false);

    ws.onclose = () => {
      setConnClosed(true);
      wsRef.current = null;
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      setRemoteStreams({});
      setTimeout(connectStreamWs, 1000);
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);

      if (msg.event === "joined") {
        // viewer: we don't create offers; we wait for offers from publishers
        return;
      }
      if (msg.event === "new-peer") {
        // we're viewer, do nothing
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
            if (e.track.kind === "video") setRemoteStreams((prev) => ({ ...prev, [from]: e.streams[0] }));
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
        // as viewer we don't send offers, so we shouldn't get answers
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
  }, [streamWsUrl, send, flushCandidates]);

  useEffect(() => {
    if (streamWsUrl && exists) connectStreamWs();
    return () => {
      wsRef.current?.close();
      peersRef.current.forEach((pc) => pc.close());
    };
  }, [streamWsUrl, exists, connectStreamWs]);

  const viewerWsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (!viewerWsUrl || !exists) return;
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
  }, [viewerWsUrl, exists]);

  if (exists === null) {
    return (
      <div className="app-wrap">
        <div className="loading-wrap">Loading…</div>
      </div>
    );
  }

  if (!exists) {
    return (
      <div className="app-wrap">
        <nav className="app-nav">
          <Link href="/" className="app-nav-brand">NexusRTC</Link>
          <Link href="/" className="btn btn-danger btn-sm">Leave</Link>
        </nav>
        <div className="notif notif-danger">
          This stream doesn’t exist. Please check the link or try another.
        </div>
        <div style={{ marginTop: "1rem" }}>
          <button type="button" className="btn btn-ghost" onClick={checkExists}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const hasPeers = Object.keys(remoteStreams).length > 0;

  return (
    <div className="app-wrap">
      <nav className="app-nav">
        <Link href="/" className="app-nav-brand">NexusRTC</Link>
        <div className="app-nav-end">
          <Link href="/" className="btn btn-danger btn-sm">Leave Stream</Link>
        </div>
      </nav>

      <Chat wsUrl={chatWsUrl} />

      <div className="viewer-badge">Viewers: {viewerCount}</div>

      <div id="peers">
        <div className="video-grid" id="videos">
          {!hasPeers && !connClosed && (
            <div className="notif notif-info" style={{ gridColumn: "1 / -1" }}>
              No streamer in the room yet. Waiting for the host.
            </div>
          )}
          {connClosed && (
            <div className="notif notif-danger" style={{ gridColumn: "1 / -1" }}>
              Connection closed. Please refresh the page.
            </div>
          )}
          {Object.entries(remoteStreams).map(([peerId, stream]) => (
            <div key={peerId} className="video-tile">
              <video
                autoPlay
                playsInline
                ref={(el) => {
                  if (el) el.srcObject = stream;
                }}
              />
              <span className="video-tile-label">Live</span>
            </div>
          ))}
        </div>
      </div>

      <footer className="app-footer"><p></p></footer>
    </div>
  );
}
