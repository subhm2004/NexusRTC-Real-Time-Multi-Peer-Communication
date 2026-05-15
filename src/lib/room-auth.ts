export const SESSION_TOKEN_PREFIX = "nexus-room-session-";
export const CREATOR_TOKEN_PREFIX = "nexus-creator-token-";

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

export function wsUrlWithToken(basePath: string, sessionToken: string | null): string {
  if (!basePath) return "";
  if (!sessionToken) return basePath;
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}token=${encodeURIComponent(sessionToken)}`;
}
