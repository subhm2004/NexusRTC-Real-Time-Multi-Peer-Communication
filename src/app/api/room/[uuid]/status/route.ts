import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  if (!uuid) {
    return NextResponse.json({ exists: false }, { status: 400 });
  }

  const { getRoomByUuid } = require("../../../../../../lib/room-state");
  const room = getRoomByUuid(uuid);

  return NextResponse.json({
    exists: !!room,
    requiresPassword: !!room,
    roomName: room?.roomName || null,
  });
}
