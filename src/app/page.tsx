import Link from "next/link";

export default function WelcomePage() {
  return (
    <div className="app-wrap">
      <nav className="app-nav">
        <Link href="/" className="app-nav-brand">
          NexusRTC
        </Link>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Video calls, simple</h1>
        <p className="hero-sub">
          Create a room, share the link — no sign-up. Talk with friends in one
          click.
        </p>
        <div className="hero-cta">
          <Link href="/room/create" className="btn btn-primary">
            Create room
          </Link>
        </div>
      </section>

      <footer className="app-footer">
        <p>Your browser, your data. No account needed.</p>
      </footer>
    </div>
  );
}
