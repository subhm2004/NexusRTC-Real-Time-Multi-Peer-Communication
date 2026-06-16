"use client";

let sentryReady = false;

export async function initErrorReporting() {
  if (typeof window === "undefined" || sentryReady) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  try {
    const Sentry = await import("@sentry/browser");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
    sentryReady = true;
  } catch (err) {
    console.warn("Sentry init failed:", err);
  }
}

export function reportError(error: unknown, context?: Record<string, string>) {
  console.error(error, context);
  if (!sentryReady || typeof window === "undefined") return;

  import("@sentry/browser")
    .then((Sentry) => {
      Sentry.captureException(error, { extra: context });
    })
    .catch(() => {});
}
