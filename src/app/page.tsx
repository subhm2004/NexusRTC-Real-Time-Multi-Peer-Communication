import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function WelcomePage() {
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
        </div>
      </nav>

      <section className="hero">
        <div className="hero-icon">📹</div>
        <h1 className="hero-title">Video calls, simple</h1>
        <p className="hero-sub">
          Create a room, share the link — no sign-up. Talk with friends in one
          click.
        </p>
        <div className="hero-cta">
          <Link href="/room/create" className="btn btn-primary">
            Create room
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      <section className="features">
        <div className="feature-card">
          <div className="feature-icon">🔒</div>
          <h3 className="feature-title">Private & Secure</h3>
          <p className="feature-desc">No sign-up. Your browser, your data. End-to-end peer-to-peer video.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">⚡</div>
          <h3 className="feature-title">Instant Connect</h3>
          <p className="feature-desc">Create a room, share the link. Join in seconds — no downloads.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">💬</div>
          <h3 className="feature-title">Real-time Chat</h3>
          <p className="feature-desc">Text chat alongside your video call. Stay connected.</p>
        </div>
      </section>

      <footer className="app-footer">
        <p>Your browser, your data. No account needed.</p>
      </footer>
    </div>
  );
}
