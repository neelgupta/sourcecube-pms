import type { ProjectPriority, ProjectTaskStatus } from "@/types/tenant";

export type GroupByOption = "status" | "dates" | "priority" | "assignee";

export const groupByOptionLabels: Record<GroupByOption, string> = {
  status: "Status",
  dates: "Dates",
  priority: "Priority",
  assignee: "Developer",
};

export interface TaskGroup<T> {
  key: string;
  label: string;
  tasks: T[];
}

export const statusGroupLabels: Record<ProjectTaskStatus, string> = {
  new_request: "New Request",
  in_progress: "In Progress",
  done: "Done",
};
const statusGroupOrder: ProjectTaskStatus[] = ["new_request", "in_progress", "done"];

const priorityGroupLabels: Record<ProjectPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};
const priorityGroupOrder: ProjectPriority[] = ["critical", "high", "medium", "low"];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

interface GroupableTask {
  status: ProjectTaskStatus;
  priority: ProjectPriority;
  startDate?: string | null;
  assignee?: { id: string; name: string } | null;
}

/** Buckets tasks by startDate. With no dateRange, the fixed Yesterday/Today/Tomorrow set used
 *  throughout this app; with a dateRange (an active due-date filter, say), one bucket per
 *  calendar day spanned by the range instead — capped at 14 days so an accidentally huge range
 *  doesn't explode into hundreds of near-empty groups, falling back to the day-count message in
 *  that case. A task whose startDate lands outside every bucket (or has no startDate at all)
 *  goes in a trailing "Other" group instead of silently disappearing. */
function dateGroups<T extends GroupableTask>(tasks: T[], dateRange?: { from: string; to: string } | null): TaskGroup<T>[] {
  const buckets: { key: string; label: string; matches: (day: Date) => boolean }[] = [];

  if (dateRange?.from && dateRange.to) {
    const from = startOfDay(new Date(dateRange.from));
    const to = startOfDay(new Date(dateRange.to));
    const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (spanDays > 0 && spanDays <= 14) {
      for (let i = 0; i < spanDays; i += 1) {
        const day = new Date(from.getTime() + i * 86_400_000);
        const key = day.toISOString().slice(0, 10);
        const label = day.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
        buckets.push({ key, label, matches: (candidate) => candidate.getTime() === day.getTime() });
      }
    }
  }

  if (buckets.length === 0) {
    const today = startOfDay(new Date());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    buckets.push(
      { key: "yesterday", label: "Yesterday", matches: (day) => day.getTime() === yesterday.getTime() },
      { key: "today", label: "Today", matches: (day) => day.getTime() === today.getTime() },
      { key: "tomorrow", label: "Tomorrow", matches: (day) => day.getTime() === tomorrow.getTime() },
    );
  }

  const byKey = new Map<string, T[]>();
  const other: T[] = [];
  for (const task of tasks) {
    const day = task.startDate ? startOfDay(new Date(task.startDate)) : null;
    const bucket = day ? buckets.find((candidate) => candidate.matches(day)) : undefined;
    if (!bucket) {
      other.push(task);
      continue;
    }
    const group = byKey.get(bucket.key) ?? [];
    group.push(task);
    byKey.set(bucket.key, group);
  }

  const groups = buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, tasks: byKey.get(bucket.key) ?? [] }));
  if (other.length) groups.push({ key: "other", label: "Other", tasks: other });
  return groups;
}

export function groupTasks<T extends GroupableTask>(
  tasks: T[],
  groupBy: GroupByOption,
  dateRange?: { from: string; to: string } | null,
): TaskGroup<T>[] {
  if (groupBy === "dates") return dateGroups(tasks, dateRange);

  if (groupBy === "status") {
    const byStatus = new Map<ProjectTaskStatus, T[]>();
    for (const task of tasks) {
      const group = byStatus.get(task.status) ?? [];
      group.push(task);
      byStatus.set(task.status, group);
    }
    return statusGroupOrder.map((status) => ({ key: status, label: statusGroupLabels[status], tasks: byStatus.get(status) ?? [] }));
  }

  if (groupBy === "priority") {
    const byPriority = new Map<ProjectPriority, T[]>();
    for (const task of tasks) {
      const group = byPriority.get(task.priority) ?? [];
      group.push(task);
      byPriority.set(task.priority, group);
    }
    return priorityGroupOrder.map((priority) => ({ key: priority, label: priorityGroupLabels[priority], tasks: byPriority.get(priority) ?? [] }));
  }

  // assignee
  const byAssignee = new Map<string, { label: string; tasks: T[] }>();
  for (const task of tasks) {
    const key = task.assignee?.id ?? "unassigned";
    const label = task.assignee?.name ?? "Unassigned";
    const group = byAssignee.get(key) ?? { label, tasks: [] };
    group.tasks.push(task);
    byAssignee.set(key, group);
  }
  const sorted = [...byAssignee.entries()].sort(([keyA, a], [keyB, b]) => {
    if (keyA === "unassigned") return 1;
    if (keyB === "unassigned") return -1;
    return a.label.localeCompare(b.label);
  });
  return sorted.map(([key, group]) => ({ key, label: group.label, tasks: group.tasks }));
}
