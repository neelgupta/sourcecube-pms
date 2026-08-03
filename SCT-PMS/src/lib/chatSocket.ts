import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./api";

let socket: Socket | null = null;

/** Lazily creates a single shared Socket.IO connection for the whole app, authenticated via
 *  the same httpOnly session cookie the REST API uses (see server/src/lib/chatSocket.ts) —
 *  no separate token/handshake needed. Reused across every component that needs realtime
 *  chat/notification events rather than opening a new connection per screen. */
export function getChatSocket(): Socket {
  if (!socket) {
    const socketBase = API_BASE.replace(/\/api\/?$/, "");
    socket = io(socketBase, { withCredentials: true, autoConnect: true });
  }
  return socket;
}
export function disconnectChatSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
