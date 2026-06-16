"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitChat, type RoomSocket } from "@/lib/socket-client";
import {
  decryptChatPayload,
  encryptChatPayload,
  isEncryptedEnvelope,
  wrapEncryptedEnvelope,
} from "@/lib/chat-crypto";

const CHAT_NAME_KEY = "nexus-chat-name";
const TYPING_TIMEOUT = 3000;
const TYPING_DEBOUNCE = 500;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type ChatLogEntry = {
  type: "message" | "typing" | "image";
  name?: string;
  text?: string;
  image?: string;
  time?: string;
};

function currentTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getOrCreateUserName(): string {
  if (typeof window === "undefined") return "User";
  const stored = localStorage.getItem(CHAT_NAME_KEY);
  if (stored?.trim()) return stored.trim();
  const name = "User_" + Math.random().toString(36).slice(2, 7);
  localStorage.setItem(CHAT_NAME_KEY, name);
  return name;
}

async function resolveIncomingPayload(
  raw: Record<string, unknown>,
  chatKey: CryptoKey | null
): Promise<Record<string, unknown> | null> {
  if (isEncryptedEnvelope(raw)) {
    if (!chatKey) return null;
    return decryptChatPayload(chatKey, raw.c);
  }
  return raw;
}

function payloadToLogEntry(d: Record<string, unknown>): ChatLogEntry | null {
  if (d?.type === "image" && typeof d.n === "string" && typeof d.url === "string") {
    return { type: "image", name: d.n, image: d.url, time: currentTime() };
  }
  if (typeof d?.n === "string" && typeof d?.m === "string") {
    return { type: "message", name: d.n, text: d.m, time: currentTime() };
  }
  return null;
}

