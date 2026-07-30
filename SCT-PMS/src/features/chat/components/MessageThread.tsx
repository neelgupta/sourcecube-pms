import { useEffect, useRef, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { EmptyState, MemberAvatar } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { getChatSocket } from "@/lib/chatSocket";
import { cn } from "@/lib/cn";
import type { ChatChannel, ChatMessage, ChatUser } from "@/types/tenant";
import { AddMembersModal } from "./AddMembersModal";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";

export function MessageThread({
  channel,
  users,
  currentUserId,
  canManage,
  canPost,
  canInvite,
  onlineUserIds,
  onChannelUpdated,
}: {
  channel: ChatChannel;
  users: ChatUser[];
  currentUserId: string;
  canManage: boolean;
  canPost: boolean;
  canInvite: boolean;
  onlineUserIds: Set<string>;
  onChannelUpdated?: (channel: ChatChannel) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<ChatMessage | null>(null);
  const [readReceipts, setReadReceipts] = useState<Record<string, string>>({});
  const [showAddMembers, setShowAddMembers] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setActiveThread(null);
    setReadReceipts({});
    api.listChatMessages(channel.id)
      .then(({ messages: rows }) => { setMessages(rows); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Messages could not be loaded"))
      .finally(() => setLoading(false));

    const socket = getChatSocket();
    socket.emit("channel:join", channel.id);
    return () => { socket.emit("channel:leave", channel.id); };
  }, [channel.id]);

  useEffect(() => {
    const socket = getChatSocket();
    function onChannelRead(payload: { channelId: string; userId: string; readAt: string }) {
      if (payload.channelId !== channel.id || payload.userId === currentUserId) return;
      setReadReceipts((current) => ({ ...current, [payload.userId]: payload.readAt }));
    }
    socket.on("channel:read", onChannelRead);
    return () => { socket.off("channel:read", onChannelRead); };
  }, [channel.id, currentUserId]);

  useEffect(() => {
    const socket = getChatSocket();
    function onNew(message: ChatMessage) {
      if (message.channelId !== channel.id) return;
      if (message.parentMessageId) {
        setActiveThread((current) => (current && current.id === message.parentMessageId ? { ...current, _count: { replies: current._count.replies + 1 } } : current));
        return;
      }
      setMessages((current) => [...current, message]);
    }
    function onUpdated(message: ChatMessage) {
      if (message.channelId !== channel.id) return;
      setMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
      setActiveThread((current) => (current && current.id === message.id ? message : current));
    }
    function onDeleted({ messageId, channelId }: { messageId: string; channelId: string }) {
      if (channelId !== channel.id) return;
      setMessages((current) => current.map((item) => (item.id === messageId ? { ...item, isDeleted: true, body: null } : item)));
    }
    socket.on("message:new", onNew);
    socket.on("message:updated", onUpdated);
    socket.on("message:deleted", onDeleted);
    return () => {
      socket.off("message:new", onNew);
      socket.off("message:updated", onUpdated);
      socket.off("message:deleted", onDeleted);
    };
  }, [channel.id]);

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, loading]);

  useEffect(() => {
    api.markChannelRead(channel.id).catch(() => undefined);
  }, [channel.id]);

  async function sendMessage(input: Parameters<typeof api.sendChatMessage>[1], parentMessageId?: string) {
    const { message } = await api.sendChatMessage(channel.id, { ...input, parentMessageId });
    if (parentMessageId) {
      setActiveThread((current) => (current && current.id === parentMessageId ? { ...current, _count: { replies: current._count.replies + 1 } } : current));
    } else {
      setMessages((current) => [...current, message]);
    }
  }

  async function reactTo(messageId: string, emoji: string) {
    const { message } = await api.addChatReaction(messageId, emoji);
    setMessages((current) => current.map((item) => (item.id === messageId ? message : item)));
  }
  async function unreactFrom(messageId: string, emoji: string) {
    const { message } = await api.removeChatReaction(messageId, emoji);
    setMessages((current) => current.map((item) => (item.id === messageId ? message : item)));
  }
  async function deleteMessage(messageId: string) {
    await api.deleteChatMessage(messageId);
    setMessages((current) => current.map((item) => (item.id === messageId ? { ...item, isDeleted: true, body: null } : item)));
  }
  async function togglePin(message: ChatMessage) {
    const { message: updated } = await api.pinChatMessage(message.id, !message.isPinned);
    setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }
  async function editMessage(messageId: string, body: string) {
    const { message: updated } = await api.editChatMessage(messageId, body);
    setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }
  async function addMembers(memberIds: string[]) {
    const { channel: updated } = await api.addChatChannelMembers(channel.id, memberIds);
    onChannelUpdated?.(updated);
  }

  const pinned = messages.filter((message) => message.isPinned && !message.isDeleted);
  const otherMember = channel.type === "dm" ? channel.members.find((m) => m.userId !== currentUserId) : undefined;
  const isOtherOnline = otherMember ? onlineUserIds.has(otherMember.userId) : false;
  const otherMembersLastRead = channel.members
    .filter((m) => m.userId !== currentUserId)
    .map((m) => {
      const live = readReceipts[m.userId];
      const base = m.lastReadAt ? new Date(m.lastReadAt).getTime() : 0;
      return live ? Math.max(base, new Date(live).getTime()) : base;
    });
  const latestOtherRead = otherMembersLastRead.length > 0 ? Math.max(...otherMembersLastRead) : 0;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink-900">{channelTitle(channel, currentUserId)}</p>
            {channel.type === "dm" ? (
              <p className={cn("truncate text-xs", isOtherOnline ? "text-success-600" : "text-ink-400")}>{isOtherOnline ? "Online" : "Offline"}</p>
            ) : channel.description ? (
              <p className="truncate text-xs text-ink-500">{channel.description}</p>
            ) : null}
          </div>
          {pinned.length > 0 && <span className={cn("rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700", channel.type === "group" && canInvite ? "" : "ml-auto")}>{pinned.length} pinned</span>}
          {channel.type === "group" && canInvite && (
            <button
              onClick={() => setShowAddMembers(true)}
              title="Add members"
              className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            >
              <UserPlus size={14} /> Add member
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-subtle/40">
          {loading ? (
            <div className="p-8 text-center text-sm text-ink-500">Loading...</div>
          ) : error ? (
            <div className="p-4 text-sm text-danger-600">{error}</div>
          ) : messages.length === 0 ? (
            <EmptyState title="No messages yet" description="Say hello to get the conversation started." className="py-16" />
          ) : (
            <div className="py-3">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  users={users}
                  currentUserId={currentUserId}
                  canManage={canManage}
                  isRead={message.authorId === currentUserId && new Date(message.createdAt).getTime() <= latestOtherRead}
                  onReact={(emoji) => reactTo(message.id, emoji)}
                  onUnreact={(emoji) => unreactFrom(message.id, emoji)}
                  onDelete={() => deleteMessage(message.id)}
                  onEdit={(body) => editMessage(message.id, body)}
                  onPin={() => togglePin(message)}
                  onOpenThread={() => setActiveThread(message)}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {canPost ? (
          <MessageComposer users={users} onSend={(input) => sendMessage(input)} />
        ) : (
          <div className="border-t border-ink-200 bg-surface-subtle px-4 py-3 text-center text-xs text-ink-500">
            {channel.type === "announcement" ? "Only a company super admin can post announcements." : "You do not have permission to post here."}
          </div>
        )}
      </div>

      {!activeThread && (
        <ChatMemberPanel channel={channel} currentUserId={currentUserId} onlineUserIds={onlineUserIds} />
      )}

      {activeThread && (
        <ThreadPanel
          channelId={channel.id}
          root={activeThread}
          users={users}
          currentUserId={currentUserId}
          canManage={canManage}
          canPost={canPost}
          onClose={() => setActiveThread(null)}
          onSend={(input) => sendMessage(input, activeThread.id)}
        />
      )}

      {channel.type === "group" && (
        <AddMembersModal
          open={showAddMembers}
          onClose={() => setShowAddMembers(false)}
          channel={channel}
          users={users}
          onAdd={addMembers}
        />
      )}
    </div>
  );
}

function channelTitle(channel: ChatChannel, currentUserId: string) {
  if (channel.type === "announcement") return "Announcements";
  if (channel.type === "project") return channel.project?.name ?? channel.name ?? "Project channel";
  if (channel.type === "dm") {
    const other = channel.members.find((member) => member.userId !== currentUserId);
    return other?.user.name ?? "Direct message";
  }
  return channel.name ?? "Group";
}


function ChatMemberPanel({
  channel,
  currentUserId,
  onlineUserIds,
}: {
  channel: ChatChannel;
  currentUserId: string;
  onlineUserIds: Set<string>;
}) {
  const otherMember = channel.type === "dm" ? channel.members.find((member) => member.userId !== currentUserId) : undefined;
  const members = channel.type === "dm" && otherMember ? [otherMember] : channel.members;
  const title = channel.type === "dm" ? "Members" : channel.type === "announcement" ? "Announcement members" : "Members";

  return (
    <aside className="hidden h-full w-64 shrink-0 border-l border-ink-200 bg-surface-subtle px-3 py-4 xl:block">
      {otherMember && (
        <div className="mb-4 rounded-2xl border border-ink-100 bg-white p-5 text-center shadow-sm">
          <div className="flex justify-center">
            <MemberAvatar
              id={otherMember.userId}
              name={otherMember.user.name}
              size="lg"
              status={onlineUserIds.has(otherMember.userId) ? "online" : "offline"}
              className="h-16 w-16 text-xl ring-0"
            />
          </div>
          <p className="mt-3 truncate text-sm font-bold text-ink-900">{otherMember.user.name}</p>
          <p className="mt-1 text-xs text-ink-400">direct</p>
        </div>
      )}

      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <p className="text-sm font-bold text-ink-900">{title}</p>
          <p className="mt-0.5 text-xs text-ink-400">{members.length} {members.length === 1 ? "person" : "people"} in this chat</p>
        </div>
        <div className="max-h-[calc(100vh-18rem)] space-y-2 overflow-y-auto pr-1">
          {members.map((member) => {
            const isOnline = onlineUserIds.has(member.userId);
            return (
              <div key={member.id} className="flex min-w-0 items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-surface-subtle">
                <MemberAvatar id={member.userId} name={member.user.name} size="md" status={isOnline ? "online" : "offline"} className="ring-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">{member.user.name}</p>
                  <p className="truncate text-xs text-ink-400">{member.userId === currentUserId ? "You" : isOnline ? "Online" : "Offline"}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
function ThreadPanel({
  channelId,
  root,
  users,
  currentUserId,
  canManage,
  canPost,
  onClose,
  onSend,
}: {
  channelId: string;
  root: ChatMessage;
  users: ChatUser[];
  currentUserId: string;
  canManage: boolean;
  canPost: boolean;
  onClose: () => void;
  onSend: (input: Parameters<typeof api.sendChatMessage>[1]) => Promise<void>;
}) {
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.listChatMessages(channelId, { parentMessageId: root.id })
      .then(({ messages: rows }) => setReplies(rows))
      .finally(() => setLoading(false));
  }, [channelId, root.id]);

  useEffect(() => {
    const socket = getChatSocket();
    function onNew(message: ChatMessage) {
      if (message.parentMessageId === root.id) setReplies((current) => [...current, message]);
    }
    socket.on("message:new", onNew);
    return () => { socket.off("message:new", onNew); };
  }, [root.id]);

  async function send(input: Parameters<typeof api.sendChatMessage>[1]) {
    await onSend(input);
  }

  async function editReply(messageId: string, body: string) {
    const { message } = await api.editChatMessage(messageId, body);
    setReplies((current) => current.map((item) => (item.id === message.id ? message : item)));
  }

  return (
    <div className="flex h-full w-[26rem] shrink-0 flex-col border-l border-ink-200 bg-white">
      <header className="flex items-center justify-between border-b border-ink-200 px-3 py-3">
        <p className="font-semibold text-ink-900">Thread</p>
        <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-100"><X size={16} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-subtle/40 py-2">
        <MessageBubble message={root} users={users} currentUserId={currentUserId} canManage={canManage} onReact={() => {}} onUnreact={() => {}} onDelete={() => {}} onEdit={(body) => editReply(root.id, body)} showThreadAction={false} />
        <div className="mx-4 border-t border-dashed border-ink-200 py-2 text-center text-[11px] uppercase tracking-wide text-ink-400">Replies</div>
        {loading ? (
          <div className="p-4 text-center text-xs text-ink-500">Loading...</div>
        ) : (
          replies.map((reply) => (
            <MessageBubble key={reply.id} message={reply} users={users} currentUserId={currentUserId} canManage={canManage} onReact={() => {}} onUnreact={() => {}} onDelete={() => {}} onEdit={(body) => editReply(reply.id, body)} showThreadAction={false} />
          ))
        )}
      </div>
      {canPost && <MessageComposer users={users} onSend={send} placeholder="Reply in thread..." />}
    </div>
  );
}
