import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { getChatSocket } from "@/lib/chatSocket";
import { useSession } from "@/lib/session";
import type { ChatChannel, ChatMessage, Notification } from "@/types/tenant";

/** Loads channels + notifications once, then keeps them live via the shared Socket.IO
 *  connection — channel previews/unread counts update on `message:new`, and notifications
 *  stream in on `notification:new` without polling.
 *  `activeChannelId` is the channel currently open on screen — a new message there is already
 *  visible to the user, so it must never bump that channel's own unread badge. */
export function useChatData(activeChannelId?: string | null) {
  const { session } = useSession();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = session?.user.kind === "company" ? session.user.id : "";
  const activeChannelIdRef = useRef(activeChannelId);
  activeChannelIdRef.current = activeChannelId;

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
      // Thread replies (parentMessageId set) never appear in the main scrolling thread —
      // only inside that message's own side panel — so they must never become the sidebar
      // preview or count toward the channel's unread badge the way a top-level message does.
      if (message.parentMessageId) return;
      const isViewingChannel = message.channelId === activeChannelIdRef.current;
      setChannels((current) => current.map((channel) => {
        if (channel.id !== message.channelId) return channel;
        const isMine = message.authorId === currentUserId;
        return {
          ...channel,
          messages: [message],
          updatedAt: message.createdAt,
          unreadCount: isMine || isViewingChannel ? channel.unreadCount : channel.unreadCount + 1,
        };
      }));
      // The channel is already open, so the message is immediately visible — tell the
      // server it's read too, otherwise the badge would reappear on next reload/reconnect.
      if (isViewingChannel && message.authorId !== currentUserId) {
        api.markChannelRead(message.channelId).catch(() => undefined);
      }
    }

    // Keeps the sidebar's sent/read tick live — without this, the other member's
    // lastReadAt in the channel list only updates on the next full reload/reconnect.
    function onChannelRead({ channelId, userId, readAt }: { channelId: string; userId: string; readAt: string }) {
      setChannels((current) => current.map((channel) => {
        if (channel.id !== channelId) return channel;
        return {
          ...channel,
          members: channel.members.map((member) => (member.userId === userId ? { ...member, lastReadAt: readAt } : member)),
        };
      }));
    }

    function onNewChannel() {
      loadChannels();
    }
    // The sidebar preview (channel.messages[0]) is only ever pushed by message:new — if the
    // message currently shown as the preview gets deleted, nothing here would otherwise know
    // to drop it, so the preview kept showing stale/removed text until a manual reload.
    function onMessageDeleted({ messageId, channelId }: { messageId: string; channelId: string }) {
      setChannels((current) => {
        const channel = current.find((item) => item.id === channelId);
        if (!channel?.messages?.some((message) => message.id === messageId)) return current;
        loadChannels();
        return current;
      });
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

    // A dropped connection can miss events entirely (Socket.IO doesn't replay them), so on
    // every reconnect — not just first connect — pull a fresh snapshot to backfill whatever
    // was missed while offline, rather than leaving stale unread counts/notifications.
    let hasConnectedBefore = false;
    function onConnect() {
      if (hasConnectedBefore) {
        loadChannels();
        loadNotifications();
      }
      hasConnectedBefore = true;
    }

    socket.on("connect", onConnect);
    socket.on("message:new", bumpChannel);
    socket.on("message:deleted", onMessageDeleted);
    socket.on("channel:read", onChannelRead);
    socket.on("channel:new", onNewChannel);
    socket.on("channel:updated", onChannelUpdated);
    socket.on("notification:new", onNewNotification);
    socket.on("presence:snapshot", onPresenceSnapshot);
    socket.on("presence:online", onPresenceOnline);
    socket.on("presence:offline", onPresenceOffline);
    return () => {
      socket.off("connect", onConnect);
      socket.off("message:new", bumpChannel);
      socket.off("message:deleted", onMessageDeleted);
      socket.off("channel:read", onChannelRead);
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

  async function setChannelFavorite(channelId: string, isFavorite: boolean) {
    setChannels((current) => current.map((channel) => (channel.id === channelId ? { ...channel, isFavorite } : channel)));
    await api.setChatChannelFavorite(channelId, isFavorite);
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
    setChannelFavorite,
  };
}
