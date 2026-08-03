import { Check, CheckCheck, Hash, Megaphone, Plus, Star, Users } from "lucide-react";
import { Badge, MemberAvatar } from "@/components/common";
import { cn } from "@/lib/cn";
import type { ChatChannel, ChatMessage } from "@/types/tenant";


/** Strips the "@[userId:Name]" wire format down to "@Name" for plain-text previews. */
function plainTextPreview(body: string) {
  return body.replace(/@\[[a-zA-Z0-9_-]+:([^\]]*)\]/g, "@$1");
}

/** System messages ("Neel removed Jatin from the group") are stored with the actor's real
 *  name baked in, since the DB can't render per-viewer text. Mirrors the same substitution
 *  MessageBubble does in the open thread, so the sidebar preview reads "You removed…" for
 *  whoever actually performed the action instead of showing their own name back at them. */
function systemPreview(message: ChatMessage, currentUserId: string) {
  if (message.authorId === currentUserId && message.author?.name && message.body?.startsWith(message.author.name)) {
    return `You${message.body.slice(message.author.name.length)}`;
  }
  return message.body ?? "";
}

function channelLabel(channel: ChatChannel, currentUserId: string) {
  if (channel.type === "announcement") return "Announcements";
  if (channel.type === "project") return channel.project?.name ?? channel.name ?? "Project";
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

function channelIcon(channel: ChatChannel) {
  if (channel.type === "announcement") return <Megaphone size={14} />;
  if (channel.type === "project") return <Hash size={14} />;
  if (channel.type === "group") return <Users size={14} />;
  return null;
}

export function ChannelList({
  channels,
  activeChannelId,
  currentUserId,
  canCreate,
  onlineUserIds,
  onSelect,
  onCreateNew,
  onToggleFavorite,
}: {
  channels: ChatChannel[];
  activeChannelId?: string;
  currentUserId: string;
  canCreate: boolean;
  onlineUserIds: Set<string>;
  onSelect: (channel: ChatChannel) => void;
  onCreateNew: () => void;
  onToggleFavorite: (channelId: string, isFavorite: boolean) => void;
}) {
  const favorites = channels.filter((c) => c.isFavorite);
  const announcement = channels.filter((c) => c.type === "announcement");
  const projects = channels.filter((c) => c.type === "project");
  const groups = channels.filter((c) => c.type === "group");
  const dms = channels.filter((c) => c.type === "dm");

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-ink-200 bg-white">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-3">
        <p className="font-semibold text-ink-900">Chat</p>
        {canCreate && (
          <button onClick={onCreateNew} title="New conversation" className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-brand-600">
            <Plus size={16} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <Section title="Favorites" channels={favorites} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />
        <Section title="Announcements" channels={announcement} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />
        <Section title="Projects" channels={projects} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />
        <Section title="Groups" channels={groups} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />
        <Section title="Direct messages" channels={dms} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />
      </div>
    </div>
  );
}

function Section({
  title,
  channels,
  activeChannelId,
  currentUserId,
  onlineUserIds,
  onSelect,
  onToggleFavorite,
}: {
  title: string;
  channels: ChatChannel[];
  activeChannelId?: string;
  currentUserId: string;
  onlineUserIds: Set<string>;
  onSelect: (channel: ChatChannel) => void;
  onToggleFavorite: (channelId: string, isFavorite: boolean) => void;
}) {
  if (channels.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      {channels.map((channel) => {
        const label = channelLabel(channel, currentUserId);
        const lastMessage = channel.messages?.[0];
        const isDm = channel.type === "dm";
        const otherUser = isDm ? channel.members.find((m) => m.userId !== currentUserId)?.user : undefined;
        const selfUser = isDm && !otherUser ? channel.members.find((m) => m.userId === currentUserId)?.user : undefined;
        const isOnline = isDm && otherUser ? onlineUserIds.has(otherUser.id) : false;
        const otherMember = isDm ? channel.members.find((m) => m.userId !== currentUserId) : undefined;
        // Read-tick only makes sense for a 1:1 DM — a group/announcement has many readers,
        // so a single "seen" indicator has no well-defined meaning there.
        const isMyLastMessage = isDm && Boolean(lastMessage && !lastMessage.isDeleted && lastMessage.authorId === currentUserId);
        const isLastMessageRead = isMyLastMessage && lastMessage && otherMember?.lastReadAt
          ? new Date(otherMember.lastReadAt).getTime() >= new Date(lastMessage.createdAt).getTime()
          : false;
        return (
          <div
            key={channel.id}
            className={cn(
              "group flex w-full items-center gap-1 px-3 py-2 transition-colors",
              activeChannelId === channel.id ? "bg-brand-50" : "hover:bg-ink-100/60",
            )}
          >
            <button onClick={() => onSelect(channel)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              <span className="relative shrink-0">
                {isDm && otherUser ? (
                  <MemberAvatar id={otherUser.id} name={otherUser.name} size="sm" status={isOnline ? "online" : "offline"} className="ring-0" />
                ) : isDm && selfUser ? (
                  <MemberAvatar id={selfUser.id} name={selfUser.name} size="sm" status="active" className="ring-0" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-ink-500">{channelIcon(channel)}</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm", channel.unreadCount > 0 ? "font-semibold text-ink-900" : "text-ink-700")}>{label}</p>
                {lastMessage && (
                  <p className="flex items-center gap-1 truncate text-xs text-ink-400">
                    {isMyLastMessage && (
                      isLastMessageRead
                        ? <CheckCheck size={12} className="shrink-0 text-sky-500" aria-label="Read" />
                        : <Check size={12} className="shrink-0 text-ink-400" aria-label="Sent" />
                    )}
                    <span className="truncate">
                      {lastMessage.isDeleted
                        ? "Message deleted"
                        : lastMessage.isSystem
                        ? systemPreview(lastMessage, currentUserId)
                        : lastMessage.body
                        ? plainTextPreview(lastMessage.body)
                        : "Attachment"}
                    </span>
                  </p>
                )}
              </div>
              {channel.unreadCount > 0 && <Badge tone="red" className="shrink-0">{channel.unreadCount}</Badge>}
            </button>
            <button
              onClick={() => onToggleFavorite(channel.id, !channel.isFavorite)}
              title={channel.isFavorite ? "Remove from favorites" : "Add to favorites"}
              className={cn(
                "shrink-0 rounded p-1 hover:bg-ink-100",
                channel.isFavorite ? "text-warning-500 opacity-100" : "text-ink-300 opacity-0 group-hover:opacity-100",
              )}
            >
              <Star size={14} fill={channel.isFavorite ? "currentColor" : "none"} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
