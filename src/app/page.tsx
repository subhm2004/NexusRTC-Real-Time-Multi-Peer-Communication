import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

function FeatureIcon({ children }: { children: React.ReactNode }) {
  return <div className="feature-icon-wrap">{children}</div>;
}

export default function WelcomePage() {
  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden>
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
        <div className="landing-grid" />
      </div>

      <header className="landing-nav">
        <Link href="/" className="landing-brand">
          <span className="landing-brand-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </span>
          NexusRTC
        </Link>
        <div className="landing-nav-actions">
          <a
            href="https://github.com/subhm2004/NexusRTC-Real-Time-Multi-Peer-Communication"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm landing-github"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-content">
            <span className="landing-badge">
              <span className="landing-badge-dot" />
              WebRTC · Peer-to-peer · No sign-up
            </span>
            <h1 className="landing-title">
              Video calls that feel
              <span className="landing-title-gradient"> instant</span>
            </h1>
            <p className="landing-subtitle">
              Create a room, share one link, and talk face-to-face in seconds.
              Crystal-clear video, live chat, and screen share — right in your browser.
            </p>
            <div className="landing-cta-row">
              <Link href="/room/create" className="btn btn-primary btn-lg landing-cta-primary">
                Start a meeting
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
              <span className="landing-cta-hint">Password-protected rooms · No account · Chrome, Firefox, Safari</span>
            </div>
            <div className="landing-stats">
              <div className="landing-stat">
                <strong>P2P</strong>
                <span>Direct media</span>
              </div>
              <div className="landing-stat-divider" />
              <div className="landing-stat">
                <strong>&lt; 5s</strong>
                <span>To join a room</span>
              </div>
              <div className="landing-stat-divider" />
              <div className="landing-stat">
                <strong>HD</strong>
                <span>720p @ 30fps</span>
              </div>
            </div>
          </div>

          <div className="landing-preview" aria-hidden>
            <div className="landing-preview-window">
              <div className="landing-preview-bar">
                <span /><span /><span />
              </div>
              <div className="landing-preview-grid">
                <div className="landing-preview-tile landing-preview-tile-you">
                  <div className="landing-preview-avatar">You</div>
                  <span className="landing-preview-label">You</span>
                  <span className="landing-preview-live">LIVE</span>
                </div>
                <div className="landing-preview-tile">
                  <div className="landing-preview-avatar">A</div>
                  <span className="landing-preview-label">Alex</span>
                </div>
                <div className="landing-preview-tile">
                  <div className="landing-preview-avatar">S</div>
                  <span className="landing-preview-label">Sam</span>
                </div>
                <div className="landing-preview-tile landing-preview-tile-muted">
                  <div className="landing-preview-avatar">+</div>
                  <span className="landing-preview-label">Invite</span>
                </div>
              </div>
              <div className="landing-preview-controls">
                <span className="landing-preview-ctrl" />
                <span className="landing-preview-ctrl" />
                <span className="landing-preview-ctrl landing-preview-ctrl-accent" />
                <span className="landing-preview-ctrl" />
              </div>
            </div>
            <div className="landing-preview-float landing-preview-float-chat">
              <span className="landing-preview-chat-dot" />
              Hey, can you hear me? 👋
            </div>
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-section-head">
            <span className="landing-section-tag">Features</span>
            <h2>Everything you need for a great call</h2>
            <p>Built for small groups — fast, private, and packed with the essentials.</p>
          </div>
          <div className="landing-features">
            <article className="landing-feature-card">
              <FeatureIcon>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </FeatureIcon>
              <h3>Private by design</h3>
              <p>Video flows peer-to-peer. No accounts, no uploads — your stream stays between browsers.</p>
            </article>
            <article className="landing-feature-card">
              <FeatureIcon>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </FeatureIcon>
              <h3>Instant rooms</h3>
              <p>One click creates a unique room link. Share it and everyone joins in seconds.</p>
            </article>
            <article className="landing-feature-card">
              <FeatureIcon>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </FeatureIcon>
              <h3>Live chat & reactions</h3>
              <p>Text chat, typing indicators, emoji, and image sharing alongside your call.</p>
            </article>
            <article className="landing-feature-card">
              <FeatureIcon>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
              </FeatureIcon>
              <h3>Screen sharing</h3>
              <p>Share your screen in one click. Switch back to camera automatically when you stop.</p>
            </article>
            <article className="landing-feature-card">
              <FeatureIcon>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" />
                </svg>
              </FeatureIcon>
              <h3>Dark & light mode</h3>
              <p>Comfortable in any lighting. Theme follows your system or your saved preference.</p>
            </article>
            <article className="landing-feature-card">
              <FeatureIcon>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" fill="currentColor" />
                </svg>
              </FeatureIcon>
              <h3>Meeting recording</h3>
              <p>Record the full gallery view and download when you&apos;re done — no extra software.</p>
            </article>
          </div>
        </section>

        <section className="landing-section landing-steps-section">
          <div className="landing-section-head">
            <span className="landing-section-tag">How it works</span>
            <h2>Three steps to your first call</h2>
          </div>
          <ol className="landing-steps">
            <li className="landing-step">
              <span className="landing-step-num">01</span>
              <div>
                <h3>Create a room</h3>
                <p>Hit &quot;Start a meeting&quot; — we generate a unique, private link instantly.</p>
              </div>
            </li>
            <li className="landing-step">
              <span className="landing-step-num">02</span>
              <div>
                <h3>Share the link</h3>
                <p>Send it to friends via chat, email, or anywhere. They open it in any modern browser.</p>
              </div>
            </li>
            <li className="landing-step">
              <span className="landing-step-num">03</span>
              <div>
                <h3>Talk face-to-face</h3>
                <p>Allow camera & mic, pick a name, and you&apos;re in. Video connects directly between peers.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="landing-cta-banner">
          <div className="landing-cta-banner-inner">
            <h2>Ready to jump in?</h2>
            <p>Your next video call is one click away.</p>
            <Link href="/room/create" className="btn btn-primary btn-lg">
              Create your room
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <p>
          <strong>NexusRTC</strong> — peer-to-peer video, built with Next.js & WebRTC.
        </p>
        <p className="landing-footer-muted">Your browser, your data. No account needed.</p>
      </footer>
    </div>
  );
}
