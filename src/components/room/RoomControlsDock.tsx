"use client";

import { useEffect, useRef, useState } from "react";

export type VideoLayoutMode = "auto" | "grid" | "spotlight" | "sidebar";

const LAYOUT_OPTIONS: { id: VideoLayoutMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Adapts to participant count" },
  { id: "grid", label: "Grid", hint: "Equal tiles in a grid" },
  { id: "spotlight", label: "Spotlight", hint: "Large main video + filmstrip" },
  { id: "sidebar", label: "Sidebar", hint: "Main video with side thumbnails" },
];

type RoomControlsDockProps = {
  userName: string | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isRecording: boolean;
  isHandRaised: boolean;
  videoLayout: VideoLayoutMode;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleRecording: () => void;
  onToggleHandRaise: () => void;
  onLayoutChange: (layout: VideoLayoutMode) => void;
  onSendReaction?: (emoji: string) => void;
};

function CtrlIcon({ children }: { children: React.ReactNode }) {
  return <span className="room-ctrl-icon" aria-hidden>{children}</span>;
}

export function RoomControlsDock({
  userName,
  isMuted,
  isVideoEnabled,
  isScreenSharing,
  isRecording,
  isHandRaised,
  videoLayout,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onToggleRecording,
  onToggleHandRaise,
  onLayoutChange,
  onSendReaction,
}: RoomControlsDockProps) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const reactionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!layoutOpen && !reactionOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (layoutOpen && !layoutRef.current?.contains(e.target as Node)) setLayoutOpen(false);
      if (reactionOpen && !reactionRef.current?.contains(e.target as Node)) setReactionOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [layoutOpen, reactionOpen]);

  return (
    <div className="room-controls-dock">
      <div className="room-controls-inner">
        <button
          type="button"
          className={`room-ctrl-btn room-ctrl-btn--round ${isMuted ? "is-off" : ""}`}
          onClick={onToggleMute}
          title={isMuted ? "Unmute microphone" : "Mute microphone"}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={isMuted}
        >
          <CtrlIcon>
            {isMuted ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1L8 5H4a2 2 0 00-2 2v6a2 2 0 002 2h4l4 4V1z" />
                <line x1="23" y1="1" x2="1" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1L8 5H4a2 2 0 00-2 2v6a2 2 0 002 2h4l4 4V1z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </CtrlIcon>
          <span className="room-ctrl-label">{isMuted ? "Unmute" : "Mic"}</span>
        </button>

        <button
          type="button"
          className={`room-ctrl-btn room-ctrl-btn--round ${!isVideoEnabled ? "is-off" : ""}`}
          onClick={onToggleVideo}
          title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
          aria-label={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
          aria-pressed={!isVideoEnabled}
        >
          <CtrlIcon>
            {isVideoEnabled ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" />
                <line x1="1" y1="1" x2="16" y2="16" />
              </svg>
            )}
          </CtrlIcon>
          <span className="room-ctrl-label">{isVideoEnabled ? "Camera" : "Cam off"}</span>
        </button>

        <button
          type="button"
          className={`room-ctrl-btn room-ctrl-btn--round ${isScreenSharing ? "is-active" : ""}`}
          onClick={onToggleScreenShare}
          title={isScreenSharing ? "Stop screen share" : "Share screen"}
          aria-label={isScreenSharing ? "Stop screen share" : "Share screen"}
          aria-pressed={isScreenSharing}
        >
          <CtrlIcon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4M7 13l5 5 5-5" />
            </svg>
          </CtrlIcon>
          <span className="room-ctrl-label">{isScreenSharing ? "Stop" : "Share"}</span>
        </button>

        <button
          type="button"
          className={`room-ctrl-btn room-ctrl-btn--round ${isRecording ? "is-recording" : ""}`}
          onClick={onToggleRecording}
          title={isRecording ? "Stop recording" : "Record meeting"}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          aria-pressed={isRecording}
        >
          <CtrlIcon>
            {isRecording ? (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
              </svg>
            )}
          </CtrlIcon>
          <span className="room-ctrl-label">{isRecording ? "Stop" : "Record"}</span>
        </button>

        <span className="room-controls-divider" aria-hidden />

        <button
          type="button"
          className={`room-ctrl-btn room-ctrl-btn--round ${isHandRaised ? "is-hand-raised" : ""}`}
          onClick={onToggleHandRaise}
          title={isHandRaised ? "Lower hand" : "Raise hand"}
          aria-label={isHandRaised ? "Lower hand" : "Raise hand"}
          aria-pressed={isHandRaised}
        >
          <CtrlIcon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 11V6a2 2 0 114 0v5M11 10V5a2 2 0 114 0v6l2 8H5l2-9z" />
              <path d="M11 18v3M9 21h4" />
            </svg>
          </CtrlIcon>
          <span className="room-ctrl-label">{isHandRaised ? "Lower" : "Hand"}</span>
        </button>

        {onSendReaction && (
          <div ref={reactionRef} className="room-reaction-picker">
            <button
              type="button"
              className={`room-ctrl-btn room-ctrl-btn--round ${reactionOpen ? "is-active" : ""}`}
              onClick={() => setReactionOpen((o) => !o)}
              title="Send reaction"
              aria-label="Send reaction"
              aria-expanded={reactionOpen}
            >
              <CtrlIcon>
                <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>👍</span>
              </CtrlIcon>
              <span className="room-ctrl-label">React</span>
            </button>
            {reactionOpen && (
              <div className="room-reaction-menu" role="menu">
                {["👍", "❤️", "😂", "👏", "🔥"].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="room-reaction-item"
                    onClick={() => {
                      onSendReaction(emoji);
                      setReactionOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={layoutRef} className="room-layout-picker">
          <button
            type="button"
            className={`room-ctrl-btn room-ctrl-btn--round ${layoutOpen ? "is-active" : ""}`}
            onClick={() => setLayoutOpen((o) => !o)}
            title="Change video layout"
            aria-label="Change video layout"
            aria-expanded={layoutOpen}
            aria-haspopup="listbox"
          >
            <CtrlIcon>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </CtrlIcon>
            <span className="room-ctrl-label">Layout</span>
          </button>
          {layoutOpen && (
            <ul className="room-layout-menu" role="listbox" aria-label="Video layout">
              {LAYOUT_OPTIONS.map((opt) => (
                <li key={opt.id} role="option" aria-selected={videoLayout === opt.id}>
                  <button
                    type="button"
                    className={`room-layout-option ${videoLayout === opt.id ? "is-selected" : ""}`}
                    onClick={() => {
                      onLayoutChange(opt.id);
                      setLayoutOpen(false);
                    }}
                  >
                    <span className="room-layout-option-label">{opt.label}</span>
                    <span className="room-layout-option-hint">{opt.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {userName && <span className="room-controls-user">{userName}</span>}
      </div>
    </div>
  );
}
