import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./api";

let socket: Socket | null = null;

// The server only emits presence:snapshot once, right when a socket connects — since the
// socket is shared and typically opened early (e.g. by the unread-count badge or notification
// bell, well before the Chat page ever mounts), a component that starts listening later would
// otherwise never see that one-time snapshot and would show everyone offline until the next
// online/offline transition happened to fire. Caching it at module scope lets any late-mounting
// listener read the current state immediately instead of waiting on someone else going online.
let onlinePresenceSnapshot = new Set<string>();

export function getOnlinePresenceSnapshot(): Set<string> {
  return onlinePresenceSnapshot;
}

/** Lazily creates a single shared Socket.IO connection for the whole app, authenticated via
 *  the same httpOnly session cookie the REST API uses (see server/src/lib/chatSocket.ts) —
 *  no separate token/handshake needed. Reused across every component that needs realtime
 *  chat/notification events rather than opening a new connection per screen. */
export function getChatSocket(): Socket {
  if (!socket) {
    const socketBase = API_BASE.replace(/\/api\/?$/, "");
    socket = io(socketBase, { withCredentials: true, autoConnect: true });
    socket.on("presence:snapshot", ({ userIds }: { userIds: string[] }) => {
      onlinePresenceSnapshot = new Set(userIds);
    });
    socket.on("presence:online", ({ userId }: { userId: string }) => {
      onlinePresenceSnapshot = new Set(onlinePresenceSnapshot).add(userId);
    });
    socket.on("presence:offline", ({ userId }: { userId: string }) => {
      const next = new Set(onlinePresenceSnapshot);
      next.delete(userId);
      onlinePresenceSnapshot = next;
    });
  }
  return socket;
}
export function disconnectChatSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
  onlinePresenceSnapshot = new Set();
}
