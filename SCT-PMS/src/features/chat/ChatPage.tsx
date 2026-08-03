import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import { usePermission, useSession } from "@/lib/session";
import type { ChatChannel, ChatUser } from "@/types/tenant";
import { useChatData } from "./useChatData";
import { ChannelList } from "./components/ChannelList";
import { MessageThread } from "./components/MessageThread";
import { NewChannelModal } from "./components/NewChannelModal";
import { UserDirectory } from "./components/UserDirectory";

export function ChatPage() {
  const { session } = useSession();
  const canPost = usePermission("chat", "create");
  const canManage = usePermission("chat", "manage");
  const canInvite = usePermission("chat", "invite") || canManage;
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const { channels, loading, error, currentUserId, onlineUserIds, reloadChannels, markChannelRead, createChannel, updateChannel, setChannelFavorite } = useChatData(activeChannelId);
  const [showDirectory, setShowDirectory] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);

  useEffect(() => {
    api.listChatUsers().then(({ users: rows }) => setUsers(rows)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activeChannelId && channels.length > 0) setActiveChannelId(channels[0].id);
  }, [channels, activeChannelId]);

  const activeChannel: ChatChannel | undefined = channels.find((channel) => channel.id === activeChannelId);

  function selectChannel(channel: ChatChannel) {
    setShowDirectory(false);
    setActiveChannelId(channel.id);
    if (channel.unreadCount > 0) markChannelRead(channel.id);
  }

  async function startDirectMessage(userId: string) {
    const channel = await createChannel({ type: "dm", memberIds: [userId] });
    setShowDirectory(false);
    setActiveChannelId(channel.id);
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-500">Loading chat…</div>;
  }

  return (
    <div className="flex h-full min-h-0 bg-white">
      <ChannelList
        channels={channels}
        activeChannelId={showDirectory ? undefined : (activeChannelId ?? undefined)}
        currentUserId={currentUserId}
        canCreate={canPost}
        onlineUserIds={onlineUserIds}
        onSelect={selectChannel}
        onCreateNew={() => setShowNewChannel(true)}
        onToggleFavorite={setChannelFavorite}
      />

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-ink-200 px-3 py-1.5">
          <button
            onClick={() => setShowDirectory(true)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${showDirectory ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-ink-100"}`}
          >
            <Users size={13} /> All Users
          </button>
        </div>

        {error && <div className="m-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</div>}

        {showDirectory ? (
          <UserDirectory users={users} currentUserId={currentUserId} onlineUserIds={onlineUserIds} onStartDirectMessage={startDirectMessage} />
        ) : activeChannel ? (
          <MessageThread
            channel={activeChannel}
            users={users}
            currentUserId={currentUserId}
            canManage={canManage}
            canPost={activeChannel.type === "announcement" ? canManage : canPost}
            canInvite={canInvite}
            onlineUserIds={onlineUserIds}
            onChannelUpdated={updateChannel}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-500">
            {session?.user.kind === "company" ? "Select a conversation or start a new one." : ""}
          </div>
        )}
      </div>

      <NewChannelModal
        open={showNewChannel}
        onClose={() => setShowNewChannel(false)}
        users={users}
        currentUserId={currentUserId}
        canCreateGroup={canInvite}
        onCreate={async (input) => {
          const channel = await createChannel(input);
          setActiveChannelId(channel.id);
          setShowDirectory(false);
          await reloadChannels();
          return channel;
        }}
      />
    </div>
  );
}
