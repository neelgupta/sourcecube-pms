import { Hash, Megaphone, Plus, Users } from "lucide-react";
import { Badge, MemberAvatar } from "@/components/common";
import { cn } from "@/lib/cn";
import type { ChatChannel } from "@/types/tenant";


/** Strips the "@[userId:Name]" wire format down to "@Name" for plain-text previews. */
function plainTextPreview(body: string) {
  return body.replace(/@\[[a-zA-Z0-9_-]+:([^\]]*)\]/g, "@$1");
}

function channelLabel(channel: ChatChannel, currentUserId: string) {
  if (channel.type === "announcement") return "Announcements";
  if (channel.type === "project") return channel.project?.name ?? channel.name ?? "Project";
  if (channel.type === "dm") {
    const other = channel.members.find((member) => member.userId !== currentUserId);
    return other?.user.name ?? "Direct message";
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
}: {
  channels: ChatChannel[];
  activeChannelId?: string;
  currentUserId: string;
  canCreate: boolean;
  onlineUserIds: Set<string>;
  onSelect: (channel: ChatChannel) => void;
  onCreateNew: () => void;
}) {
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
        <Section title="Announcements" channels={announcement} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} />
        <Section title="Projects" channels={projects} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} />
        <Section title="Groups" channels={groups} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} />
        <Section title="Direct messages" channels={dms} activeChannelId={activeChannelId} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onSelect={onSelect} />
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
}: {
  title: string;
  channels: ChatChannel[];
  activeChannelId?: string;
  currentUserId: string;
  onlineUserIds: Set<string>;
  onSelect: (channel: ChatChannel) => void;
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
        const isOnline = isDm && otherUser ? onlineUserIds.has(otherUser.id) : false;
        return (
          <button
            key={channel.id}
            onClick={() => onSelect(channel)}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
              activeChannelId === channel.id ? "bg-brand-50" : "hover:bg-ink-100/60",
            )}
          >
            <span className="relative shrink-0">
              {isDm && otherUser ? (
                <MemberAvatar id={otherUser.id} name={otherUser.name} size="sm" status={isOnline ? "online" : "offline"} className="ring-0" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-ink-500">{channelIcon(channel)}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm", channel.unreadCount > 0 ? "font-semibold text-ink-900" : "text-ink-700")}>{label}</p>
              {lastMessage && (
                <p className="truncate text-xs text-ink-400">
                  {lastMessage.isDeleted ? "Message deleted" : lastMessage.body ? plainTextPreview(lastMessage.body) : "Attachment"}
                </p>
              )}
            </div>
            {channel.unreadCount > 0 && <Badge tone="red" className="shrink-0">{channel.unreadCount}</Badge>}
          </button>
        );
      })}
    </div>
  );
}
