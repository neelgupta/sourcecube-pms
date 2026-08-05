import { prisma } from "./prisma.js";
import { getChatIO } from "./chatSocket.js";

export const chatUserSelect = { id: true, name: true, email: true, accountStatus: true } as const;

/** Returns true if the user is an active member of the channel (any channel type). */
export async function isChannelMember(tenantId: string, channelId: string, userId: string) {
  const membership = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  return Boolean(membership) && (await prisma.chatChannel.count({ where: { id: channelId, tenantId } })) > 0;
}

/** Extracts @mentioned company-user ids from a message body, given the tenant's active users.
 *  Mentions are written client-side as "@Name" resolved against a picker, so the wire format
 *  the composer sends is "@[userId:Display Name]" — parsed here without needing NLP-style
 *  name matching, which would be ambiguous for duplicate names. */
export function extractMentionIds(body: string): string[] {
  const matches = [...body.matchAll(/@\[([a-zA-Z0-9_-]+):[^\]]*\]/g)];
  return [...new Set(matches.map((match) => match[1]))];
}

/** Strips the "@[userId:Name]" wire format down to "@Name" for plain-text surfaces
 *  (notification previews, desktop notifications) that can't render mention pills. */
export function plainTextBody(body: string): string {
  return body.replace(/@\[[a-zA-Z0-9_-]+:([^\]]*)\]/g, "@$1");
}

/** Joins the given users to a project's collaboration channel, if one exists — called wherever
 *  a user gains project involvement outside the dedicated /members endpoint (e.g. task
 *  assignment), so they land in the project's chat without a separate manual step. */
export async function ensureProjectChatMembers(tenantId: string, projectId: string, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const channel = await prisma.chatChannel.findUnique({ where: { projectId } });
  if (!channel) return;
  await Promise.all(ids.map((userId) => prisma.chatChannelMember.upsert({
    where: { channelId_userId: { channelId: channel.id, userId } },
    create: { tenantId, channelId: channel.id, userId },
    update: {},
  })));
}

export async function createNotification(params: {
  tenantId: string;
  userId: string;
  type: "mention" | "announcement" | "channel_invite" | "message" | "task_overdue_review" | "task_review_resolved";
  title: string;
  body?: string;
  channelId?: string;
  messageId?: string;
  actorId?: string;
}) {
  const notification = await prisma.notification.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      channelId: params.channelId,
      messageId: params.messageId,
      actorId: params.actorId,
    },
  });
  getChatIO()?.to(`user:${params.userId}`).emit("notification:new", notification);
  return notification;
}

/** When a message is deleted, any notification that previewed its text would otherwise keep
 *  showing content that no longer exists in the thread — update those in place (same
 *  notification, not a new one) so the bell reflects the deletion without a page reload. */
export async function markNotificationsMessageDeleted(tenantId: string, messageId: string) {
  const notifications = await prisma.notification.findMany({ where: { tenantId, messageId } });
  if (notifications.length === 0) return;
  await prisma.notification.updateMany({ where: { tenantId, messageId }, data: { body: "This message has been deleted" } });
  const io = getChatIO();
  for (const notification of notifications) {
    io?.to(`user:${notification.userId}`).emit("notification:updated", { ...notification, body: "This message has been deleted" });
  }
}
