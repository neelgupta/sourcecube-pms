import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getChatSocket } from "@/lib/chatSocket";
import { useSession } from "@/lib/session";
import type { ChatMessage } from "@/types/tenant";

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

    function onNewMessage(message: ChatMessage) {
      if (message.authorId === currentUserId || message.parentMessageId) return;
      setUnreadByChannel((current) => ({ ...current, [message.channelId]: (current[message.channelId] ?? 0) + 1 }));
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

    socket.on("message:new", onNewMessage);
    socket.on("channel:read", onChannelRead);
    socket.on("channel:new", onNewChannel);
    return () => {
      socket.off("message:new", onNewMessage);
      socket.off("channel:read", onChannelRead);
      socket.off("channel:new", onNewChannel);
    };
  }, [enabled, currentUserId]);

  return Object.values(unreadByChannel).reduce((sum, count) => sum + count, 0);
}
