import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserMinus, UserPlus, X } from "lucide-react";
import { Button, EmptyState, MemberAvatar, Modal } from "@/components/common";
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
  onRead,
}: {
  channel: ChatChannel;
  users: ChatUser[];
  currentUserId: string;
  canManage: boolean;
  canPost: boolean;
  canInvite: boolean;
  onlineUserIds: Set<string>;
  onChannelUpdated?: (channel: ChatChannel) => void;
  onRead?: (channelId: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<ChatMessage | null>(null);
  const [readReceipts, setReadReceipts] = useState<Record<string, string>>({});
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showMemberList, setShowMemberList] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const memberMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMemberList) return;
    function handlePointerDown(event: PointerEvent) {
      if (memberMenuRef.current?.contains(event.target as Node)) return;
      setShowMemberList(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowMemberList(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showMemberList]);
  useEffect(() => {
    setLoading(true);
    setActiveThread(null);
    setShowMemberList(false);
    setReadReceipts(Object.fromEntries(
      channel.members
        .filter((member) => member.userId !== currentUserId && member.lastReadAt)
        .map((member) => [member.userId, member.lastReadAt as string]),
    ));
    api.listChatMessages(channel.id)
      .then(({ messages: rows }) => { setMessages(rows); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Messages could not be loaded"))
      .finally(() => setLoading(false));

    const socket = getChatSocket();
    socket.emit("channel:join", channel.id);
    // Socket.IO rejoins no rooms automatically after a dropped connection recovers —
    // "connect" fires on every reconnect too, so without this the client silently stops
    // receiving message:new/channel:read for whatever channel is open until it's switched
    // away from and back (this was the cause of intermittent missed realtime updates).
    function rejoinOnReconnect() { socket.emit("channel:join", channel.id); }
    socket.on("connect", rejoinOnReconnect);
    return () => {
      socket.off("connect", rejoinOnReconnect);
      socket.emit("channel:leave", channel.id);
    };
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
        if (message.authorId === currentUserId) return;
        setActiveThread((current) => (current && current.id === message.parentMessageId ? { ...current, _count: { replies: current._count.replies + 1 } } : current));
        setMessages((current) => current.map((item) => (item.id === message.parentMessageId ? { ...item, _count: { replies: item._count.replies + 1 } } : item)));
        return;
      }
      if (message.authorId === currentUserId && !message.isSystem) return;
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
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
    // This is the single source of truth for marking a channel read — it fires whenever the
    // thread is on screen, however it got there (sidebar click, auto-selected first channel,
    // deep link). The result must be reported back up via onRead so the sidebar's unreadCount
    // badge (owned by ChatPage/useChatData, not this component) actually clears — otherwise
    // the server-side read is recorded correctly but the badge stays stuck until a full reload.
    // Only counts as "read" while the tab is actually focused — mounting in the background
    // (e.g. this was the last-open channel when the tab regains state) must not silently mark
    // messages read that the user hasn't actually looked at yet.
    function markRead() {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      api.markChannelRead(channel.id).then(() => onRead?.(channel.id)).catch(() => undefined);
    }
    markRead();
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  async function sendMessage(input: Parameters<typeof api.sendChatMessage>[1], parentMessageId?: string) {
    const { message } = await api.sendChatMessage(channel.id, { ...input, parentMessageId });
    if (parentMessageId) {
      setActiveThread((current) => (current && current.id === parentMessageId ? { ...current, _count: { replies: current._count.replies + 1 } } : current));
      setMessages((current) => current.map((item) => (item.id === parentMessageId ? { ...item, _count: { replies: item._count.replies + 1 } } : item)));
    } else {
      setMessages((current) => [...current, message]);
    }
    return message;
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
  async function confirmRemoveMember() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const { channel: updated } = await api.removeChatChannelMember(channel.id, removeTarget.userId);
      onChannelUpdated?.(updated);
      setRemoveTarget(null);
    } finally {
      setRemoving(false);
    }
  }

  const pinned = messages.filter((message) => message.isPinned && !message.isDeleted);
  const otherMembersLastRead = channel.members
    .filter((m) => m.userId !== currentUserId)
    .map((m) => {
      const live = readReceipts[m.userId];
      const base = m.lastReadAt ? new Date(m.lastReadAt).getTime() : 0;
      return live ? Math.max(base, new Date(live).getTime()) : base;
    });
  const latestOtherRead = otherMembersLastRead.length > 0 ? Math.max(...otherMembersLastRead) : 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <header className="relative flex items-start gap-3 border-b border-ink-200 px-4 py-3">
          <div ref={memberMenuRef} className="min-w-0 flex-1">
            <p className="truncate font-semibold text-ink-900">{channelTitle(channel, currentUserId)}</p>
            <HeaderMembers channel={channel} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onToggle={() => setShowMemberList((value) => !value)} />
            {showMemberList && (
              <HeaderMemberDropdown channel={channel} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onRemoveMember={(userId, name) => setRemoveTarget({ userId, name })} />
            )}
          </div>
          {pinned.length > 0 && <span className="shrink-0 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700">{pinned.length} pinned</span>}
          {channel.type === "group" && canInvite && (
            <button
              onClick={() => setShowAddMembers(true)}
              title="Add members"
              className="shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-900"
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
              {messages.map((message, index) => (
                <div key={message.id}>
                  {(index === 0 || dayKey(message.createdAt) !== dayKey(messages[index - 1].createdAt)) && (
                    <DateSeparator date={message.createdAt} />
                  )}
                  <MessageBubble
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
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {canPost ? (
          <MessageComposer users={users} onSend={async (input) => { await sendMessage(input); }} />
        ) : (
          <div className="border-t border-ink-200 bg-surface-subtle px-4 py-3 text-center text-xs text-ink-500">
            {channel.type === "announcement" ? "Only a company super admin can post announcements." : "You do not have permission to post here."}
          </div>
        )}
      </div>



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

      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove member?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={removing}>Cancel</Button>
            <Button variant="danger" onClick={confirmRemoveMember} disabled={removing}>{removing ? "Removing…" : "Remove"}</Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          Are you sure you want to remove <strong>{removeTarget?.name}</strong> from this group?
        </p>
      </Modal>
    </div>
  );
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="my-2 flex items-center justify-center">
      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-ink-400 shadow-sm">{dateLabel(date)}</span>
    </div>
  );
}

function channelTitle(channel: ChatChannel, currentUserId: string) {
  if (channel.type === "announcement") return "Announcements";
  if (channel.type === "project") return channel.project?.name ?? channel.name ?? "Project channel";
  if (channel.type === "dm") {
    const other = channel.members.find((member) => member.userId !== currentUserId);
    if (!other) {
      const self = channel.members.find((member) => member.userId === currentUserId);
      return self ? `${self.user.name} (you)` : "Notes to self";
    }
    return other.user.name;
  }
  return channel.name ?? "Group";
}


function channelMembers(channel: ChatChannel, currentUserId: string) {
  const otherMember = channel.type === "dm" ? channel.members.find((member) => member.userId !== currentUserId) : undefined;
  return channel.type === "dm" && otherMember ? [otherMember] : channel.members;
}

function HeaderMembers({
  channel,
  currentUserId,
  onlineUserIds,
  onToggle,
}: {
  channel: ChatChannel;
  currentUserId: string;
  onlineUserIds: Set<string>;
  onToggle: () => void;
}) {
  const members = channelMembers(channel, currentUserId);
  const otherMember = channel.type === "dm" ? channel.members.find((member) => member.userId !== currentUserId) : undefined;
  if (channel.type === "dm" && otherMember) {
    const online = onlineUserIds.has(otherMember.userId);
    return <p className={cn("mt-0.5 truncate text-xs", online ? "text-success-600" : "text-ink-400")}>{online ? "Online" : "Offline"}</p>;
  }
  if (channel.type === "dm") return <p className="mt-0.5 truncate text-xs text-ink-400">Only visible to you</p>;
  const visible = members.slice(0, 5);
  return (
    <button type="button" onClick={onToggle} className="mt-1 flex max-w-full items-center gap-2 rounded-lg py-1 pr-2 text-left hover:bg-ink-50">
      <div className="flex shrink-0 -space-x-1">
        {visible.map((member) => (
          <MemberAvatar key={member.userId} id={member.userId} name={member.user.name} size="xs" status={onlineUserIds.has(member.userId) ? "online" : "offline"} className="ring-2 ring-white" />
        ))}
      </div>
      <span className="min-w-0 truncate text-xs text-ink-500">
        {members.length} {members.length === 1 ? "person" : "people"} in this chat
        {channel.description ? ` - ${channel.description}` : ""}
      </span>
      <ChevronDown size={13} className="shrink-0 text-ink-400" />
    </button>
  );
}

function HeaderMemberDropdown({
  channel,
  currentUserId,
  onlineUserIds,
  onRemoveMember,
}: {
  channel: ChatChannel;
  currentUserId: string;
  onlineUserIds: Set<string>;
  onRemoveMember: (userId: string, name: string) => void;
}) {
  const members = channelMembers(channel, currentUserId);
  const isOwner = channel.createdBy === currentUserId;
  const title = channel.type === "announcement" ? "Announcement members" : "Members";
  return (
    <div className="absolute left-4 top-full z-20 mt-2 w-72 rounded-2xl border border-ink-100 bg-white p-4 shadow-xl">
      <div className="mb-3">
        <p className="text-sm font-bold text-ink-900">{title}</p>
        <p className="mt-0.5 text-xs text-ink-400">{members.length} {members.length === 1 ? "person" : "people"} in this chat</p>
      </div>
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {members.map((member) => {
          const isOnline = onlineUserIds.has(member.userId);
          const canRemove = isOwner && channel.type === "group" && member.userId !== currentUserId;
          return (
            <div key={member.id} className="flex min-w-0 items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-surface-subtle">
              <MemberAvatar id={member.userId} name={member.user.name} size="md" status={isOnline ? "online" : "offline"} className="ring-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-900">{member.user.name}</p>
                <p className="truncate text-xs text-ink-400">{member.userId === currentUserId ? "You" : isOnline ? "Online" : "Offline"}</p>
              </div>
              {canRemove && (
                <button onClick={() => onRemoveMember(member.userId, member.user.name)} title="Remove from group" className="shrink-0 rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600">
                  <UserMinus size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
  onSend: (input: Parameters<typeof api.sendChatMessage>[1]) => Promise<ChatMessage>;
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
      if (message.parentMessageId === root.id && message.authorId !== currentUserId) {
        setReplies((current) => [...current, message]);
      }
    }
    socket.on("message:new", onNew);
    return () => { socket.off("message:new", onNew); };
  }, [root.id]);

  async function send(input: Parameters<typeof api.sendChatMessage>[1]) {
    const message = await onSend(input);
    setReplies((current) => [...current, message]);
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
