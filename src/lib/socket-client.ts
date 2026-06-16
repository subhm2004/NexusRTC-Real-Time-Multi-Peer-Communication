import { io, Socket } from "socket.io-client";

export type RoomSocket = Socket;

export function createRoomSocket(roomId: string, token: string): RoomSocket {
  return io({
    path: "/socket.io",
    auth: { roomId, token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });
}

export function emitSignaling(socket: RoomSocket | null, msg: Record<string, unknown>) {
  if (socket?.connected) socket.emit("signaling", msg);
}

export function emitChat(socket: RoomSocket | null, payload: string | Record<string, unknown>) {
  if (socket?.connected) socket.emit("chat", payload);
}
