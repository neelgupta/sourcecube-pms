import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedChannelId = searchParams.get("channel");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(requestedChannelId);
  // Distinguishes "nothing selected yet on initial load" (auto-select the first channel) from
  // "the person tapped Back on a narrow screen to return to the channel list" (respect that
  // choice) — both states look identical as activeChannelId === null, so without this flag the
  // auto-select effect below immediately re-opened the very thread Back was meant to leave.
  const [deselected, setDeselected] = useState(false);
  const { channels, loading, error, currentUserId, onlineUserIds, reloadChannels, clearUnread, createChannel, updateChannel, setChannelFavorite } = useChatData(activeChannelId);
  const [showDirectory, setShowDirectory] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);

  useEffect(() => {
    api.listChatUsers().then(({ users: rows }) => setUsers(rows)).catch(() => undefined);
  }, []);

  // Deep-link from a notification: whenever ?channel=<id> changes (including repeat clicks on
  // notifications for the same channel while already on /chat), jump straight to that channel
  // instead of leaving whatever was last open selected.
  useEffect(() => {
    if (requestedChannelId && requestedChannelId !== activeChannelId) {
      setShowDirectory(false);
      setActiveChannelId(requestedChannelId);
    }
    if (requestedChannelId) setSearchParams((params) => { params.delete("channel"); return params; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedChannelId]);

  useEffect(() => {
    if (!activeChannelId && !deselected && channels.length > 0) selectChannel(channels[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, activeChannelId, deselected]);

  const activeChannel: ChatChannel | undefined = channels.find((channel) => channel.id === activeChannelId);

  function selectChannel(channel: ChatChannel) {
    setShowDirectory(false);
    setDeselected(false);
    setActiveChannelId(channel.id);
    if (requestedChannelId) setSearchParams((params) => { params.delete("channel"); return params; }, { replace: true });
  }

  async function startDirectMessage(userId: string) {
    const channel = await createChannel({ type: "dm", memberIds: [userId] });
    setShowDirectory(false);
    setActiveChannelId(channel.id);
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-500">Loading chat…</div>;
  }

  // Below md, the 88px main sidebar plus this 288px channel list left almost no room for the
  // thread itself (single words were wrapping one letter per line) — there was no responsive
  // handling at all, both panels stayed put regardless of viewport width. Now, on narrow screens,
  // exactly one of {channel list, active thread/directory} shows at a time: the list is visible
  // only when nothing is selected, and picking a channel (or Back in MessageThread's header)
  // toggles which one is shown. At md+ both panels sit side by side as before.
  const showThreadPane = showDirectory || Boolean(activeChannel);
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
        className={cn(showThreadPane && "hidden md:flex")}
      />

      <div className={cn("h-full min-h-0 min-w-0 flex-1 flex-col", showThreadPane ? "flex" : "hidden md:flex")}>
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
            onRead={clearUnread}
            onBack={() => { setDeselected(true); setActiveChannelId(null); }}
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
