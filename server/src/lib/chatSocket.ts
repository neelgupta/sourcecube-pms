import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { parseCookie } from "cookie";
import { verifyToken } from "./jwt.js";
import { prisma } from "./prisma.js";

let io: Server | null = null;
const onlineUsers = new Map<string, number>();

export function getChatIO(): Server | null {
  return io;
}

export function getOnlineUserIds(): string[] {
  return [...onlineUsers.keys()];
}

interface SocketAuth {
  userId: string;
  tenantId: string;
}

function readSocketAuth(socket: Socket): SocketAuth | null {
  const raw = socket.handshake.headers.cookie;
  if (!raw) return null;
  const parsed = parseCookie(raw);
  const token = parsed.token;
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    if (payload.kind !== "company") return null;
    return { userId: payload.userId, tenantId: payload.tenantId };
  } catch {
    return null;
  }
}

/** Wires a Socket.IO server onto the existing HTTP server, reusing the session cookie
 *  (`token`) the REST API already issues — no separate auth handshake needed. Every
 *  connected socket joins a personal room (`user:<id>`) for direct notification delivery,
 *  and joins/leaves channel rooms (`channel:<id>`) on request, after verifying membership. */
export function initChatSocket(httpServer: HttpServer, allowedOrigins: string[]) {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  io.use((socket, next) => {
    const auth = readSocketAuth(socket);
    if (!auth) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.auth = auth;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const auth = socket.data.auth as SocketAuth;
    socket.join(`user:${auth.userId}`);

    const wasOffline = !onlineUsers.has(auth.userId);
    onlineUsers.set(auth.userId, (onlineUsers.get(auth.userId) ?? 0) + 1);
    if (wasOffline) {
      socket.broadcast.emit("presence:online", { userId: auth.userId });
    }
    socket.emit("presence:snapshot", { userIds: getOnlineUserIds() });

    socket.on("disconnect", () => {
      const count = (onlineUsers.get(auth.userId) ?? 1) - 1;
      if (count <= 0) {
        onlineUsers.delete(auth.userId);
        socket.broadcast.emit("presence:offline", { userId: auth.userId });
      } else {
        onlineUsers.set(auth.userId, count);
      }
    });

    socket.on("channel:join", async (channelId: string) => {
      if (typeof channelId !== "string") return;
      const channel = await prisma.chatChannel.findFirst({
        where: { id: channelId, tenantId: auth.tenantId, isArchived: false },
        select: { id: true, type: true },
      });
      if (!channel) return;
      if (channel.type === "announcement") {
        socket.join(`channel:${channelId}`);
        return;
      }
      const membership = await prisma.chatChannelMember.findUnique({
        where: { channelId_userId: { channelId, userId: auth.userId } },
      });
      if (membership) socket.join(`channel:${channelId}`);
    });

    socket.on("channel:leave", (channelId: string) => {
      if (typeof channelId === "string") socket.leave(`channel:${channelId}`);
    });

    socket.on("typing", (payload: { channelId?: string }) => {
      if (!payload?.channelId) return;
      socket.to(`channel:${payload.channelId}`).emit("typing", { channelId: payload.channelId, userId: auth.userId });
    });
  });

  return io;
}
