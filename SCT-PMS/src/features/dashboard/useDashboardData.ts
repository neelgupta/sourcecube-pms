import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AssignedTask, RealProject } from "@/types/tenant";

export interface DashboardData {
  projects: RealProject[];
  myTasks: AssignedTask[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Aggregates real, permission-scoped data for the dashboard from the same endpoints
 *  the Projects and Tasks screens use — no separate dashboard API exists, and none is
 *  needed: `listProjects` and `listAssignedTasks` already return exactly what the
 *  current user's role/row-level access permits (see server/BACKEND.md §3). */
export function useDashboardData(): DashboardData {
  const [projects, setProjects] = useState<RealProject[]>([]);
  const [myTasks, setMyTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([api.listProjects(), api.listAssignedTasks()])
      .then(([projectsResult, tasksResult]) => {
        setProjects(projectsResult.projects);
        setMyTasks(tasksResult.tasks);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load dashboard data"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return { projects, myTasks, loading, error, reload: load };
}

export function isOverdue(dueDate?: string | null, status?: string) {
  return Boolean(dueDate) && new Date(dueDate as string) < new Date() && status !== "done" && status !== "completed";
}

export function isDueToday(dueDate?: string | null) {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
}

export function formatHoursMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
