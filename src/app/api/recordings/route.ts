import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const RECORDINGS_DIR = path.join(process.cwd(), "public", "recordings");
const FFMPEG_TIMEOUT_MS = 120000; // 2 minutes for compression

type CompressionJob = {
  inputPath: string;
  outputPath: string;
  resolve: (r: { success: boolean; error?: string }) => void;
};

const compressionQueue: CompressionJob[] = [];
let isProcessingQueue = false;

async function processCompressionQueue() {
  if (isProcessingQueue || compressionQueue.length === 0) return;
  isProcessingQueue = true;
  const job = compressionQueue.shift()!;
  const result = await compressWithFFmpeg(job.inputPath, job.outputPath);
  job.resolve(result);
  isProcessingQueue = false;
  if (compressionQueue.length > 0) processCompressionQueue();
}

function queueCompression(
  inputPath: string,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    compressionQueue.push({ inputPath, outputPath, resolve });
    processCompressionQueue();
  });
}

function compressWithFFmpeg(
  inputPath: string,
  outputPath: string
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
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const roomId = formData.get("roomId") as string | null;

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    await mkdir(RECORDINGS_DIR, { recursive: true });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateTime =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const safeRoomId = (roomId || "room").replace(/[^a-zA-Z0-9-_]/g, "_");
    const baseName = `recorded-meeting-${safeRoomId}-${dateTime}`;
    const webmFilename = `${baseName}.webm`;
    const mp4Filename = `${baseName}.mp4`;
    const webmPath = path.join(RECORDINGS_DIR, webmFilename);
    const mp4Path = path.join(RECORDINGS_DIR, mp4Filename);

    await writeFile(webmPath, buffer);

    const compressionResult = await queueCompression(webmPath, mp4Path);

    if (compressionResult.success) {
      try {
        await unlink(webmPath);
      } catch {
        /* keep webm if delete fails */
      }
      return NextResponse.json({
        url: `/recordings/${mp4Filename}`,
        filename: mp4Filename,
        compressed: true,
        message: "Recording saved and compressed successfully",
      });
    }

    return NextResponse.json({
      url: `/recordings/${webmFilename}`,
      filename: webmFilename,
      compressed: false,
      message: "Recording saved (FFmpeg unavailable or failed, using original)",
    });
  } catch (err) {
    console.error("Recording upload error:", err);
    return NextResponse.json(
      { error: "Failed to save recording" },
      { status: 500 }
    );
  }
}
