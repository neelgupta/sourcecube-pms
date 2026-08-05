import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { chatUpload } from "../lib/uploads.js";
import { chatUserSelect, createNotification, extractMentionIds, isChannelMember, markNotificationsMessageDeleted, plainTextBody } from "../lib/chat.js";
import { getChatIO } from "../lib/chatSocket.js";
import { getCompanyUserRoles } from "./projects.js";

export const chatRouter = Router();
chatRouter.use(requireAuth, requireCompany);

function tenantId(req: { auth?: { kind: string; tenantId?: string } }): string {
  return (req.auth as { tenantId: string }).tenantId;
}
function userId(req: { auth?: { kind: string; userId?: string } }): string {
  return (req.auth as { userId: string }).userId;
}

const messageInclude = {
  author: { select: chatUserSelect },
  reactions: { include: { user: { select: chatUserSelect } } },
  mentions: { select: { userId: true } },
  _count: { select: { replies: true } },
} as const;

async function activeAnnouncementMembers(tid: string, channelId: string) {
  const [users, memberships] = await Promise.all([
    prisma.companyUser.findMany({
      where: { tenantId: tid, accountStatus: "active" },
      select: { ...chatUserSelect, createdAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.chatChannelMember.findMany({ where: { tenantId: tid, channelId } }),
  ]);
  const membershipByUserId = new Map(memberships.map((member) => [member.userId, member]));
  return users.map((user) => {
    const { createdAt, ...chatUser } = user;
    const membership = membershipByUserId.get(user.id);
    return {
      id: membership?.id ?? `announcement-${channelId}-${user.id}`,
      tenantId: tid,
      channelId,
      userId: user.id,
      user: chatUser,
      isMuted: membership?.isMuted ?? false,
      lastReadAt: membership?.lastReadAt ?? null,
      joinedAt: membership?.joinedAt ?? createdAt,
    };
  });
}

async function withAnnouncementMembers(channel: any) {
  if (channel.type !== "announcement") return channel;
  return { ...channel, members: await activeAnnouncementMembers(channel.tenantId, channel.id) };
}

async function channelSummary(tid: string, channelId: string) {
  const channel = await prisma.chatChannel.findFirst({
    where: { id: channelId, tenantId: tid },
    include: {
      members: { include: { user: { select: chatUserSelect } } },
      project: { select: { id: true, name: true, key: true } },
    },
  });
  return channel ? withAnnouncementMembers(channel) : null;
}

// ---- All-users directory (available to every role — distinct from the admin-facing
// company_users:view endpoint, which most roles don't hold) ----
chatRouter.get("/users", requirePermission("chat", "view"), async (req, res) => {
  const users = await prisma.companyUser.findMany({
    where: { tenantId: tenantId(req), accountStatus: "active" },
    select: { ...chatUserSelect, roles: true },
    orderBy: { name: "asc" },
  });
  res.json({ users });
});

// ---- Channels ----
chatRouter.get("/channels", requirePermission("chat", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  // Self-healing for tenants created before the announcement channel was auto-provisioned
  // (server/src/routes/companies.ts) — avoids a one-off backfill migration.
  const hasAnnouncementChannel = await prisma.chatChannel.count({ where: { tenantId: tid, type: "announcement" } });
  if (!hasAnnouncementChannel) {
    await prisma.chatChannel.create({ data: { tenantId: tid, type: "announcement", name: "Announcements", createdBy: uid } });
  }
  const channels = await prisma.chatChannel.findMany({
    where: {
      tenantId: tid,
      isArchived: false,
      OR: [
        { type: "announcement" },
        { members: { some: { userId: uid } } },
      ],
    },
    include: {
      members: { include: { user: { select: chatUserSelect } } },
      project: { select: { id: true, name: true, key: true } },
      messages: { where: { isDeleted: false, parentMessageId: null }, orderBy: { createdAt: "desc" }, take: 1, include: messageInclude },
    },
    orderBy: { updatedAt: "desc" },
  });
  const memberships = await prisma.chatChannelMember.findMany({ where: { tenantId: tid, userId: uid } });
  const membershipByChannel = new Map(memberships.map((m) => [m.channelId, m]));
  const rows = await Promise.all(channels.map(async (channel) => {
    const membership = membershipByChannel.get(channel.id);
    const lastReadAt = membership?.lastReadAt ?? null;
    const isFavorite = membership?.isFavorite ?? false;
    const unreadCount = await prisma.chatMessage.count({
      where: {
        channelId: channel.id,
        isDeleted: false,
        parentMessageId: null,
        authorId: { not: uid },
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
    return withAnnouncementMembers({ ...channel, lastReadAt, isFavorite, unreadCount });
  }));
  res.json({ channels: rows });
});

const createChannelSchema = z.object({
  type: z.enum(["group", "dm"]),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  memberIds: z.array(z.string()).min(1),
});

chatRouter.post("/channels", requirePermission("chat", "create"), async (req, res) => {
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const data = parsed.data;
  const memberIds = [...new Set([uid, ...data.memberIds])];

  if (data.type === "dm") {
    const isSelfDm = memberIds.length === 1 && memberIds[0] === uid;
    if (!isSelfDm && memberIds.length !== 2) {
      res.status(400).json({ error: "A direct message must have exactly 2 participants" });
      return;
    }
    const existing = await prisma.chatChannel.findFirst({
      where: isSelfDm
        ? { tenantId: tid, type: "dm", members: { every: { userId: uid } } }
        : {
            tenantId: tid,
            type: "dm",
            members: { every: { userId: { in: memberIds } } },
            AND: [{ members: { some: { userId: memberIds[0] } } }, { members: { some: { userId: memberIds[1] } } }],
          },
      include: { members: true },
    });
    if (existing && existing.members.length === memberIds.length) {
      res.json({ channel: await channelSummary(tid, existing.id) });
      return;
    }
  }

  const validMembers = await prisma.companyUser.count({ where: { id: { in: memberIds }, tenantId: tid, accountStatus: "active" } });
  if (validMembers !== memberIds.length) {
    res.status(400).json({ error: "One or more members were not found" });
    return;
  }

  const channel = await prisma.chatChannel.create({
    data: {
      tenantId: tid,
      type: data.type,
      name: data.type === "group" ? data.name ?? null : null,
      description: data.description ?? null,
      createdBy: uid,
      members: { create: memberIds.map((id) => ({ tenantId: tid, userId: id })) },
    },
  });

  await recordAudit({ actor: req.auth!, action: "chat.channel.created", tenantId: tid, targetType: "ChatChannel", targetId: channel.id, metadata: { type: data.type } });

  if (memberIds.some((memberId) => memberId !== uid)) {
    const creator = await prisma.companyUser.findFirst({ where: { id: uid, tenantId: tid }, select: { name: true } });
    for (const memberId of memberIds) {
      if (memberId === uid) continue;
      getChatIO()?.to(`user:${memberId}`).emit("channel:new", { channelId: channel.id });
      await createNotification({ tenantId: tid, userId: memberId, type: "channel_invite", title: data.type === "dm" ? `New direct message from ${creator?.name ?? "someone"}` : `${creator?.name ?? "Someone"} added you to ${data.name ?? "a group"}`, channelId: channel.id, actorId: uid });
    }
  }

  res.status(201).json({ channel: await channelSummary(tid, channel.id) });
});

chatRouter.post("/channels/:id/read", requirePermission("chat", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const channelId = req.params.id as string;
  const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, tenantId: tid }, include: { project: { select: { name: true, key: true } } } });
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  const isAnnouncement = channel.type === "announcement";
  if (!isAnnouncement && !(await isChannelMember(tid, channelId, uid))) {
    res.status(403).json({ error: "Not a member of this channel" });
    return;
  }
  const readAt = new Date();
  await prisma.chatChannelMember.upsert({
    where: { channelId_userId: { channelId, userId: uid } },
    create: { tenantId: tid, channelId, userId: uid, lastReadAt: readAt },
    update: { lastReadAt: readAt },
  });
  getChatIO()?.to(`channel:${channelId}`).emit("channel:read", { channelId, userId: uid, readAt: readAt.toISOString() });
  res.json({ ok: true });
});

const addMembersSchema = z.object({ memberIds: z.array(z.string()).min(1) });

chatRouter.post("/channels/:id/members", requirePermission("chat", "invite"), async (req, res) => {
  const parsed = addMembersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "memberIds is required" });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const channelId = req.params.id as string;
  const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, tenantId: tid }, include: { project: { select: { name: true, key: true } } } });
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  if (channel.type !== "group") {
    res.status(400).json({ error: "Members can only be added to group channels" });
    return;
  }
  if (!(await isChannelMember(tid, channelId, uid))) {
    res.status(403).json({ error: "Not a member of this channel" });
    return;
  }
  const memberIds = [...new Set(parsed.data.memberIds)];
  const validMembers = await prisma.companyUser.count({ where: { id: { in: memberIds }, tenantId: tid, accountStatus: "active" } });
  if (validMembers !== memberIds.length) {
    res.status(400).json({ error: "One or more members were not found" });
    return;
  }
  const existing = await prisma.chatChannelMember.findMany({ where: { channelId, userId: { in: memberIds } }, select: { userId: true } });
  const existingIds = new Set(existing.map((m) => m.userId));
  const newMemberIds = memberIds.filter((id) => !existingIds.has(id));
  if (newMemberIds.length === 0) {
    res.json({ channel: await channelSummary(tid, channelId) });
    return;
  }
  await prisma.chatChannelMember.createMany({
    data: newMemberIds.map((memberId) => ({ tenantId: tid, channelId, userId: memberId })),
  });
  await recordAudit({ actor: req.auth!, action: "chat.channel.members_added", tenantId: tid, targetType: "ChatChannel", targetId: channelId, metadata: { memberIds: newMemberIds } });
  const inviter = await prisma.companyUser.findFirst({ where: { id: uid, tenantId: tid }, select: { name: true } });
  for (const memberId of newMemberIds) {
    getChatIO()?.to(`user:${memberId}`).emit("channel:new", { channelId });
    await createNotification({ tenantId: tid, userId: memberId, type: "channel_invite", title: `${inviter?.name ?? "Someone"} added you to ${channel.name ?? "a group"}`, channelId, actorId: uid });
  }
  const updated = await channelSummary(tid, channelId);
  getChatIO()?.to(`channel:${channelId}`).emit("channel:updated", updated);
  res.status(201).json({ channel: updated });
});

