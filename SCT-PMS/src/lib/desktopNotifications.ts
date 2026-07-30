/** Thin wrapper around the browser Notification API. Desktop notifications only make sense
 *  when the user isn't already looking at the tab, so callers should gate on document
 *  visibility/focus themselves — this module just handles permission + display. */

export function isDesktopNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getDesktopNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isDesktopNotificationSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestDesktopNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isDesktopNotificationSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function showDesktopNotification(
  title: string,
  options: NotificationOptions & { onClick?: () => void } = {},
) {
  if (!isDesktopNotificationSupported() || Notification.permission !== "granted") return;
  const { onClick, ...rest } = options;
  const notification = new Notification(title, { icon: "/favicon.svg", ...rest });
  if (onClick) {
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  }
}
