import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const MIN_PASSWORD = 4;
const MAX_PASSWORD = 64;
const MIN_ROOM_NAME = 2;
const MAX_ROOM_NAME = 50;

export async function POST(request: NextRequest) {
  try {
    const { getClientIpFromHeaders, rateLimiters } = require("../../../../../lib/rate-limit");
    const ip = getClientIpFromHeaders(request.headers);
    const rl = rateLimiters.createRoom.check(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many rooms created. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await request.json();
    const roomName = typeof body.roomName === "string" ? body.roomName.trim() : "";
    const password = typeof body.password === "string" ? body.password.trim() : "";

    if (roomName.length < MIN_ROOM_NAME || roomName.length > MAX_ROOM_NAME) {
      return NextResponse.json(
        { error: `Room name must be ${MIN_ROOM_NAME}–${MAX_ROOM_NAME} characters` },
        { status: 400 }
      );
    }

    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return NextResponse.json(
        { error: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters` },
        { status: 400 }
      );
    }

    const roomId = randomUUID();

    // Dynamic require — room-state is CommonJS used by server.js
    const {
      createRoom,
      createSession,
    } = require("../../../../../lib/room-state");

    const created = await createRoom(roomId, password, roomName);
    if (!created) {
      return NextResponse.json({ error: "Could not create room" }, { status: 500 });
    }

    const sessionToken = createSession(roomId, { isHost: true });

    return NextResponse.json({
      roomId,
      roomName,
      creatorToken: created.creatorToken,
      sessionToken,
    });
  } catch (err) {
    console.error("Create room error:", err);
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }
}
