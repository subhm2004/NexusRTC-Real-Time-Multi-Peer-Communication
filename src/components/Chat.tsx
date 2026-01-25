"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const CHAT_NAME_KEY = "nexus-chat-name";

function currentTime() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function getOrCreateUserName(): string {
  if (typeof window === "undefined") return "User";
  const stored = localStorage.getItem(CHAT_NAME_KEY);
  if (stored?.trim()) return stored.trim();
  const name = "User_" + Math.random().toString(36).slice(2, 7);
  localStorage.setItem(CHAT_NAME_KEY, name);
  return name;
}

function parseChatMessage(raw: string): string {
  try {
    const d = JSON.parse(raw);
    if (d && typeof d.n === "string" && typeof d.m === "string")
      return `${currentTime()} - ${d.n}: ${d.m}`;
  } catch {
    // backward compat: plain text
  }
  return `${currentTime()} - Unknown: ${raw}`;
}

export function Chat({ wsUrl }: { wsUrl: string }) {
  const [userName, setUserName] = useState("User");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasNew, setHasNew] = useState(false);
  const [ready, setReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  const userNameInit = useRef(false);
  openRef.current = open;

  useEffect(() => {
    if (!userNameInit.current && typeof window !== "undefined") {
      setUserName(getOrCreateUserName());
      userNameInit.current = true;
    }
  }, []);

  const connect = useCallback(() => {
    if (!wsUrl || typeof window === "undefined") return;
    if (wsRef.current?.readyState === 1) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onclose = () => {
      setReady(false);
      wsRef.current = null;
      setTimeout(connect, 1000);
    };
    ws.onopen = () => setReady(true);
    ws.onmessage = (e) => {
      const t = parseChatMessage(e.data as string);
      setLogs((prev) => [...prev, t]);
      if (!openRef.current) setHasNew(true);
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    };
  }, [wsUrl]);

  useEffect(() => {
    if (wsUrl) connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, connect]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const inp = inputRef.current;
    const text = inp?.value?.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ n: userName, m: text }));
    inp!.value = "";
  };

  const saveName = () => {
    const v = nameInput.trim();
    if (v) {
      setUserName(v);
      if (typeof window !== "undefined") localStorage.setItem(CHAT_NAME_KEY, v);
    }
    setEditingName(false);
  };

  const slide = () => {
    setOpen((o) => !o);
    if (!open) {
      setHasNew(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  return (
    <div className={"chat-box" + (open ? " is-open" : "")}>
      <div className="chat-header" onClick={slide}>
        <span>Chat</span>
        <span className="chat-header-you" onClick={(e) => e.stopPropagation()}>
          {editingName ? (
            <input
              className="chat-name-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => (e.key === "Enter" ? saveName() : null)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Your name"
              autoFocus
            />
          ) : (
            <span
              className="chat-you"
              onClick={(e) => {
                e.stopPropagation();
                setNameInput(userName);
                setEditingName(true);
              }}
              title="Click to change name"
            >
              (You: {userName})
            </span>
          )}
        </span>
        {hasNew && <span className="chat-dot" />}
      </div>
      <div className="chat-body">
        <div className="chat-messages">
          {logs.map((l, i) => (
            <div key={i} className="chat-msg">
              {l}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
        <form className="chat-form" onSubmit={send}>
          <input
            ref={inputRef}
            className="chat-input"
            type="text"
            placeholder="Type a message..."
          />
          <button type="submit" className="chat-send" disabled={!ready}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
