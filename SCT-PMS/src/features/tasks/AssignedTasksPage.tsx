import { Fragment, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Clock3, FolderKanban, Play, Search } from "lucide-react";
import { Badge, Card, MemberAvatar, Select, Tabs, type TabItem } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { TaskWorkspaceDrawer, TimerStopDialog, type ActiveTaskTimer, type StopTimerTarget } from "@/features/projects/ProjectDetailPage";
import { usePermission } from "@/lib/session";
import { cn } from "@/lib/cn";
import type { AssignedTask, CompanyUser, ProjectMilestone, ProjectPriority, ProjectTaskStatus, TaskBreakdownRow, WorkspaceTask } from "@/types/tenant";

const statusLabels: Record<ProjectTaskStatus, string> = {
  new_request: "New Request",
  in_progress: "In Progress",
  done: "Done",
};
const statusTones: Record<ProjectTaskStatus, "neutral" | "blue" | "green"> = {
  new_request: "neutral",
  in_progress: "blue",
  done: "green",
};
const priorityTones: Record<ProjectPriority, "neutral" | "blue" | "amber" | "red"> = {
  low: "neutral",
  medium: "blue",
  high: "amber",
  critical: "red",
};

const breakdownRoles = new Set(["company_super_admin", "hr_admin", "auditor", "team_lead", "department_head"]);
/** Roles for whom GET /projects/tasks/assigned already returns a broad task set (all tenant
 *  tasks for elevated roles, or all tasks in projects they manage/own for project_manager —
 *  including unassigned ones) rather than just tasks personally assigned to them. For these
 *  roles the first tab shows everything the backend sent, labeled "All Tasks" instead of
 *  "My Tasks" so it isn't mistaken for a self-assignment filter. */
const broadVisibilityRoles = new Set(["company_super_admin", "hr_admin", "auditor", "project_manager"]);