export function Chat({
  socket,
  chatKey,
  encrypted = false,
}: {
  socket: RoomSocket | null;
  chatKey?: CryptoKey | null;
  encrypted?: boolean;
}) {
  const [userName, setUserName] = useState("User");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<ChatLogEntry[]>([]);
  const [hasNew, setHasNew] = useState(false);
  const [ready, setReady] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const openRef = useRef(open);
  const userNameInit = useRef(false);
  const recentMsgKeysRef = useRef<string[]>([]);
  const userNameRef = useRef(userName);
  const chatKeyRef = useRef(chatKey ?? null);
  openRef.current = open;
  userNameRef.current = userName;
  chatKeyRef.current = chatKey ?? null;

  const appendLog = useCallback((entry: ChatLogEntry) => {
    if (entry.type === "message") {
      const key = `m:${entry.name}:${entry.text}`;
      if (recentMsgKeysRef.current.includes(key)) return;
      recentMsgKeysRef.current.push(key);
      if (recentMsgKeysRef.current.length > 80) {
        recentMsgKeysRef.current = recentMsgKeysRef.current.slice(-40);
      }
    }
    if (entry.type === "image") {
      const key = `i:${entry.name}:${entry.image?.slice(0, 80)}`;
      if (recentMsgKeysRef.current.includes(key)) return;
      recentMsgKeysRef.current.push(key);
    }
    setLogs((prev) => [...prev, entry]);
    if (!openRef.current) setHasNew(true);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const processPayload = useCallback(
    async (raw: string | Record<string, unknown>) => {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== "object") return;

      if (parsed.type === "history" && Array.isArray(parsed.messages)) {
        for (const msg of parsed.messages) {
          if (!msg || typeof msg !== "object") continue;
          const resolved = await resolveIncomingPayload(
            msg as Record<string, unknown>,
            chatKeyRef.current
          );
          if (!resolved) continue;
          const entry = payloadToLogEntry(resolved);
          if (entry) appendLog(entry);
        }
        return;
      }

      if (parsed.type === "typing" && typeof parsed.n === "string") {
        if (parsed.n !== userNameRef.current) {
          setTypingUsers((prev) => new Set(prev).add(parsed.n as string));
          setTimeout(() => {
            setTypingUsers((p) => {
              const n = new Set(p);
              n.delete(parsed.n as string);
              return n;
            });
          }, TYPING_TIMEOUT);
        }
        return;
      }

      const resolved = await resolveIncomingPayload(
        parsed as Record<string, unknown>,
        chatKeyRef.current
      );
      if (!resolved) return;

      if (resolved.type === "typing") return;

      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (typeof resolved.n === "string") next.delete(resolved.n);
        return next;
      });

      const entry = payloadToLogEntry(resolved);
      if (entry) appendLog(entry);
    },
    [appendLog]
  );

  useEffect(() => {
    if (!userNameInit.current && typeof window !== "undefined") {
      setUserName(getOrCreateUserName());
      userNameInit.current = true;
    }
  }, []);

  useEffect(() => {
    if (!socket) {
      setReady(false);
      return;
    }

    const onConnect = () => setReady(true);
    const onDisconnect = () => setReady(false);
    const onChat = (payload: string | Record<string, unknown>) => {
      processPayload(payload).catch(() => {
        if (typeof payload === "string") {
          appendLog({ type: "message", name: "Unknown", text: payload, time: currentTime() });
        }
      });
    };

    if (socket.connected) setReady(true);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("chat", onChat);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("chat", onChat);
    };
  }, [socket, appendLog, processPayload]);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".chat-emoji-picker") && !target.closest(".chat-emoji-btn")) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmojiPicker]);

  const emitPayload = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!socket?.connected) return;
      const key = chatKeyRef.current;
      if (key && encrypted) {
        const token = await encryptChatPayload(key, payload);
        emitChat(socket, wrapEncryptedEnvelope(token));
        return;
      }
      emitChat(socket, payload);
    },
    [socket, encrypted]
  );

  const sendTyping = useCallback(() => {
    if (!socket?.connected) return;
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => {
      emitPayload({ type: "typing", n: userName }).catch(() => {});
    }, TYPING_DEBOUNCE);
  }, [socket, userName, emitPayload]);

  const sendImage = (file: File) => {
    if (!socket?.connected) return;
    if (file.size > MAX_IMAGE_BYTES) {
      alert(`Image too large. Max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;
      const payload = { type: "image", n: userName, url: dataUrl };
      emitPayload(payload)
        .then(() => appendLog({ type: "image", name: userName, image: dataUrl, time: currentTime() }))
        .catch(() => {});
    };
    reader.readAsDataURL(file);
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const inp = inputRef.current;
    const text = inp?.value?.trim();
    if (!text || !socket?.connected) return;
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    emitPayload({ n: userName, m: text })
      .then(() => appendLog({ type: "message", name: userName, text, time: currentTime() }))
      .catch(() => {});
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
    <div className={"chat-panel" + (open ? " is-open" : "")}>
      <button type="button" className="chat-toggle" onClick={slide} aria-expanded={open}>
        <span className="chat-toggle-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </span>
        <span className="chat-toggle-label">Chat</span>
        {encrypted && <span className="chat-encrypted-badge" title="End-to-end encrypted">🔒</span>}
        {hasNew && <span className="chat-dot" />}
        {!ready && <span className="chat-status-dot" title="Connecting…" />}
      </button>

      <div className="chat-drawer">
        <div className="chat-drawer-head">
          <div className="chat-drawer-head-main">
            <h3>{encrypted ? "Encrypted chat" : "Live chat"}</h3>
            {encrypted && (
              <span className="chat-secure-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                End-to-end secured
              </span>
            )}
          </div>
          <span className="chat-drawer-you" onClick={(e) => e.stopPropagation()}>
            {editingName ? (
              <input
                className="chat-name-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => (e.key === "Enter" ? saveName() : null)}
                placeholder="Your name"
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="chat-you"
                onClick={() => {
                  setNameInput(userName);
                  setEditingName(true);
                }}
                title="Click to change display name"
              >
                <span className="chat-you-label">You</span>
                <span className="chat-you-name">{userName}</span>
              </button>
            )}
          </span>
        </div>

        <div className="chat-messages">
          {logs.length === 0 && (
            <div className={`chat-empty ${encrypted ? "chat-empty--secure" : ""}`}>
              <div className="chat-empty-visual" aria-hidden>
                {encrypted ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                )}
              </div>
              <p>No messages yet</p>
              <span>
                {encrypted
                  ? "Only people in this room can read messages"
                  : "Say hello to everyone in the call"}
              </span>
            </div>
          )}
          {logs.map((l, i) => (
            <div
              key={i}
              className={`chat-bubble ${l.name === userName ? "chat-bubble--self" : ""} ${l.type === "image" ? "chat-bubble--image" : ""}`}
            >
              {l.type !== "image" && <span className="chat-bubble-meta">{l.name} · {l.time}</span>}
              {l.type === "image" && l.image ? (
                <>
                  <span className="chat-bubble-meta">{l.name} · {l.time}</span>
                  <img src={l.image} alt={`Shared by ${l.name}`} className="chat-image" />
                </>
              ) : (
                <span className="chat-bubble-text">{l.text}</span>
              )}
            </div>
          ))}
          {typingUsers.size > 0 && (
            <div className="chat-typing">
              {Array.from(typingUsers).join(", ")} typing…
            </div>
          )}
          <div ref={logEndRef} />
        </div>

        <form className="chat-form" onSubmit={send}>
          <div className="chat-input-wrapper">
            <input
              ref={inputRef}
              className="chat-input"
              type="text"
              placeholder={ready ? "Type a message…" : "Connecting…"}
              disabled={!ready}
              onChange={sendTyping}
              onPaste={(e) => {
                const items = e.clipboardData.items;
                for (let i = 0; i < items.length; i++) {
                  if (items[i].type.indexOf("image") !== -1) {
                    e.preventDefault();
                    const file = items[i].getAsFile();
                    if (file) sendImage(file);
                    return;
                  }
                }
              }}
            />
            <button
              type="button"
              className="chat-emoji-btn"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              title="Add emoji"
              aria-label="Add emoji"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </button>
            {showEmojiPicker && (
              <div className="chat-emoji-picker">
                {["😀", "😂", "😍", "🥰", "😎", "🤔", "👍", "❤️", "🔥", "🎉", "✅", "👏", "🙏", "💯", "🚀"].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="chat-emoji-item"
                    onClick={() => {
                      if (inputRef.current) {
                        inputRef.current.value += emoji;
                        inputRef.current.focus();
                        sendTyping();
                      }
                      setShowEmojiPicker(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="chat-icon-btn chat-attach-btn" title="Upload image (max 2 MB)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <input
              type="file"
              accept="image/*"
              className="chat-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) sendImage(file);
                e.target.value = "";
              }}
            />
          </label>
          <button type="submit" className="chat-icon-btn chat-send-btn" disabled={!ready} aria-label="Send message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
