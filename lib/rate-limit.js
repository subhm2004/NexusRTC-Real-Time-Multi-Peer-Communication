/** In-memory sliding-window rate limiter (single Node process). */

function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();

  function check(key) {
    const now = Date.now();
    const bucketKey = String(key || "unknown");
    let entry = buckets.get(bucketKey);

    if (entry) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
      if (entry.timestamps.length === 0) buckets.delete(bucketKey);
    }

    entry = buckets.get(bucketKey);
    if (!entry) {
      entry = { timestamps: [now] };
      buckets.set(bucketKey, entry);
      return { allowed: true, retryAfter: 0 };
    }

    if (entry.timestamps.length >= max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((entry.timestamps[0] + windowMs - now) / 1000)
      );
      return { allowed: false, retryAfter };
    }

    entry.timestamps.push(now);
    return { allowed: true, retryAfter: 0 };
  }

  return { check };
}

function getClientIpFromHeaders(headers) {
  if (!headers) return "unknown";
  const forwarded =
    (typeof headers.get === "function" && headers.get("x-forwarded-for")) ||
    headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  const realIp =
    (typeof headers.get === "function" && headers.get("x-real-ip")) ||
    headers["x-real-ip"];
  return realIp ? String(realIp).trim() : "unknown";
}

function getSocketIp(socket) {
  const forwarded = socket.handshake?.headers?.["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return socket.handshake?.address || socket.conn?.remoteAddress || "unknown";
}

const rateLimiters = {
  createRoom: createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 }),
  verifyRoom: createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 }),
  recordingUpload: createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 }),
  socketConnect: createRateLimiter({ windowMs: 60 * 1000, max: 40 }),
};

module.exports = {
  createRateLimiter,
  getClientIpFromHeaders,
  getSocketIp,
  rateLimiters,
};
