import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import {
  buildRecordingFilename,
  buildRecordingTitle,
  formatRecordingTimestamp,
} from "@/lib/recording-utils";

const FFMPEG_TIMEOUT_MS = 120000;

type CompressionJob = {
  inputPath: string;
  outputPath: string;
  title: string;
  recordedAtIso: string;
  resolve: (r: { success: boolean; error?: string }) => void;
};

const compressionQueue: CompressionJob[] = [];
let isProcessingQueue = false;

async function processCompressionQueue() {
  if (isProcessingQueue || compressionQueue.length === 0) return;
  isProcessingQueue = true;
  const job = compressionQueue.shift()!;
  const result = await compressWithFFmpeg(
    job.inputPath,
    job.outputPath,
    job.title,
    job.recordedAtIso
  );
  job.resolve(result);
  isProcessingQueue = false;
  if (compressionQueue.length > 0) processCompressionQueue();
}

function queueCompression(
  inputPath: string,
  outputPath: string,
  title: string,
  recordedAtIso: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    compressionQueue.push({ inputPath, outputPath, title, recordedAtIso, resolve });
    processCompressionQueue();
  });
}

function compressWithFFmpeg(
  inputPath: string,
  outputPath: string,
  title: string,
  recordedAtIso: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-crf",
      "23",
      "-preset",
      "fast",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-metadata",
      `title=${title}`,
      "-metadata",
      `comment=Recorded with NexusRTC on ${formatRecordingTimestamp(new Date(recordedAtIso)).display}`,
      "-metadata",
      `creation_time=${recordedAtIso.replace(/\.\d{3}Z$/, "Z")}`,
      "-y",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
      resolve({ success: false, error: "Compression timeout" });
    }, FFMPEG_TIMEOUT_MS);

    ffmpeg.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr.slice(-500) || `Exit code ${code}` });
      }
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const {
      getClientIpFromHeaders,
      rateLimiters,
    } = require("../../../../lib/rate-limit");
    const {
      getRecordingsDir,
      getMaxRecordingBytes,
      createDownloadToken,
    } = require("../../../../lib/recording-tokens");
    const { validateSession } = require("../../../../lib/room-state");

    const ip = getClientIpFromHeaders(request.headers);
    const rl = rateLimiters.recordingUpload.check(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const roomId = formData.get("roomId") as string | null;
    const sessionToken = formData.get("sessionToken") as string | null;
    const roomName = (formData.get("roomName") as string | null)?.trim() || null;
    const recordedAtRaw = formData.get("recordedAt") as string | null;
    const recordedAt = recordedAtRaw ? new Date(recordedAtRaw) : new Date();
    const safeRecordedAt = Number.isNaN(recordedAt.getTime()) ? new Date() : recordedAt;

    if (!roomId || !sessionToken) {
      return NextResponse.json(
        { error: "Room ID and session token required" },
        { status: 401 }
      );
    }

    if (!validateSession(roomId, sessionToken)) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const maxBytes = getMaxRecordingBytes();
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `Recording too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` },
        { status: 413 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (buffer.length > maxBytes) {
      return NextResponse.json(
        { error: `Recording too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` },
        { status: 413 }
      );
    }

    const recordingsDir = getRecordingsDir();
    await mkdir(recordingsDir, { recursive: true });

    const webmFilename = buildRecordingFilename({
      roomId,
      roomName,
      date: safeRecordedAt,
      ext: "webm",
    });
    const mp4Filename = buildRecordingFilename({
      roomId,
      roomName,
      date: safeRecordedAt,
      ext: "mp4",
    });
    const title = buildRecordingTitle({ roomName, date: safeRecordedAt });
    const webmPath = path.join(recordingsDir, webmFilename);
    const mp4Path = path.join(recordingsDir, mp4Filename);

    await writeFile(webmPath, buffer);

    const compressionResult = await queueCompression(
      webmPath,
      mp4Path,
      title,
      safeRecordedAt.toISOString()
    );

    const { display } = formatRecordingTimestamp(safeRecordedAt);
    const savedFilename = compressionResult.success ? mp4Filename : webmFilename;
    const downloadToken = createDownloadToken(savedFilename);

    if (compressionResult.success) {
      try {
        await unlink(webmPath);
      } catch {
        /* keep webm if delete fails */
      }
      return NextResponse.json({
        downloadUrl: `/api/recordings/download?token=${downloadToken}`,
        filename: mp4Filename,
        compressed: true,
        recordedAt: safeRecordedAt.toISOString(),
        recordedAtDisplay: display,
        title,
        message: "Recording saved and compressed successfully",
      });
    }

    return NextResponse.json({
      downloadUrl: `/api/recordings/download?token=${downloadToken}`,
      filename: webmFilename,
      compressed: false,
      recordedAt: safeRecordedAt.toISOString(),
      recordedAtDisplay: display,
      title,
      message: "Recording saved (FFmpeg unavailable or failed, using original)",
    });
  } catch (err) {
    console.error("Recording upload error:", err);
    return NextResponse.json({ error: "Failed to save recording" }, { status: 500 });
  }
}
