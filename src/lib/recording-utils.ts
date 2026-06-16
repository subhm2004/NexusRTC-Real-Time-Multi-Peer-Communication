/** Shared helpers for meeting recordings (filename + on-video labels). */

export type RecordingTimestamp = {
  /** e.g. 2026-06-16_03-59-59 */
  fileSegment: string;
  /** e.g. 16 Jun 2026, 3:59 AM */
  display: string;
  /** ISO string for metadata */
  iso: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatRecordingTimestamp(date: Date = new Date()): RecordingTimestamp {
  const fileSegment =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;

  const display = date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return { fileSegment, display, iso: date.toISOString() };
}

export function formatRecordingElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function sanitizeFilenamePart(value: string, maxLen = 40): string {
  return value
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, maxLen)
    .trim()
    .replace(/\s/g, "-") || "Meeting";
}

export function buildRecordingFilename(options: {
  roomId: string;
  roomName?: string | null;
  date?: Date;
  ext?: string;
}): string {
  const { fileSegment } = formatRecordingTimestamp(options.date ?? new Date());
  const roomPart = sanitizeFilenamePart(options.roomName || options.roomId.slice(0, 8));
  const ext = options.ext ?? "webm";
  return `NexusRTC-${roomPart}-${fileSegment}.${ext}`;
}

export function buildRecordingTitle(options: {
  roomName?: string | null;
  date?: Date;
}): string {
  const { display } = formatRecordingTimestamp(options.date ?? new Date());
  const room = (options.roomName || "Meeting").trim();
  return `${room} · ${display}`;
}
