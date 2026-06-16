"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const UUID_RE =
  /^(?:https?:\/\/[^\s/]+\/room\/)?([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function JoinRoomForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a room link or ID");
      return;
    }
    const match = trimmed.match(UUID_RE);
    if (!match) {
      setError("Invalid room link — paste the full URL from your host");
      return;
    }
    router.push(`/room/${match[1]}`);
  };

  return (
    <form
      className={compact ? "join-room-form join-room-form--compact" : "join-room-form"}
      onSubmit={handleSubmit}
    >
      <div className="join-room-input-wrap">
        <input
          type="text"
          className="join-room-input"
          placeholder="Paste room link to join…"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          aria-label="Room link or ID"
          autoComplete="off"
        />
        <button type="submit" className="btn btn-ghost join-room-btn">
          Join
        </button>
      </div>
      {error && <p className="join-room-error">{error}</p>}
    </form>
  );
}
