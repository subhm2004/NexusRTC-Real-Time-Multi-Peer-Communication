"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const CHAT_NAME_KEY = "nexus-chat-name";
const TYPING_TIMEOUT = 3000; // 3 seconds
const TYPING_DEBOUNCE = 500; // 500ms debounce

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

function parseChatMessage(raw: string): { type: "message" | "typing" | "image"; name?: string; text?: string; image?: string } | null {
  try {
    const d = JSON.parse(raw);
    if (d.type === "typing" && typeof d.n === "string") {
      return { type: "typing", name: d.n };
    }
    if (d.type === "image" && typeof d.n === "string" && typeof d.url === "string") {
      return { type: "image", name: d.n, image: d.url };
    }
    if (d && typeof d.n === "string" && typeof d.m === "string") {
      return { type: "message", name: d.n, text: d.m };
    }
  } catch {
    // backward compat: plain text
  }
  return null;
}

export function Chat({ wsUrl }: { wsUrl: string }) {
  const [userName, setUserName] = useState("User");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<Array<{ type: "message" | "typing" | "image"; name?: string; text?: string; image?: string; time?: string }>>([]);
  const [hasNew, setHasNew] = useState(false);
  const [ready, setReady] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const openRef = useRef(open);
  const userNameInit = useRef(false);
  const connectGenRef = useRef(0);
  const recentMsgKeysRef = useRef<string[]>([]);
  const userNameRef = useRef(userName);
  openRef.current = open;
  userNameRef.current = userName;

  const appendLog = useCallback(
    (entry: { type: "message" | "typing" | "image"; name?: string; text?: string; image?: string; time?: string }) => {
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
    },
    []
  );

  useEffect(() => {
    if (!userNameInit.current && typeof window !== "undefined") {
      setUserName(getOrCreateUserName());
      userNameInit.current = true;
    }
  }, []);

  const connect = useCallback(() => {
    if (!wsUrl || typeof window === "undefined") return;
    if (wsRef.current?.readyState === 1) return;

    const gen = ++connectGenRef.current;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onclose = () => {
      setReady(false);
      if (wsRef.current === ws) wsRef.current = null;
      if (connectGenRef.current !== gen) return;
      setTimeout(() => {
        if (connectGenRef.current === gen && wsUrl) connect();
      }, 1000);
    };
    ws.onopen = () => {
      if (connectGenRef.current === gen) setReady(true);
    };
    ws.onmessage = (e) => {
      const raw = e.data as string;
      
      try {
        const d = JSON.parse(raw);
        
        // Handle typing messages separately
        if (d && d.type === "typing" && typeof d.n === "string") {
          if (d.n !== userNameRef.current) {
            setTypingUsers((prev) => {
              const next = new Set(prev);
              next.add(d.n);
              return next;
            });
            setTimeout(() => {
              setTypingUsers((p) => {
                const n = new Set(p);
                n.delete(d.n);
                return n;
              });
            }, TYPING_TIMEOUT);
          }
          return; // Don't add typing messages to chat logs
        }
        
        // Handle image messages
        if (d && d.type === "image" && typeof d.n === "string" && typeof d.url === "string") {
          // Clear typing indicator
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.delete(d.n);
            return next;
          });
          
          appendLog({
            type: "image",
            name: d.n,
            image: d.url,
            text: "",
            time: currentTime(),
          });
          return;
        }
        
        // Handle regular text messages
        if (d && typeof d.n === "string" && typeof d.m === "string") {
          // Clear typing indicator
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.delete(d.n);
            return next;
          });
          
          appendLog({
            type: "message",
            name: d.n,
            text: d.m,
            image: "",
            time: currentTime(),
          });
          return;
        }
      } catch {
        appendLog({
          type: "message",
          name: "Unknown",
          text: raw,
          image: "",
          time: currentTime(),
        });
      }
    };
  }, [wsUrl, appendLog]);

  useEffect(() => {
    if (!wsUrl) return;
    connect();
    return () => {
      connectGenRef.current += 1;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setReady(false);
    };
  }, [wsUrl, connect]);

  // Close emoji picker on outside click
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

  const sendTyping = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => {
      wsRef.current?.send(JSON.stringify({ type: "typing", n: userName }));
    }, TYPING_DEBOUNCE);
  }, [userName]);

  const sendImage = (file: File) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;
      wsRef.current?.send(JSON.stringify({ type: "image", n: userName, url: dataUrl }));
      appendLog({
        type: "image",
        name: userName,
        image: dataUrl,
        text: "",
        time: currentTime(),
      });
    };
    reader.readAsDataURL(file);
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const inp = inputRef.current;
    const text = inp?.value?.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== 1) return;
    
    // Clear typing indicators
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    
    const payload = JSON.stringify({ n: userName, m: text });
    wsRef.current.send(payload);

    appendLog({
      type: "message",
      name: userName,
      text,
      image: "",
      time: currentTime(),
    });

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
        <span className="chat-header-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          Chat
        </span>
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
            <div key={i} className={`chat-msg ${l.type === "image" ? "chat-msg-image" : ""}`}>
              {l.type === "image" && l.image ? (
                <>
                  <div className="chat-msg-header">{l.time} - {l.name || "Unknown"}:</div>
                  <img 
                    src={l.image} 
                    alt={`Image shared by ${l.name || "Unknown"}`} 
                    className="chat-image"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      const parent = target.parentElement;
                      if (parent) {
                        target.style.display = "none";
                        const errorDiv = document.createElement("div");
                        errorDiv.style.cssText = "color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem;";
                        errorDiv.textContent = "Image failed to load";
                        parent.appendChild(errorDiv);
                      }
                    }}
                  />
                </>
              ) : (
                <>{l.time} - {l.name || "Unknown"}: {l.text || ""}</>
              )}
            </div>
          ))}
          {typingUsers.size > 0 && (
            <div className="chat-typing">
              {Array.from(typingUsers).join(", ")} {typingUsers.size === 1 ? "is" : "are"} typing...
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
              placeholder="Type a message..."
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
            >
              😊
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
          <label className="chat-image-btn" title="Upload image">
            📷
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) sendImage(file);
                e.target.value = "";
              }}
            />
          </label>
          <button type="submit" className="chat-send" disabled={!ready}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
