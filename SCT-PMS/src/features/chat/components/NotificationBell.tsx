import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { AlertTriangle, AtSign, Bell, BellRing, CheckCircle2, List, Megaphone, MessageCircle, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { getChatSocket } from "@/lib/chatSocket";
import {
  getDesktopNotificationPermission,
  isDesktopNotificationSupported,
  requestDesktopNotificationPermission,
  showDesktopNotification,
} from "@/lib/desktopNotifications";
import { usePermission } from "@/lib/session";
import { cn } from "@/lib/cn";
import { projectWorkspacePath } from "@/features/projects/projectRoutes";
import type { Notification, NotificationType } from "@/types/tenant";

const typeIcons: Record<NotificationType, React.ReactNode> = {
  mention: <AtSign size={14} className="text-brand-600" />,
  announcement: <Megaphone size={14} className="text-warning-600" />,
  channel_invite: <UserPlus size={14} className="text-success-600" />,
  message: <MessageCircle size={14} className="text-info-600" />,
  task_overdue_review: <AlertTriangle size={14} className="text-danger-600" />,
  task_review_resolved: <CheckCircle2 size={14} className="text-success-600" />,
  task_assigned: <List size={14} className="text-blue-600" />,
};

/** Sends the user to whatever the notification is actually about — a chat message/mention
 *  stays in Chat, but a task-related notification (overdue review, resolution) has nothing to
 *  do with chat and must land on that task's project workspace instead. Falls back to the
 *  numeric-id project route if the project fetch fails, mirroring how the Resources page's
 *  "open task" action already handles the same project-name-slug requirement. */
async function goToNotificationTarget(navigate: NavigateFunction, notification: Notification) {
  if (notification.taskId && notification.projectId) {
    try {
      const result = await api.getProject(notification.projectId);
      navigate(`${projectWorkspacePath(result.project)}?task=${notification.taskId}`);
    } catch {
      navigate(`/projects/${notification.projectId}?task=${notification.taskId}`);
    }
    return;
  }
  navigate(notification.channelId ? `/chat?channel=${notification.channelId}` : "/chat");
}


function timeAgo(value: string) {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const canUseChat = usePermission("chat", "view");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [desktopPermission, setDesktopPermission] = useState(getDesktopNotificationPermission());
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canUseChat) return;
    api.listNotifications().then(({ notifications: rows }) => setNotifications(rows)).catch(() => undefined);
    const socket = getChatSocket();
    function onNew(notification: Notification) {
      setNotifications((current) => [notification, ...current].slice(0, 8));
      // Desktop notifications are for when the user isn't already looking at the tab —
      // if it's visible and focused, the in-app bell badge is enough.
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        showDesktopNotification(notification.title, {
          body: notification.body ?? undefined,
          tag: notification.id,
          onClick: () => goToNotificationTarget(navigate, notification),
        });
      }
    }
    function onUpdated(notification: Notification) {
      setNotifications((current) => current.map((item) => (item.id === notification.id ? notification : item)));
    }
    socket.on("notification:new", onNew);
    socket.on("notification:updated", onUpdated);
    return () => {
      socket.off("notification:new", onNew);
      socket.off("notification:updated", onUpdated);
    };
  }, [canUseChat, navigate]);

  useEffect(() => {
    function handler(event: MouseEvent) {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  if (!canUseChat) return null;

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  async function openNotification(notification: Notification) {
    if (!notification.readAt) {
      await api.markNotificationRead(notification.id);
      setNotifications((current) => current.map((item) => (item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item)));
    }
    setOpen(false);
    await goToNotificationTarget(navigate, notification);
  }

  async function markAllRead() {
    await api.markAllNotificationsRead();
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
  }

  async function enableDesktopNotifications() {
    const result = await requestDesktopNotificationPermission();
    if (result !== "unsupported") setDesktopPermission(result);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        <span className="relative">
          <Bell size={18} />
          {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger-500 ring-2 ring-white" />}
        </span>
      </button>
      {open && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: coords.top, right: coords.right }}
          className="z-50 flex max-h-[min(32rem,calc(100vh-5rem))] w-80 flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-popover">
          <div className="flex shrink-0 items-center justify-between border-b border-ink-200 px-3.5 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Notifications</p>
            {unreadCount > 0 && <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:underline">Mark all read</button>}
          </div>
          {isDesktopNotificationSupported() && desktopPermission === "default" && (
            <div className="flex shrink-0 items-start gap-2.5 border-b border-ink-100 bg-brand-50/50 px-3.5 py-2.5">
              <BellRing size={15} className="mt-0.5 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink-900">Get notified even when this tab isn't focused</p>
                <button onClick={enableDesktopNotifications} className="mt-1 text-xs font-semibold text-brand-600 hover:underline">
                  Enable desktop notifications
                </button>
              </div>
            </div>
          )}
          {isDesktopNotificationSupported() && desktopPermission === "denied" && (
            <div className="shrink-0 border-b border-ink-100 bg-warning-50/50 px-3.5 py-2 text-xs text-warning-700">
              Desktop notifications are blocked. Enable them from your browser's site settings.
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-400">No notifications yet</p>
            ) : (
              notifications.slice(0, 30).map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => openNotification(notification)}
                  className={cn("flex w-full items-start gap-2.5 border-b border-ink-100 px-3.5 py-2.5 text-left last:border-0 hover:bg-brand-50/40", !notification.readAt && "bg-brand-50/20")}
                >
                  <span className="mt-0.5 shrink-0">{typeIcons[notification.type]}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm", !notification.readAt ? "font-semibold text-ink-900" : "text-ink-700")}>{notification.title}</p>
                    {notification.body && <p className="truncate text-xs text-ink-500">{notification.body}</p>}
                    <p className="mt-0.5 text-[11px] text-ink-400">{timeAgo(notification.createdAt)}</p>
                  </div>
                  {!notification.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
