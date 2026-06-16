export const SESSION_TOKEN_PREFIX = "nexus-room-session-";
export const CREATOR_TOKEN_PREFIX = "nexus-creator-token-";
export const ROOM_PASSWORD_PREFIX = "nexus-room-pass-";

export function getStoredSessionToken(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(`${SESSION_TOKEN_PREFIX}${roomId}`);
}

export function setStoredSessionToken(roomId: string, token: string) {
  sessionStorage.setItem(`${SESSION_TOKEN_PREFIX}${roomId}`, token);
}

export function getStoredCreatorToken(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(`${CREATOR_TOKEN_PREFIX}${roomId}`);
}

export function setStoredRoomPassword(roomId: string, password: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(`${ROOM_PASSWORD_PREFIX}${roomId}`, password);
}

export function getStoredRoomPassword(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(`${ROOM_PASSWORD_PREFIX}${roomId}`);
}
