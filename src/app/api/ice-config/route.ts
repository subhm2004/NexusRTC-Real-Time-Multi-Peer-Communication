import { NextRequest, NextResponse } from "next/server";

/** Server-side ICE config — TURN credentials stay off the client bundle until fetched. */
export async function GET(_request: NextRequest) {
  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const turnUrl = process.env.TURN_URL || process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.TURN_USERNAME || process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL || process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: turnUsername || undefined,
      credential: turnCredential || undefined,
    });
  }

  return NextResponse.json({ iceServers });
}
