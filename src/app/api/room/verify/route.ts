import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const creatorToken =
      typeof body.creatorToken === "string" ? body.creatorToken.trim() : "";

    if (!roomId) {
      return NextResponse.json({ error: "Room ID required" }, { status: 400 });
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
    if (creatorToken && verifyCreatorToken(roomId, creatorToken)) {
      ok = true;
    } else if (password && verifyPassword(roomId, password)) {
      ok = true;
    }

    if (!ok) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const sessionToken = createSession(roomId);
    if (!sessionToken) {
      return NextResponse.json({ error: "Could not start session" }, { status: 500 });
    }

    return NextResponse.json({ sessionToken });
  } catch (err) {
    console.error("Verify room error:", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
