import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { getClientIpFromHeaders, rateLimiters } = require("../../../../../lib/rate-limit");
    const ip = getClientIpFromHeaders(request.headers);

    const body = await request.json();
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const creatorToken =
      typeof body.creatorToken === "string" ? body.creatorToken.trim() : "";

    if (!roomId) {
      return NextResponse.json({ error: "Room ID required" }, { status: 400 });
    }

    const rl = rateLimiters.verifyRoom.check(`${ip}:${roomId}`);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const {
      getRoomByUuid,
      verifyPassword,
      verifyCreatorToken,
      createSession,
    } = require("../../../../../lib/room-state");

    const room = getRoomByUuid(roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    let ok = false;
    let isHost = false;
    if (creatorToken && verifyCreatorToken(roomId, creatorToken)) {
      ok = true;
      isHost = true;
    } else if (password && (await verifyPassword(roomId, password))) {
      ok = true;
    }

    if (!ok) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const sessionToken = createSession(roomId, { isHost });
    if (!sessionToken) {
      return NextResponse.json({ error: "Could not start session" }, { status: 500 });
    }

    return NextResponse.json({ sessionToken });
  } catch (err) {
    console.error("Verify room error:", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
