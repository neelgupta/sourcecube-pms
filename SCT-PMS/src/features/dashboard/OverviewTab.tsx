import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, ChevronRight, Clock, FolderOpen, ListChecks, Trophy } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, MemberAvatar } from "@/components/common";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { formatHoursMinutes, isOverdue, useDashboardData } from "./useDashboardData";
import { TaskActivityChart } from "./components/TaskActivityCard";

export type RangePreset = "today" | "this_week" | "last_week" | "this_month";

export const rangePresetOptions: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
];

function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}
/** Monday-start week bounds for the week containing `date`. */
function weekBounds(date: Date) {
  const weekday = (date.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday);
  return { start, end: addDays(start, 6) };
}
function atMidnight(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}
function atEndOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}
function presetRange(preset: RangePreset): { start: Date; end: Date } {
  const today = new Date();
  if (preset === "today") return { start: atMidnight(today), end: atEndOfDay(today) };
  if (preset === "this_week") { const { start, end } = weekBounds(today); return { start: atMidnight(start), end: atEndOfDay(end) }; }
  if (preset === "last_week") { const { start } = weekBounds(addDays(today, -7)); return { start: atMidnight(start), end: atEndOfDay(addDays(start, 6)) }; }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: atMidnight(start), end: atEndOfDay(end) };
}
function dayKeysBetween(start: Date, end: Date) {
  const keys: Date[] = [];
  let cursor = atMidnight(start);
  const last = atMidnight(end);
  while (cursor <= last) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
}

