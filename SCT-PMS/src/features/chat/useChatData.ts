import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { getChatSocket } from "@/lib/chatSocket";
import { useSession } from "@/lib/session";
import type { ChatChannel, ChatMessage, Notification } from "@/types/tenant";

/** Loads channels + notifications once, then keeps them live via the shared Socket.IO
 *  connection — channel previews/unread counts update on `message:new`, and notifications
 *  stream in on `notification:new` without polling. */
export function useChatData() {
  const { session } = useSession();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = session?.user.kind === "company" ? session.user.id : "";

  function loadChannels() {
    return api.listChatChannels()
      .then(({ channels: rows }) => { setChannels(rows); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Chat could not be loaded"));
  }

  function loadNotifications() {
    return api.listNotifications().then(({ notifications: rows }) => setNotifications(rows)).catch(() => undefined);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadChannels(), loadNotifications()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const socket = getChatSocket();

    function bumpChannel(message: ChatMessage) {
      setChannels((current) => current.map((channel) => {
        if (channel.id !== message.channelId) return channel;
        const isMine = message.authorId === currentUserId;
        return {
          ...channel,
          messages: [message],
          updatedAt: message.createdAt,
          unreadCount: isMine ? channel.unreadCount : channel.unreadCount + 1,
        };
      }));
    }

    function onNewChannel() {
      loadChannels();
    }
    function onChannelUpdated(channel: ChatChannel) {
      setChannels((current) => current.map((item) => (item.id === channel.id ? { ...channel, unreadCount: item.unreadCount, messages: item.messages } : item)));
    }
    function onNewNotification(notification: Notification) {
      setNotifications((current) => [notification, ...current]);
    }
    function onPresenceSnapshot({ userIds }: { userIds: string[] }) {
      setOnlineUserIds(new Set(userIds));
    }
    function onPresenceOnline({ userId }: { userId: string }) {
      setOnlineUserIds((current) => new Set(current).add(userId));
    }
    function onPresenceOffline({ userId }: { userId: string }) {
      setOnlineUserIds((current) => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }

    socket.on("message:new", bumpChannel);
    socket.on("channel:new", onNewChannel);
    socket.on("channel:updated", onChannelUpdated);
    socket.on("notification:new", onNewNotification);
    socket.on("presence:snapshot", onPresenceSnapshot);
    socket.on("presence:online", onPresenceOnline);
    socket.on("presence:offline", onPresenceOffline);
    return () => {
      socket.off("message:new", bumpChannel);
      socket.off("channel:new", onNewChannel);
      socket.off("channel:updated", onChannelUpdated);
      socket.off("notification:new", onNewNotification);
      socket.off("presence:snapshot", onPresenceSnapshot);
      socket.off("presence:online", onPresenceOnline);
      socket.off("presence:offline", onPresenceOffline);
    };
  }, [currentUserId]);

  async function markChannelRead(channelId: string) {
    setChannels((current) => current.map((channel) => (channel.id === channelId ? { ...channel, unreadCount: 0 } : channel)));
    await api.markChannelRead(channelId);
  }

  async function createChannel(input: { type: "group" | "dm"; name?: string; description?: string | null; memberIds: string[] }) {
    const { channel } = await api.createChatChannel(input);
    await loadChannels();
    return channel;
  }

  function updateChannel(channel: ChatChannel) {
    setChannels((current) => current.map((item) => (item.id === channel.id ? { ...channel, unreadCount: item.unreadCount, messages: item.messages } : item)));
  }

  const unreadNotificationCount = notifications.filter((n) => !n.readAt).length;

  return {
    channels,
    notifications,
    unreadNotificationCount,
    onlineUserIds,
    loading,
    error,
    currentUserId,
    reloadChannels: loadChannels,
    reloadNotifications: loadNotifications,
    markChannelRead,
    createChannel,
    updateChannel,
  };
}