chatRouter.delete("/channels/:id/members/:userId", requirePermission("chat", "invite"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const channelId = req.params.id as string;
  const removedUserId = req.params.userId as string;
  const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, tenantId: tid }, include: { project: { select: { name: true, key: true } } } });
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  if (channel.type !== "group") {
    res.status(400).json({ error: "Members can only be removed from group channels" });
    return;
  }
  if (channel.createdBy !== uid) {
    res.status(403).json({ error: "Only the group owner can remove members" });
    return;
  }
  const membership = await prisma.chatChannelMember.findUnique({ where: { channelId_userId: { channelId, userId: removedUserId } } });
  if (!membership) {
    res.status(404).json({ error: "This person is not a member of the group" });
    return;
  }
  const [remover, removed] = await Promise.all([
    prisma.companyUser.findFirst({ where: { id: uid, tenantId: tid }, select: { name: true } }),
    prisma.companyUser.findFirst({ where: { id: removedUserId, tenantId: tid }, select: { name: true } }),
  ]);
  await prisma.chatChannelMember.delete({ where: { channelId_userId: { channelId, userId: removedUserId } } });

  const systemMessage = await prisma.chatMessage.create({
    data: {
      tenantId: tid,
      channelId,
      authorId: uid,
      isSystem: true,
      body: `${remover?.name ?? "Someone"} removed ${removed?.name ?? "a member"} from the group`,
    },
    include: messageInclude,
  });
  await prisma.chatChannel.update({ where: { id: channelId }, data: { updatedAt: new Date() } });

  await recordAudit({ actor: req.auth!, action: "chat.channel.member_removed", tenantId: tid, targetType: "ChatChannel", targetId: channelId, metadata: { removedUserId } });

  const io = getChatIO();
  io?.to(`channel:${channelId}`).emit("message:new", systemMessage);
  io?.to(`user:${removedUserId}`).emit("channel:removed", { channelId });

  const updated = await channelSummary(tid, channelId);
  io?.to(`channel:${channelId}`).emit("channel:updated", updated);
  res.json({ channel: updated });
});

