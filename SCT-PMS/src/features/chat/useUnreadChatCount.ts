import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getChatSocket } from "@/lib/chatSocket";
import { useSession } from "@/lib/session";

/** Tracks the total unread-channel count app-wide (sidebar badge), independent of whether
 *  ChatPage/useChatData is mounted — the socket connection is a shared singleton, so this
 *  stays live even while the user is on a completely different page. */
export function useUnreadChatCount(enabled: boolean) {
  const { session } = useSession();
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const currentUserId = session?.user.kind === "company" ? session.user.id : "";

  useEffect(() => {
    if (!enabled) return;
    api.listChatChannels()
      .then(({ channels }) => {
        setUnreadByChannel(Object.fromEntries(channels.map((channel) => [channel.id, channel.unreadCount])));
      })
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getChatSocket();

    // channel:unread is a dedicated event for this personal-room delivery, distinct from
    // message:new (channel-room-only) — see server/src/routes/chat.ts's POST /messages handler.
    // Using the same event here would double-count for a channel the user currently has open,
    // since that socket sits in both the channel room and its own user room simultaneously.
    function onChannelUnread({ channelId }: { channelId: string }) {
      setUnreadByChannel((current) => ({ ...current, [channelId]: (current[channelId] ?? 0) + 1 }));
    }
    function onChannelRead({ channelId, userId }: { channelId: string; userId: string }) {
      if (userId !== currentUserId) return;
      setUnreadByChannel((current) => ({ ...current, [channelId]: 0 }));
    }
    function onNewChannel() {
      api.listChatChannels()
        .then(({ channels }) => {
          setUnreadByChannel(Object.fromEntries(channels.map((channel) => [channel.id, channel.unreadCount])));
        })
        .catch(() => undefined);
    }

    socket.on("channel:unread", onChannelUnread);
    socket.on("channel:read", onChannelRead);
    socket.on("channel:new", onNewChannel);
    return () => {
      socket.off("channel:unread", onChannelUnread);
      socket.off("channel:read", onChannelRead);
      socket.off("channel:new", onNewChannel);
    };
  }, [enabled, currentUserId]);

  return Object.values(unreadByChannel).reduce((sum, count) => sum + count, 0);
}
