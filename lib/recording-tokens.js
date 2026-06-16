const crypto = require("crypto");
const path = require("path");

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const tokens = new Map();

/** Private storage — not served as static files. */
function getRecordingsDir() {
  return path.join(process.cwd(), "data", "recordings");
}

function getMaxRecordingBytes() {
  const mb = parseInt(process.env.MAX_RECORDING_MB || "200", 10);
  return Math.max(1, mb) * 1024 * 1024;
}

function createDownloadToken(filename, ttlMs = DEFAULT_TTL_MS) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, {
    filename: path.basename(filename),
    expiresAt: Date.now() + ttlMs,
  });
  return token;
}

function consumeDownloadToken(token) {
  if (!token || typeof token !== "string") return null;
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return null;
  }
  tokens.delete(token);
  return entry.filename;
}

/** Periodic cleanup of expired tokens. */
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokens.entries()) {
    if (now > entry.expiresAt) tokens.delete(token);
  }
}, 10 * 60 * 1000).unref?.();

module.exports = {
  getRecordingsDir,
  getMaxRecordingBytes,
  createDownloadToken,
  consumeDownloadToken,
};