const favoriteSchema = z.object({ isFavorite: z.boolean() });

chatRouter.patch("/channels/:id/favorite", requirePermission("chat", "view"), async (req, res) => {
  const parsed = favoriteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "isFavorite must be a boolean" });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const channelId = req.params.id as string;
  const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, tenantId: tid }, include: { project: { select: { name: true, key: true } } } });
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  await prisma.chatChannelMember.upsert({
    where: { channelId_userId: { channelId, userId: uid } },
    create: { tenantId: tid, channelId, userId: uid, isFavorite: parsed.data.isFavorite },
    update: { isFavorite: parsed.data.isFavorite },
  });
  res.json({ ok: true });
});

// ---- Messages ----
const listMessagesQuery = z.object({
  before: z.string().datetime().optional(),
  parentMessageId: z.string().optional(),
});

chatRouter.get("/channels/:id/messages", requirePermission("chat", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const channelId = req.params.id as string;
  const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, tenantId: tid }, include: { project: { select: { name: true, key: true } } } });
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  if (channel.type !== "announcement" && !(await isChannelMember(tid, channelId, uid))) {
    res.status(403).json({ error: "Not a member of this channel" });
    return;
  }
  const parsed = listMessagesQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { before, parentMessageId } = parsed.data;
  const messages = await prisma.chatMessage.findMany({
    where: {
      channelId,
      isDeleted: false,
      parentMessageId: parentMessageId ?? null,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    include: messageInclude,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ messages: messages.reverse() });
});

