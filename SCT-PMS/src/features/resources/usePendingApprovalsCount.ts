import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Fired whenever something on the Approvals page resolves (approve/reject on any of the three
 *  request types) — the sidebar badge has its own independent poll/focus lifecycle and otherwise
 *  has no way to know the count just changed on the page the user is actively looking at, which
 *  left it showing a stale count until its next unrelated poll/focus tick. */
export const APPROVALS_CHANGED_EVENT = "approvals:changed";
export function notifyApprovalsChanged() {
  window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT));
}

/** Tracks the total count of pending approvals (overdue reviews, re-estimate requests, work-log
 *  change requests) app-wide for the sidebar badge — mirrors useUnreadChatCount's shape, but
 *  polled rather than socket-driven since there's no live channel for approvals yet. Polls only
 *  while enabled (the viewer actually has tasks:approve), and refetches immediately on window
 *  focus/tab-visible (so switching back to the tab doesn't wait out a stale timer) and whenever
 *  notifyApprovalsChanged() fires (so resolving something on the Approvals page itself updates
 *  the badge immediately, not just on the next unrelated poll). */
export function usePendingApprovalsCount(enabled: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let cancelled = false;
    function refetch() {
      Promise.all([api.listOverdueReviews(), api.listReestimateRequests(), api.listTimelogChangeRequests()])
        .then(([{ reviews }, { requests: reestimates }, { requests: timelogs }]) => {
          if (!cancelled) setCount(reviews.length + reestimates.length + timelogs.length);
        })
        .catch(() => undefined);
    }
    refetch();
    const interval = window.setInterval(refetch, 30000);
    function onVisible() { if (document.visibilityState === "visible") refetch(); }
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(APPROVALS_CHANGED_EVENT, refetch);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(APPROVALS_CHANGED_EVENT, refetch);
    };
  }, [enabled]);

  return count;
}