export function OverviewTab() {
  const [preset, setPreset] = useState<RangePreset>("this_week");
  const { session } = useSession();
  const { projects, myTasks, loading, error } = useDashboardData();

  const stats = useMemo(() => {
    const total = myTasks.length;
    const completed = myTasks.filter((t) => t.status === "done").length;
    const overdue = myTasks.filter((t) => isOverdue(t.dueDate, t.status)).length;
    const pending = total - completed;
    return [
      { label: "Total Projects", value: projects.length, icon: FolderOpen, tone: "text-info-600 bg-info-50" },
      { label: "My Tasks", value: total, icon: ListChecks, tone: "text-warning-600 bg-warning-50" },
      { label: "Completed Tasks", value: completed, icon: CheckCircle2, tone: "text-success-600 bg-success-50" },
      { label: "Pending Tasks", value: pending, icon: Clock, tone: "text-purple-600 bg-purple-50" },
      { label: "Overdue Tasks", value: overdue, icon: AlertCircle, tone: "text-danger-600 bg-danger-50" },
    ];
  }, [projects, myTasks]);

  const dueTasks = useMemo(
    () => myTasks
      .filter((t) => t.status !== "done" && t.dueDate)
      .sort((a, b) => new Date(a.dueDate as string).getTime() - new Date(b.dueDate as string).getTime())
      .slice(0, 8),
    [myTasks],
  );

  const trackedToday = useMemo(() => {
    const today = new Date();
    return myTasks
      .map((task) => {
        const seconds = task.timeEntries
          .filter((entry) => new Date(entry.startedAt).toDateString() === today.toDateString())
          .reduce((sum, entry) => sum + entry.durationSeconds, 0);
        return { task, seconds };
      })
      .filter((row) => row.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds);
  }, [myTasks]);

  const range = useMemo(() => presetRange(preset), [preset]);

  const leaderboard = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const task of myTasks) {
      if (!task.completedAt || !task.assignee) continue;
      const completed = new Date(task.completedAt);
      if (completed < range.start || completed > range.end) continue;
      const entry = counts.get(task.assignee.id) ?? { name: task.assignee.name, count: 0 };
      entry.count += 1;
      counts.set(task.assignee.id, entry);
    }
    return Array.from(counts.entries())
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [myTasks, range]);

  const activitySeries = useMemo(() => {
    const days = dayKeysBetween(range.start, range.end);
    const byDay = new Map(days.map((day) => [atMidnight(day).getTime(), 0]));
    for (const task of myTasks) {
      if (!task.completedAt) continue;
      const completed = atMidnight(new Date(task.completedAt));
      if (completed.getTime() < atMidnight(range.start).getTime() || completed.getTime() > atMidnight(range.end).getTime()) continue;
      const key = completed.getTime();
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const labelOptions: Intl.DateTimeFormatOptions = preset === "today"
      ? { hour: "numeric" }
      : preset === "this_month"
      ? { day: "2-digit" }
      : { weekday: "short", day: "2-digit" };
    return days.map((day) => ({
      day: preset === "today" ? "Today" : day.toLocaleDateString(undefined, labelOptions),
      value: byDay.get(day.getTime()) ?? 0,
    }));
  }, [myTasks, range, preset]);

  const activeProjects = projects.filter((p) => p.status === "in_progress" || p.status === "planning" || p.status === "new").slice(0, 5);
  const overdueProjects = projects.filter((p) => isOverdue(p.dueDate, p.status)).slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        {error && <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-3.5 rounded-card border border-ink-200 bg-white px-4 py-4 shadow-card">
              <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", stat.tone)}>
                <stat.icon size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none tracking-tight text-ink-900">{loading ? "—" : stat.value}</p>
                <p className="mt-1.5 truncate text-xs font-medium text-ink-500">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader
              title="Leaderboard"
              action={
                <select
                  value={preset}
                  onChange={(event) => setPreset(event.target.value as RangePreset)}
                  className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-700"
                >
                  {rangePresetOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              }
            />
            <CardBody className="pt-0">
              {leaderboard.length === 0 ? (
                <EmptyState title="No completions yet" description="Ranked by tasks completed in this period." className="py-8" />
              ) : (
                <ul className="space-y-1">
                  {leaderboard.map((entry, index) => (
                    <li key={entry.id} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors", index === 0 ? "bg-brand-50/70" : "hover:bg-ink-100/60")}>
                      <MemberAvatar id={entry.id} name={entry.name} size="md" status="active" className="ring-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900">{entry.name}</p>
                        <p className="truncate text-xs text-ink-500">#{index + 1}</p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-ink-700">
                        <Trophy size={14} className="text-warning-500" />
                        {entry.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <TaskActivityChart data={activitySeries} preset={preset} onPresetChange={setPreset} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Overall Due Tasks"
              action={
                <Link to="/tasks" className="flex items-center gap-0.5 text-sm font-medium text-brand-600 hover:text-brand-700">
                  View All <ChevronRight size={15} />
                </Link>
              }
            />
            <CardBody className="pt-0">
              {dueTasks.length === 0 ? (
                <EmptyState title="Nothing due" className="py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] table-fixed text-sm">
                    <colgroup>
                      <col className="w-2/3" />
                      <col className="w-1/3" />
                    </colgroup>
                    <thead>
                      <tr className="border-y border-ink-200 bg-surface-subtle">
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Task Name</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Project Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dueTasks.map((task) => (
                        <tr key={task.id} className="border-b border-ink-100 last:border-0 hover:bg-brand-50/40">
                          <td className="px-3 py-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 text-xs font-medium text-ink-400">{task.code}</span>
                              <CheckCircle2 size={15} className="shrink-0 text-ink-300" />
                              <Link to={`/projects/${task.project.id}?task=${task.id}`} className="truncate font-medium text-brand-600 hover:underline">{task.name}</Link>
                            </div>
                          </td>
                          <td className="truncate px-3 py-2.5 text-ink-700">{task.project.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Today's Tracked Tasks" />
            <CardBody className="pt-0">
              {trackedToday.length === 0 ? (
                <EmptyState title="No time tracked today" description="Start a timer on any task and it will show up here." />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {trackedToday.map(({ task, seconds }) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link to={`/projects/${task.project.id}?task=${task.id}`} className="truncate text-sm font-medium text-ink-900 hover:text-brand-600">{task.name}</Link>
                      <span className="shrink-0 font-mono text-xs text-ink-600">{formatHoursMinutes(seconds / 60)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="space-y-5">
        <div className="relative overflow-hidden rounded-card border border-brand-100 bg-linear-to-br from-brand-50 to-brand-100/60 p-5 shadow-card">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-200/40" />
          <div className="pointer-events-none absolute -bottom-12 right-6 h-24 w-24 rounded-full bg-brand-300/20" />
          <div className="relative flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
              <Trophy size={20} />
            </div>
            <div>
              <p className="text-sm font-medium text-brand-800">Tasks completed this month</p>
              <p className="mt-0.5 text-2xl font-bold text-navy-900">
                {session?.user.kind === "company" ? (leaderboard.find((e) => e.name === session.user.name)?.count ?? 0) : 0}
              </p>
            </div>
          </div>
        </div>

        <SidePanel title="Active Projects" projects={activeProjects} />
        <SidePanel title="Overdue Projects" projects={overdueProjects} />
      </div>
    </div>
  );
}

function SidePanel({ title, projects }: { title: string; projects: { id: string; name: string }[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-l-[3px] border-brand-500 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <Link to="/projects" className="flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:text-brand-700">
          View All <ChevronRight size={13} />
        </Link>
      </div>
      {projects.length === 0 ? (
        <EmptyState className="py-8" />
      ) : (
        <ul className="divide-y divide-ink-100 px-4 pb-3">
          {projects.map((project) => (
            <li key={project.id} className="py-2">
              <Link to={`/projects/${project.id}`} className="truncate text-sm font-medium text-ink-800 hover:text-brand-600">{project.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