const createMessageSchema = z.object({
  body: z.string().trim().max(24000).optional(),
  parentMessageId: z.string().optional(),
  isAnnouncement: z.boolean().optional(),
  attachmentType: z.enum(["file", "voice_note"]).optional(),
  attachmentUrl: z.string().optional(),
  attachmentName: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
});

chatRouter.post("/channels/:id/messages", requirePermission("chat", "create"), async (req, res) => {
  const parsed = createMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const data = parsed.data;
  if (!data.body?.trim() && !data.attachmentUrl) {
    res.status(400).json({ error: "Message must have a body or an attachment" });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const channelId = req.params.id as string;
  const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, tenantId: tid }, include: { project: { select: { name: true, key: true } } } });
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  const member = await isChannelMember(tid, channelId, uid);
  if (channel.type === "announcement") {
    const roles = await getCompanyUserRoles(tid, uid);
    if (!roles.includes("company_super_admin")) {
      res.status(403).json({ error: "Only a company super admin can post announcements" });
      return;
    }
  } else if (!member) {
    res.status(403).json({ error: "Not a member of this channel" });
    return;
  }

  const channelRecipients = channel.type === "announcement"
    ? []
    : await prisma.chatChannelMember.findMany({ where: { channelId, userId: { not: uid } }, select: { userId: true } });
  const channelRecipientIds = channelRecipients.map((recipient) => recipient.userId);
  const wantsEveryoneMention = Boolean(data.body && /(^|\s)@everyone\b/i.test(data.body) && (channel.type === "group" || channel.type === "project"));
  const directMentionIds = data.body ? extractMentionIds(data.body).filter((mentionUserId) => mentionUserId !== uid && (channel.type === "announcement" || channelRecipientIds.includes(mentionUserId))) : [];
  const mentionIds = [...new Set(wantsEveryoneMention ? [...directMentionIds, ...channelRecipientIds] : directMentionIds)];
  const message = await prisma.chatMessage.create({
    data: {
      tenantId: tid,
      channelId,
      authorId: uid,
      parentMessageId: data.parentMessageId ?? null,
      body: data.body?.trim() || null,
      attachmentType: data.attachmentType ?? null,
      attachmentUrl: data.attachmentUrl ?? null,
      attachmentName: data.attachmentName ?? null,
      durationSeconds: data.durationSeconds ?? null,
      isAnnouncement: channel.type === "announcement" || Boolean(data.isAnnouncement),
      mentions: mentionIds.length ? { create: mentionIds.map((mentionUserId) => ({ tenantId: tid, userId: mentionUserId })) } : undefined,
    },
    include: messageInclude,
  });

  await prisma.chatChannel.update({ where: { id: channelId }, data: { updatedAt: new Date() } });
  await prisma.chatChannelMember.update({
    where: { channelId_userId: { channelId, userId: uid } },
    data: { lastReadAt: new Date() },
  }).catch(() => undefined);

  await recordAudit({ actor: req.auth!, action: "chat.message.created", tenantId: tid, targetType: "ChatMessage", targetId: message.id, metadata: { channelId } });

  const io = getChatIO();
  io?.to(`channel:${channelId}`).emit("message:new", message);
  // Also notify each recipient's personal room with a lighter event, not just the channel room —
  // a client only joins a channel's socket room while that specific chat is open (see
  // MessageThread's channel:join), so anyone with a different channel open (or no chat page open
  // at all) would otherwise never learn a new message arrived, leaving the sidebar unread badge
  // stale until a reload. Deliberately a distinct event (not another message:new) so a client
  // that's in both rooms — i.e. has this exact channel open — doesn't double-count/double-render.
  const unreadEventRecipientIds = channel.type === "announcement"
    ? (await prisma.companyUser.findMany({ where: { tenantId: tid, accountStatus: "active", id: { not: uid } }, select: { id: true } })).map((u) => u.id)
    : channelRecipientIds;
  for (const recipientId of unreadEventRecipientIds) {
    io?.to(`user:${recipientId}`).emit("channel:unread", { channelId });
  }

  const notificationBody = data.body ? plainTextBody(data.body).slice(0, 140) : undefined;

  const senderName = message.author.name;
  const channelContext = channel.type === "project"
    ? `Project: ${channel.project?.name ?? channel.name ?? "Project"}`
    : channel.type === "group"
      ? `Group: ${channel.name ?? "Group chat"}`
      : channel.type === "announcement"
        ? "Announcements"
        : "Direct message";
  const messageTitle = channel.type === "dm" ? `${senderName} sent you a message` : `${senderName} in ${channelContext}`;
  const mentionTitle = channel.type === "dm" ? `${senderName} mentioned you` : `${senderName} mentioned you in ${channelContext}`;

  if (channel.type === "announcement") {
    const everyone = await prisma.companyUser.findMany({ where: { tenantId: tid, accountStatus: "active", id: { not: uid } }, select: { id: true } });
    for (const target of everyone) {
      await createNotification({ tenantId: tid, userId: target.id, type: "announcement", title: `${senderName} in ${channelContext}`, body: notificationBody, channelId, messageId: message.id, actorId: uid });
    }
  } else {
    for (const recipient of channelRecipients) {
      if (mentionIds.includes(recipient.userId)) continue;
      await createNotification({ tenantId: tid, userId: recipient.userId, type: "message", title: messageTitle, body: notificationBody, channelId, messageId: message.id, actorId: uid });
    }
  }
  for (const mentionUserId of mentionIds) {
    await createNotification({ tenantId: tid, userId: mentionUserId, type: "mention", title: mentionTitle, body: notificationBody, channelId, messageId: message.id, actorId: uid });
  }

  res.status(201).json({ message });
});