function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function timeLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function formatSeconds(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}H:${String(minutes).padStart(2, "0")}M:${String(secs).padStart(2, "0")}S`;
}
function isOverdue(task: AssignedTask) {
  return task.status !== "done" && Boolean(task.dueDate) && new Date(task.dueDate as string).getTime() < Date.now();
}

export function AssignedTasksPage() {
  const { session } = useSession();
  const canEditTaskPermission = usePermission("tasks", "edit");
  const canDeleteTaskPermission = usePermission("tasks", "manage");
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("my-tasks");

  const [openTask, setOpenTask] = useState<AssignedTask | null>(null);
  const [drawerContext, setDrawerContext] = useState<{ employees: CompanyUser[]; milestones: ProjectMilestone[]; workspaceTasks: WorkspaceTask[] } | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [activeTimer, setActiveTimer] = useState<ActiveTaskTimer | null>(null);
  const [stopTarget, setStopTarget] = useState<StopTimerTarget | null>(null);
  const [nextTaskAfterStop, setNextTaskAfterStop] = useState<AssignedTask | null>(null);
  const [timerBusy, setTimerBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const canSeeBreakdown = session?.user.kind === "company" && session.user.roles.some((role) => breakdownRoles.has(role));
  const hasBroadVisibility = session?.user.kind === "company" && session.user.roles.some((role) => broadVisibilityRoles.has(role));
  const currentUserId = session?.user.kind === "company" ? session.user.id : "";

  function load() {
    api.listAssignedTasks()
      .then(({ tasks: rows }) => {
        setTasks(rows);
        setError(null);
        // The active-timer endpoint is one-per-user tenant-wide (see server/BACKEND.md §3), so
        // any accessible project id works here — it's just needed as a route param.
        const anyProjectId = rows[0]?.project.id;
        if (anyProjectId) {
          api.getActiveTaskTimer(anyProjectId).then(({ entry }) => setActiveTimer(entry));
        } else {
          setActiveTimer(null);
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Assigned tasks could not be loaded"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    if (!activeTimer) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeTimer?.id]);

  async function startTimer(task: AssignedTask) {
    setTimerBusy(task.id);
    try {
      const { entry } = await api.startTaskTimer(task.project.id, task.id);
      setActiveTimer(entry);
      setNow(Date.now());
    } finally {
      setTimerBusy(null);
    }
  }

  async function toggleTimer(task: AssignedTask) {
    if (activeTimer) {
      const isSameTask = activeTimer.taskId === task.id;
      setNextTaskAfterStop(isSameTask ? null : task);
      setStopTarget({ entry: activeTimer, task: undefined, nextTask: isSameTask ? undefined : ({ id: task.id } as WorkspaceTask) });
      return;
    }
    await startTimer(task);
  }

  async function saveTimerLog(input: { activityType: string; billable: boolean; note: string }) {
    if (!stopTarget) return;
    setTimerBusy(stopTarget.entry.taskId);
    try {
      const result = await api.stopTaskTimer(stopTarget.entry.projectId, stopTarget.entry.taskId, input);
      setTasks((current) => current.map((item) => (item.id === stopTarget.entry.taskId ? { ...item, trackedSeconds: result.taskTrackedSeconds } : item)));
      const nextTask = nextTaskAfterStop;
      setActiveTimer(null);
      setStopTarget(null);
      setNextTaskAfterStop(null);
      if (nextTask) await startTimer(nextTask);
    } finally {
      setTimerBusy(null);
    }
  }

  async function discardTimer() {
    if (!stopTarget) return;
    setTimerBusy(stopTarget.entry.taskId);
    try {
      await api.discardTaskTimer(stopTarget.entry.projectId, stopTarget.entry.taskId);
      const nextTask = nextTaskAfterStop;
      setActiveTimer(null);
      setStopTarget(null);
      setNextTaskAfterStop(null);
      if (nextTask) await startTimer(nextTask);
    } finally {
      setTimerBusy(null);
    }
  }

  async function openTaskDrawer(task: AssignedTask) {
    setOpenTask(task);
    setDrawerLoading(true);
    try {
      const [workspace, eligible] = await Promise.all([
        api.getProjectWorkspace(task.project.id),
        api.listProjectEligibleUsers(task.project.id),
      ]);
      const workspaceTasks = workspace.sections.flatMap((section) => section.tasks);
      const fresh = workspaceTasks.find((item) => item.id === task.id);
      if (fresh) setOpenTask({ ...task, ...fresh });
      setDrawerContext({ employees: eligible.users, milestones: workspace.milestones, workspaceTasks });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open task");
      setOpenTask(null);
    } finally {
      setDrawerLoading(false);
    }
  }

  function syncOpenTask(next: WorkspaceTask) {
    setTasks((current) => current.map((item) => (item.id === next.id ? { ...item, ...next } : item)));
    setOpenTask((current) => (current && current.id === next.id ? { ...current, ...next } : current));
  }

  const myTasks = useMemo(
    () => (hasBroadVisibility ? tasks : tasks.filter((task) => task.assigneeId === currentUserId)),
    [tasks, currentUserId, hasBroadVisibility],
  );
  const overdueTasks = useMemo(() => tasks.filter(isOverdue), [tasks]);

  const tabs: TabItem[] = [
    { id: "my-tasks", label: hasBroadVisibility ? "All Tasks" : "My Tasks", count: myTasks.length },
    { id: "overdue-tasks", label: "Overdue Tasks", count: overdueTasks.length },
    ...(canSeeBreakdown ? [{ id: "task-breakdown", label: "Task Breakdown" }] : []),
  ];

  return (
    <div className="min-h-full bg-surface-subtle p-4 lg:p-6">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Tasks</h1>
          <p className="mt-1 text-sm text-ink-500">Work assigned to you, projects you manage, and members of teams you lead.</p>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-ink-200 px-2">
            <Tabs tabs={tabs} activeId={tab} onChange={setTab} />
          </div>

          {error && <div className="m-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
          {loading ? (
            <div className="p-12 text-center text-sm text-ink-500">Loading tasks…</div>
          ) : (
            <>
              {tab === "my-tasks" && (
                <TaskTable
                  tasks={myTasks}
                  emptyLabel={hasBroadVisibility ? "No tasks found." : "No tasks assigned to you yet."}
                  onOpenTask={openTaskDrawer}
                  activeTimer={activeTimer}
                  now={now}
                  timerBusy={timerBusy}
                  canEditTimer={canEditTaskPermission}
                  onToggleTimer={toggleTimer}
                />
              )}
              {tab === "overdue-tasks" && <OverdueTaskTable tasks={overdueTasks} onOpenTask={openTaskDrawer} />}
              {tab === "task-breakdown" && canSeeBreakdown && <TaskBreakdownTable />}
            </>
          )}
        </Card>
      </div>

      <TaskWorkspaceDrawer
        task={drawerLoading ? null : openTask}
        projectId={openTask?.project.id ?? ""}
        projectName={openTask?.project.name ?? ""}
        allTasks={drawerContext?.workspaceTasks ?? []}
        employees={drawerContext?.employees ?? []}
        milestones={drawerContext?.milestones ?? []}
        taskActivities={[]}
        currentUserId={currentUserId}
        canEdit={canEditTaskPermission}
        canDelete={canDeleteTaskPermission}
        onTaskChanged={syncOpenTask}
        onTaskDeleted={() => { setOpenTask(null); setDrawerContext(null); load(); }}
        onProjectTimeChanged={() => {}}
        onClose={() => { setOpenTask(null); setDrawerContext(null); load(); }}
      />
      <TimerStopDialog target={stopTarget} busy={timerBusy !== null} onCancel={() => setStopTarget(null)} onSave={saveTimerLog} onDiscard={discardTimer} />
    </div>
  );
}

function TaskTable({
  tasks,
  emptyLabel,
  onOpenTask,
  activeTimer,
  now,
  timerBusy,
  canEditTimer,
  onToggleTimer,
}: {
  tasks: AssignedTask[];
  emptyLabel: string;
  onOpenTask: (task: AssignedTask) => void;
  activeTimer: ActiveTaskTimer | null;
  now: number;
  timerBusy: string | null;
  canEditTimer: boolean;
  onToggleTimer: (task: AssignedTask) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ProjectTaskStatus>("all");
  const [priority, setPriority] = useState<"all" | ProjectPriority>("all");

  const filtered = useMemo(() => tasks.filter((task) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || task.name.toLowerCase().includes(query) || task.project.name.toLowerCase().includes(query) || task.project.key.toLowerCase().includes(query);
    return matchesSearch && (status === "all" || task.status === status) && (priority === "all" || task.priority === priority);
  }), [tasks, search, status, priority]);

  const openCount = tasks.filter((task) => task.status !== "done").length;
  const doneCount = tasks.filter((task) => task.status === "done").length;
  const overdueCount = tasks.filter(isOverdue).length;

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-ink-200 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          <SummaryChip icon={<FolderKanban size={15} />} label="Total" value={tasks.length} />
          <SummaryChip icon={<Clock3 size={15} />} label="Open" value={openCount} />
          <SummaryChip icon={<CheckCircle2 size={15} />} label="Done" value={doneCount} />
          <SummaryChip icon={<CalendarDays size={15} />} label="Overdue" value={overdueCount} danger={overdueCount > 0} />
        </div>
      </div>
      <div className="flex flex-col gap-3 border-b border-ink-200 p-4 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task, project, or project key" className="h-10 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        </div>
        <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="md:w-44">
          <option value="all">All statuses</option>
          <option value="new_request">New Request</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </Select>
        <Select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} className="md:w-40">
          <option value="all">All priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center"><CheckCircle2 size={36} className="text-brand-500" /><p className="mt-3 font-semibold text-ink-900">No matching tasks</p><p className="mt-1 text-sm text-ink-500">{emptyLabel}</p></div>
      ) : (
        <TaskGrid tasks={filtered} onOpenTask={onOpenTask} activeTimer={activeTimer} now={now} timerBusy={timerBusy} canEditTimer={canEditTimer} onToggleTimer={onToggleTimer} />
      )}
    </div>
  );
}

const gridHeaders = [
  "Task Name", "Project", "Assignee", "Due Date", "Section", "Task Type", "Task Status", "Tags",
  "Task Progress", "Estimation Hours", "Work Logs", "Task Followers", "Task Assigner", "Last Comment",
  "Created Date", "Start Date", "Completed Date",
];

function TaskGrid({
  tasks,
  onOpenTask,
  activeTimer,
  now,
  timerBusy,
  canEditTimer,
  onToggleTimer,
}: {
  tasks: AssignedTask[];
  onOpenTask: (task: AssignedTask) => void;
  activeTimer: ActiveTaskTimer | null;
  now: number;
  timerBusy: string | null;
  canEditTimer: boolean;
  onToggleTimer: (task: AssignedTask) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
          <tr>{gridHeaders.map((header) => <th key={header} className="whitespace-nowrap px-3 py-3 font-semibold">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {tasks.map((task) => {
            const lastComment = task.comments[task.comments.length - 1];
            return (
              <tr key={task.id} onClick={() => onOpenTask(task)} className="cursor-pointer bg-white transition-colors hover:bg-brand-50/40">
                <td className="px-3 py-3"><div className="font-medium text-ink-900">{task.name}</div><div className="mt-0.5 text-xs text-ink-400">#{task.code}</div></td>
                <td className="px-3 py-3"><div className="font-medium text-ink-800">{task.project.name}</div><div className="text-xs text-ink-400">{task.project.key}</div></td>
                <td className="px-3 py-3">{task.assignee ? <div className="flex items-center gap-2 whitespace-nowrap"><MemberAvatar id={task.assigneeId ?? task.assignee.id} name={task.assignee.name} size="sm" status="active" className="ring-0" /><span>{task.assignee.name}</span></div> : <span className="text-ink-400">Unassigned</span>}</td>
                <td className="whitespace-nowrap px-3 py-3"><span className={isOverdue(task) ? "font-medium text-danger-600" : "text-ink-600"}>{dateLabel(task.dueDate)}</span></td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-600">{task.section.name}</td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-600">{task.taskType ?? "—"}</td>
                <td className="px-3 py-3"><Badge tone={statusTones[task.status]}>{statusLabels[task.status]}</Badge></td>
                <td className="px-3 py-3">{task.tags.length ? <div className="flex flex-wrap gap-1">{task.tags.map((tag) => <Badge key={tag} tone="purple">{tag}</Badge>)}</div> : <span className="text-ink-400">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-600">{task.progress}%</td>
                <td className="whitespace-nowrap px-3 py-3"><div className="font-mono text-xs text-ink-700">{timeLabel(task.estimatedMinutes)}</div></td>
                <td className="whitespace-nowrap px-3 py-3" onClick={(event) => event.stopPropagation()}>
                  <WorkLogCell
                    task={task}
                    canEdit={canEditTimer}
                    isRunning={activeTimer?.taskId === task.id}
                    runningSeconds={activeTimer?.taskId === task.id ? Math.max(0, Math.floor((now - new Date(activeTimer.startedAt).getTime()) / 1000)) : 0}
                    busy={timerBusy === task.id}
                    onToggle={() => onToggleTimer(task)}
                  />
                </td>
                <td className="px-3 py-3">{task.followers.length ? <div className="flex -space-x-2">{task.followers.slice(0, 3).map((follower) => <MemberAvatar key={follower.userId} id={follower.userId} name={follower.user.name} size="xs" status="active" />)}{task.followers.length > 3 && <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink-200 text-[10px] font-semibold text-ink-700 ring-2 ring-white">+{task.followers.length - 3}</span>}</div> : <span className="text-ink-400">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-600">{task.assigner?.name ?? "—"}</td>
                <td className="max-w-48 truncate px-3 py-3 text-ink-500" title={lastComment?.body}>{lastComment ? lastComment.body : "—"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-600">{dateLabel(task.createdAt)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-600">{dateLabel(task.startDate)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-600">{dateLabel(task.completedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OverdueTaskTable({ tasks, onOpenTask }: { tasks: AssignedTask[]; onOpenTask: (task: AssignedTask) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const byProject = useMemo(() => {
    const groups = new Map<string, { project: AssignedTask["project"]; tasks: AssignedTask[] }>();
    for (const task of tasks) {
      const group = groups.get(task.project.id) ?? { project: task.project, tasks: [] };
      group.tasks.push(task);
      groups.set(task.project.id, group);
    }
    return Array.from(groups.values()).sort((a, b) => b.tasks.length - a.tasks.length);
  }, [tasks]);

  if (tasks.length === 0) {
    return <div className="flex flex-col items-center px-6 py-16 text-center"><CheckCircle2 size={36} className="text-success-500" /><p className="mt-3 font-semibold text-ink-900">Nothing overdue</p><p className="mt-1 text-sm text-ink-500">Tasks past their due date will show up here, grouped by project.</p></div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500"><tr><th className="px-4 py-3 font-semibold">Task</th><th className="px-4 py-3 font-semibold">Assignee</th><th className="px-4 py-3 font-semibold">Due date</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Priority</th></tr></thead>
        <tbody className="divide-y divide-ink-100">
          {byProject.map(({ project, tasks: projectTasks }) => (
            <Fragment key={project.id}>
              <tr className="bg-surface-subtle">
                <td colSpan={5} className="px-4 py-2.5">
                  <button onClick={() => setCollapsed((current) => ({ ...current, [project.id]: !current[project.id] }))} className="flex items-center gap-2 font-semibold text-ink-800">
                    {collapsed[project.id] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                    {project.name} <span className="text-xs font-normal text-ink-400">({projectTasks.length})</span>
                  </button>
                </td>
              </tr>
              {!collapsed[project.id] && projectTasks.map((task) => (
                <tr key={task.id} onClick={() => onOpenTask(task)} className="cursor-pointer bg-white transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 pl-8"><div className="font-medium text-ink-900">{task.name}</div><div className="mt-0.5 text-xs text-ink-400">#{task.code} · {task.section.name}</div></td>
                  <td className="px-4 py-3">{task.assignee ? <div className="flex items-center gap-2"><MemberAvatar id={task.assigneeId ?? task.assignee.id} name={task.assignee.name} size="sm" status="active" className="ring-0" /><span>{task.assignee.name}</span></div> : <span className="text-ink-400">Unassigned</span>}</td>
                  <td className="px-4 py-3"><span className="font-medium text-danger-600">{dateLabel(task.dueDate)}</span></td>
                  <td className="px-4 py-3"><Badge tone={statusTones[task.status]}>{statusLabels[task.status]}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={priorityTones[task.priority]} className="capitalize">{task.priority}</Badge></td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskBreakdownTable() {
  const [rows, setRows] = useState<TaskBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTaskBreakdown()
      .then(({ employees }) => { setRows(employees); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Task breakdown could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-12 text-center text-sm text-ink-500">Loading task breakdown…</div>;
  if (error) return <div className="m-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>;
  if (rows.length === 0) return <div className="flex flex-col items-center px-6 py-16 text-center"><CheckCircle2 size={36} className="text-brand-500" /><p className="mt-3 font-semibold text-ink-900">No employees in scope</p></div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Employee</th>
            <th className="px-4 py-3 font-semibold">Total Assigned</th>
            <th className="px-4 py-3 font-semibold">Pending</th>
            <th className="px-4 py-3 font-semibold">Overdue</th>
            <th className="px-4 py-3 font-semibold">Created</th>
            <th className="px-4 py-3 font-semibold">Completed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((row) => (
            <tr key={row.user.id} className="bg-white">
              <td className="px-4 py-3"><div className="flex items-center gap-2"><MemberAvatar id={row.user.id} name={row.user.name} size="sm" status="active" className="ring-0" /><span className="font-medium text-ink-900">{row.user.name}</span></div></td>
              <td className="px-4 py-3">{row.totalAssigned}</td>
              <td className="px-4 py-3">{row.pending}</td>
              <td className="px-4 py-3">{row.overdue > 0 ? <span className="font-medium text-danger-600">{row.overdue}</span> : row.overdue}</td>
              <td className="px-4 py-3">{row.created}</td>
              <td className="px-4 py-3">{row.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryChip({ icon, label, value, danger = false }: { icon: React.ReactNode; label: string; value: number; danger?: boolean }) {
  return <div className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 ${danger ? "border-danger-200 text-danger-700" : "border-ink-200 text-ink-700"}`}>{icon}<span className="text-xs text-ink-500">{label}</span><span className="font-semibold">{value}</span></div>;
}

function WorkLogCell({
  task,
  canEdit,
  isRunning,
  runningSeconds,
  busy,
  onToggle,
}: {
  task: AssignedTask;
  canEdit: boolean;
  isRunning: boolean;
  runningSeconds: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const displaySeconds = isRunning ? task.trackedSeconds + runningSeconds : task.trackedSeconds;
  if (!canEdit) return <span className="font-mono text-xs text-ink-600">{formatSeconds(displaySeconds)}</span>;
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onToggle}
        disabled={busy}
        title={isRunning ? "Stop timer" : "Start timer"}
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
          isRunning ? "bg-danger-500 text-white hover:bg-danger-600" : "bg-success-500 text-white hover:bg-success-600",
          busy && "opacity-50",
        )}
      >
        {isRunning ? <span className="h-2.5 w-2.5 rounded-sm bg-white" /> : <Play size={11} className="fill-white pl-0.5" />}
      </button>
      <span className={cn("font-mono text-xs", isRunning ? "font-semibold text-danger-600" : "text-ink-600")}>{formatSeconds(displaySeconds)}</span>
    </div>
  );
}
