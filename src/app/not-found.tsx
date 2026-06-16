import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageBackground } from "@/components/ui/PageBackground";

export default function NotFound() {
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
          <div className="status-card-icon status-card-icon--muted" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h1 className="status-card-title">Page not found</h1>
          <p className="status-card-text">
            This page doesn&apos;t exist. Head back home or create a new meeting room.
          </p>
          <div className="status-card-actions">
            <Link href="/" className="btn btn-primary">
              Go home
            </Link>
            <Link href="/room/create" className="btn btn-ghost">
              Create room
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