const editMessageSchema = z.object({ body: z.string().trim().min(1).max(24000) });

chatRouter.patch("/messages/:id", requirePermission("chat", "create"), async (req, res) => {
  const parsed = editMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Message body is required" });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const messageId = req.params.id as string;
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, tenantId: tid } });
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (message.authorId !== uid) {
    res.status(403).json({ error: "You can only edit your own messages" });
    return;
  }
  if (message.isDeleted) {
    res.status(400).json({ error: "Cannot edit a deleted message" });
    return;
  }
  const mentionIds = extractMentionIds(parsed.data.body);
  const updated = await prisma.chatMessage.update({
    where: { id: messageId },
    data: {
      body: parsed.data.body.trim(),
      editedAt: new Date(),
      mentions: {
        deleteMany: {},
        create: mentionIds.map((mentionUserId) => ({ tenantId: tid, userId: mentionUserId })),
      },
    },
    include: messageInclude,
  });
  getChatIO()?.to(`channel:${message.channelId}`).emit("message:updated", updated);
  res.json({ message: updated });
});

chatRouter.delete("/messages/:id", requirePermission("chat", "create"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const messageId = req.params.id as string;
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, tenantId: tid } });
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  const roles = await getCompanyUserRoles(tid, uid);
  if (message.authorId !== uid && !roles.includes("company_super_admin")) {
    res.status(403).json({ error: "You can only delete your own messages" });
    return;
  }
  await prisma.chatMessage.update({ where: { id: messageId }, data: { isDeleted: true, body: null, attachmentUrl: null } });
  getChatIO()?.to(`channel:${message.channelId}`).emit("message:deleted", { messageId, channelId: message.channelId });
  await markNotificationsMessageDeleted(tid, messageId);
  res.status(204).end();
});

