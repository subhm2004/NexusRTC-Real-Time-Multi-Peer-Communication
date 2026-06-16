import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Download token required" }, { status: 400 });
    }

    const { consumeDownloadToken, getRecordingsDir } = require("../../../../../lib/recording-tokens");
    const filename = consumeDownloadToken(token);
    if (!filename) {
      return NextResponse.json({ error: "Invalid or expired download link" }, { status: 403 });
    }

    const safeName = path.basename(filename);
    const recordingsDir = path.resolve(getRecordingsDir());
    const filePath = path.resolve(recordingsDir, safeName);

    if (!filePath.startsWith(recordingsDir + path.sep) && filePath !== recordingsDir) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    const ext = path.extname(safeName).toLowerCase();
    const contentType =
      ext === ".mp4" ? "video/mp4" : ext === ".webm" ? "video/webm" : "application/octet-stream";

    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileStat.size),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("Recording download error:", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
