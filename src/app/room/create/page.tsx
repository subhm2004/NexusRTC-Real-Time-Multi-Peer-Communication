"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageBackground } from "@/components/ui/PageBackground";
import {
  CREATOR_TOKEN_PREFIX,
  SESSION_TOKEN_PREFIX,
  setStoredRoomPassword,
} from "@/lib/room-auth";

const MIN_PASSWORD = 4;
const MAX_PASSWORD = 64;
const MIN_ROOM_NAME = 2;
const MAX_ROOM_NAME = 50;

export default function CreateRoomPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = roomName.trim();
    if (trimmed.length < MIN_ROOM_NAME || trimmed.length > MAX_ROOM_NAME) {
      setError(`Room name must be ${MIN_ROOM_NAME}–${MAX_ROOM_NAME} characters`);
      return;
    }
    setStep(2);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = roomName.trim();
    const trimmed = password.trim();
    if (trimmed.length < MIN_PASSWORD || trimmed.length > MAX_PASSWORD) {
      setError(`Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters`);
      return;
    }
    if (trimmed !== confirm.trim()) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/room/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: trimmedName, password: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create room");
        return;
      }

      sessionStorage.setItem(`${CREATOR_TOKEN_PREFIX}${data.roomId}`, data.creatorToken);
      sessionStorage.setItem(`${SESSION_TOKEN_PREFIX}${data.roomId}`, data.sessionToken);
      setStoredRoomPassword(data.roomId, trimmed);
      router.push(`/room/${data.roomId}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
        <div className="name-modal name-modal-room create-room-card">
          <div className="create-room-progress" aria-hidden>
            <span className={`create-room-progress-step ${step >= 1 ? "active" : ""}`} />
            <span className={`create-room-progress-step ${step >= 2 ? "active" : step > 2 ? "done" : ""}`} />
            <span className="create-room-progress-step" />
          </div>
          <div className="create-room-steps" aria-hidden>
            <span className={step === 1 ? "create-step active" : "create-step done"}>1. Room name</span>
            <span className={step === 2 ? "create-step active" : "create-step"}>2. Password</span>
            <span className="create-step muted">3. Your name</span>
          </div>

          {step === 1 ? (
            <>
              <div className="name-modal-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <h1 className="name-modal-title">Name your room</h1>
              <p className="name-modal-subtitle">
                Guests will see this name when they join. You&apos;ll set your host display name next.
              </p>
              <form onSubmit={handleStep1}>
                <input
                  type="text"
                  className="name-modal-input"
                  placeholder="e.g. Team standup, Study group"
                  value={roomName}
                  onChange={(e) => {
                    setRoomName(e.target.value);
                    setError("");
                  }}
                  minLength={MIN_ROOM_NAME}
                  maxLength={MAX_ROOM_NAME}
                  autoFocus
                  autoComplete="off"
                />
                {error && <div className="name-modal-error">{error}</div>}
                <button type="submit" className="btn btn-primary name-modal-btn">
                  Continue
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="name-modal-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              </div>
              <h1 className="name-modal-title">Protect &quot;{roomName.trim()}&quot;</h1>
              <p className="name-modal-subtitle">
                Set a password so only invited people can join. Share the link and password separately.
              </p>
              <form onSubmit={handleCreate}>
                <input
                  type="password"
                  className="name-modal-input"
                  placeholder="Room password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  minLength={MIN_PASSWORD}
                  maxLength={MAX_PASSWORD}
                  autoFocus
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  className="name-modal-input"
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setError("");
                  }}
                  minLength={MIN_PASSWORD}
                  maxLength={MAX_PASSWORD}
                  autoComplete="new-password"
                />
                {error && <div className="name-modal-error">{error}</div>}
                <div className="create-room-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setStep(1);
                      setError("");
                    }}
                    disabled={loading}
                  >
                    Back
                  </button>
                  <button type="submit" className="btn btn-primary name-modal-btn" disabled={loading}>
                    {loading ? "Creating…" : "Create room"}
                  </button>
                </div>
              </form>
            </>
          )}

          <Link href="/" className="create-room-back">
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
