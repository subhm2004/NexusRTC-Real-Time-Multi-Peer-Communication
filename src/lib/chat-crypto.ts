/**
 * End-to-end chat encryption using AES-GCM.
 * Key derived from room password + room ID (PBKDF2) — server only relays ciphertext.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_PREFIX = "nexusrtc-chat-v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function deriveChatKey(roomId: string, password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(`${SALT_PREFIX}:${roomId}`),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptChatPayload(key: CryptoKey, payload: object): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptChatPayload(
  key: CryptoKey,
  token: string
): Promise<Record<string, unknown> | null> {
  try {
    const [ivB64, cipherB64] = token.split(".");
    if (!ivB64 || !cipherB64) return null;
    const iv = fromBase64(ivB64);
    const cipher = fromBase64(cipherB64);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource
    );
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function wrapEncryptedEnvelope(token: string): Record<string, unknown> {
  return { e: 1, c: token };
}

export function isEncryptedEnvelope(
  payload: Record<string, unknown>
): payload is { e: 1; c: string } {
  return payload.e === 1 && typeof payload.c === "string";
}