chatRouter.patch("/messages/:id/pin", requirePermission("chat", "manage"), async (req, res) => {
  const tid = tenantId(req);
  const messageId = req.params.id as string;
  const parsed = z.object({ isPinned: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "isPinned must be a boolean" });
    return;
  }
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, tenantId: tid } });
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  const updated = await prisma.chatMessage.update({ where: { id: messageId }, data: { isPinned: parsed.data.isPinned }, include: messageInclude });
  getChatIO()?.to(`channel:${message.channelId}`).emit("message:updated", updated);
  res.json({ message: updated });
});

// ---- Reactions ----
const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(8) });

chatRouter.post("/messages/:id/reactions", requirePermission("chat", "create"), async (req, res) => {
  const parsed = reactionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const messageId = req.params.id as string;
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, tenantId: tid } });
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  await prisma.chatReaction.upsert({
    where: { messageId_userId_emoji: { messageId, userId: uid, emoji: parsed.data.emoji } },
    create: { tenantId: tid, messageId, userId: uid, emoji: parsed.data.emoji },
    update: {},
  });
  const updated = await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
  getChatIO()?.to(`channel:${message.channelId}`).emit("message:updated", updated);
  res.json({ message: updated });
});

chatRouter.delete("/messages/:id/reactions/:emoji", requirePermission("chat", "create"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const messageId = req.params.id as string;
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, tenantId: tid } });
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  await prisma.chatReaction.deleteMany({ where: { messageId, userId: uid, emoji: req.params.emoji as string } });
  const updated = await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
  getChatIO()?.to(`channel:${message.channelId}`).emit("message:updated", updated);
  res.json({ message: updated });
});

// ---- Notifications ----
chatRouter.get("/notifications", requirePermission("chat", "view"), async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { tenantId: tenantId(req), userId: userId(req) },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  res.json({ notifications });
});

chatRouter.post("/notifications/read-all", requirePermission("chat", "view"), async (req, res) => {
  await prisma.notification.updateMany({
    where: { tenantId: tenantId(req), userId: userId(req), readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

chatRouter.post("/notifications/:id/read", requirePermission("chat", "view"), async (req, res) => {
  const notification = await prisma.notification.findFirst({ where: { id: req.params.id as string, tenantId: tenantId(req), userId: userId(req) } });
  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

// ---- Upload (files + voice notes) ----
chatRouter.post("/upload", requirePermission("chat", "create"), chatUpload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  res.status(201).json({
    url: `/uploads/chat/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
  });
});
