import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlarmClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageCircle,
  GitBranch,
  Copy,
  FileText,
  Flag,
  Download,
  Folder,
  GanttChartSquare,
  GripVertical,
  HeartPulse,
  Kanban,
  LayoutDashboard,
  List,
  Maximize2,
  MoreHorizontal,
  Pencil,
  PiggyBank,
  Play,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Star,
  Tag,
  Trash2,
  Link2,
  UserPlus,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import {
  Avatar,
  AvatarGroup,
  MemberAvatar,
  memberColor,
  Badge,
  Button,
  Card,
  DatePicker,
  Drawer,
  DropdownMenu,
  EmployeePicker,
  Field,
  FilterSelect,
  Input,
  Modal,
  ProgressBar,
  Select,
  Textarea,
} from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { projectSlug } from "./projectRoutes";
import { usePermission, useSession } from "@/lib/session";
import type {
  CompanyUser,
  ProjectSection,
  ProjectWorkspace,
  ProjectMilestone,
  ProjectTaskStatus,
  ProjectPriority,
  ProjectTaskFilters,
  ProjectTaskFilterOptions,
  AuditLogEntry,
  TaskTimeEntry,
  TaskComment,
  WorkspaceTask,
} from "@/types/tenant";

type ViewId =
  | "dashboard"
  | "list"
  | "kanban"
  | "gantt"
  | "calendar"
  | "activities"
  | "milestones"
  | "document"
  | "automation"
  | "budget";

export type ActiveTaskTimer = TaskTimeEntry & {
  task?: { id: string; code: number; name: string; projectId: string };
  project?: { id: string; name: string };
};

export type StopTimerInput = { activityType: string; billable: boolean; note: string; durationSeconds?: number };
export type StopTimerTarget = {
  entry: ActiveTaskTimer;
  task?: WorkspaceTask;
  nextTask?: WorkspaceTask;
};
const views: { id: ViewId; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={15} /> },
  { id: "list", label: "List", icon: <List size={15} /> },
  { id: "kanban", label: "Kanban", icon: <Kanban size={15} /> },
  { id: "gantt", label: "Gantt Chart", icon: <GanttChartSquare size={15} /> },
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={15} /> },
  { id: "activities", label: "Activities", icon: <Activity size={15} /> },
  { id: "milestones", label: "Milestones", icon: <Flag size={15} /> },
  { id: "document", label: "Document", icon: <FileText size={15} /> },
  { id: "automation", label: "Automation", icon: <Zap size={15} /> },
  { id: "budget", label: "Budget", icon: <PiggyBank size={15} /> },
];

function initialsOf(name: string) {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m`;
}

function formatSeconds(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}H:${String(minutes).padStart(2, "0")}M:${String(secs).padStart(2, "0")}S`;
}
const linkPattern = /(https?:\/\/[^\s<>"']+)/g;


function renderLinkedDescription(text?: string | null) {
  if (!text) return <span className="text-ink-400">No description added.</span>;
  linkPattern.lastIndex = 0;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(linkPattern)) {
    const rawUrl = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
    const trailing = rawUrl.match(/[),.;!?]+$/)?.[0] ?? "";
    const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    nodes.push(
      <a key={`${url}-${start}`} href={url} target="_blank" rel="noreferrer" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700" onClick={(event) => event.stopPropagation()}>
        {url}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    lastIndex = start + rawUrl.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>);
}

function flattenTasks(tasks: WorkspaceTask[], collapsed: Record<string, boolean>) {
  const children = new Map<string | null, WorkspaceTask[]>();
  for (const task of tasks) {
    const key = task.parentTaskId ?? null;
    children.set(key, [...(children.get(key) ?? []), task]);
  }
  const rows: { task: WorkspaceTask; depth: number; displayCode: string; childCount: number }[] = [];
  const visit = (task: WorkspaceTask, depth: number, displayCode: string) => {
    const taskChildren = children.get(task.id) ?? [];
    rows.push({ task, depth, displayCode, childCount: taskChildren.length });
    if (!collapsed[task.id]) taskChildren.forEach((child, index) => visit(child, depth + 1, `${displayCode}.${index + 1}`));
  };
  const roots = children.get(null) ?? [];
  roots.forEach((task, index) => visit(task, 0, String(index + 1)));
  return rows;
}

export function ProjectDetailPage() {
  const params = useParams();
  const projectRouteParam = params.projectSlug ?? params.projectId ?? "";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const requestedView = searchParams.get("view");
  const [activeView, setActiveView] = useState<ViewId>(
    views.some((view) => view.id === requestedView) ? (requestedView as ViewId) : "list",
  );
  const [search, setSearch] = useState("");
  const [taskFilters, setTaskFilters] = useState<ProjectTaskFilters>({});
  const [serverTasks, setServerTasks] = useState<WorkspaceTask[] | null>(null);
  const [filterOptions, setFilterOptions] = useState<ProjectTaskFilterOptions>({ tags: [], taskTypes: [] });
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterRevision, setFilterRevision] = useState(0);
  const [collapseSubtasks, setCollapseSubtasks] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memberDrawer, setMemberDrawer] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WorkspaceTask | null>(null);
  const { session } = useSession();
  const canEditPermission = usePermission("projects", "edit");
  const canManageProjectPermission = usePermission("projects", "manage");
  const canCreateTaskPermission = usePermission("tasks", "create");
  const canEditTaskPermission = usePermission("tasks", "edit");
  const canExportTaskPermission = usePermission("tasks", "export");
  const canDeleteTaskPermission = usePermission("tasks", "manage");

  function load(silent = true) {
    if (!projectId) return;
    if (!silent) setLoading(true);
    Promise.all([api.getProjectWorkspace(projectId), api.listProjectEligibleUsers(projectId)])
      .then(([workspaceResult, usersResult]) => {
        setWorkspace(workspaceResult);
        setFilterRevision((value) => value + 1);
        const availableTasks = workspaceResult.sections.flatMap((section) => section.tasks);
        const requestedTaskId = searchParams.get("task");
        setSelectedTask((current) => requestedTaskId
          ? availableTasks.find((item) => item.id === requestedTaskId) ?? null
          : current ? availableTasks.find((item) => item.id === current.id) ?? current : current);
        setCompanyUsers(usersResult.users);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load project workspace"))
      .finally(() => { if (!silent) setLoading(false); });
  }

  function syncWorkspaceTask(nextTask: WorkspaceTask) {
    setWorkspace((current) => current ? {
      ...current,
      sections: current.sections.map((section) => {
        const remaining = section.tasks.filter((item) => item.id !== nextTask.id);
        return section.id === nextTask.sectionId
          ? { ...section, tasks: [...remaining, nextTask].sort((a, b) => a.position - b.position) }
          : { ...section, tasks: remaining };
      }),
    } : current);
    // visibleSections prefers serverTasks over workspace.sections whenever a filtered fetch has
    // run (which is effectively always, once the list/kanban view has mounted) — so updating
    // workspace alone is invisible until the next debounced refetch lands. Merging the new/changed
    // task into serverTasks too means a just-created subtask (or any edit) shows immediately
    // instead of only after that refetch completes or a manual page reload.
    setServerTasks((current) => current === null ? current : [...current.filter((item) => item.id !== nextTask.id), nextTask]);
    setSelectedTask((current) => current?.id === nextTask.id ? nextTask : current);
    setFilterRevision((value) => value + 1);
  }

  function removeWorkspaceTask(taskId: string) {
    setWorkspace((current) => current ? {
      ...current,
      sections: current.sections.map((section) => ({ ...section, tasks: section.tasks.filter((item) => item.id !== taskId) })),
    } : current);
    setServerTasks((current) => current === null ? current : current.filter((item) => item.id !== taskId));
    setSelectedTask((current) => current?.id === taskId ? null : current);
    setFilterRevision((value) => value + 1);
  }

  function syncProjectTrackedSeconds(trackedSeconds: number) {
    setWorkspace((current) => current ? { ...current, project: { ...current.project, trackedSeconds } } : current);
  }
  useEffect(() => {
    let cancelled = false;
    setWorkspace(null);
    setServerTasks(null);
    setProjectId("");
    setLoading(true);

    async function resolveProjectRoute() {
      const routeValue = projectRouteParam.trim();
      if (!routeValue) {
        setError("Project route is missing");
        setLoading(false);
        return;
      }

      const storedProjectId = window.sessionStorage.getItem(`project-route:${routeValue}`);
      if (storedProjectId) {
        if (!cancelled) setProjectId(storedProjectId);
        return;
      }

      try {
        const result = await api.listProjects();
        const matchedProject = result.projects.find((item) => projectSlug(item.name) === routeValue);
        if (matchedProject) {
          window.sessionStorage.setItem(`project-route:${routeValue}`, matchedProject.id);
          if (!cancelled) setProjectId(matchedProject.id);
          return;
        }
      } catch {
        // Keep legacy /projects/:projectId links usable even if the list lookup fails.
      }

      if (!cancelled) setProjectId(routeValue);
    }

    void resolveProjectRoute();
    return () => { cancelled = true; };
  }, [projectRouteParam]);

  useEffect(() => { if (projectId) load(false); }, [projectId]);
  useEffect(() => {
    if (!workspace || (activeView !== "list" && activeView !== "kanban")) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setFilterLoading(true);
      api.filterProjectTasks(projectId, { ...taskFilters, search: search.trim() || undefined })
        .then((result) => {
          if (cancelled) return;
          setServerTasks(result.tasks);
          setFilterOptions(result.options);
          setError(null);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to filter project tasks");
        })
        .finally(() => { if (!cancelled) setFilterLoading(false); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [projectId, workspace?.project.id, activeView, search, taskFilters, filterRevision]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-500">Loading project workspace…</div>;
  }

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center">
          <p className="font-semibold text-ink-900">Project could not be opened</p>
          <p className="mt-1 text-sm text-ink-500">{error ?? "The project does not exist or you do not have access."}</p>
          <Button className="mt-4" onClick={() => navigate("/projects")}>Back to projects</Button>
        </Card>
      </div>
    );
  }

  const { project, sections, members, milestones } = workspace;
  const canEdit = canEditPermission && (project.currentUserAccess === "edit" || project.currentUserAccess === "manage");
  const canManageProject = canManageProjectPermission && project.currentUserAccess === "manage";
  const canCreateTask = canCreateTaskPermission && canEdit;
  const currentUserId = session?.user.kind === "company" ? session.user.id : "";
  const projectHasEditAccess = project.currentUserAccess === "edit" || project.currentUserAccess === "manage";
  /** Only the project's own owner/manager (or a super admin) can restructure its board —
   *  intentionally narrower than general "edit access": ProjectMembers, department heads,
   *  etc. can edit tasks but should not add/remove sections. Mirrors the backend's
   *  POST /:id/sections check in server/src/routes/projects.ts. */
  const isSuperAdmin = session?.user.kind === "company" && session.user.roles.includes("company_super_admin");
  const canManageSections = Boolean(isSuperAdmin) || (Boolean(currentUserId) && (project.ownerId === currentUserId || project.managerId === currentUserId));
  /** Mirrors the backend's canEditTaskForProject: project-level edit/manage access, OR the
   *  task is assigned to the current user (self-assignment carve-out) — see server/BACKEND.md §3.
   *  Without this, every task in a project you can merely view would render edit controls
   *  that the backend would then 403 on submit. */
  function canEditTask(task: WorkspaceTask): boolean {
    return canEditTaskPermission && (projectHasEditAccess || task.assigneeId === currentUserId);
  }
  /** The self-assignee carve-out in canEditTask lets someone with no real project access edit
   *  their own task's status/progress/etc, but reassigning it to somebody else (or unassigning
   *  themselves) is a project-management action, not self-editing — mirrors the backend's
   *  PATCH /:id/tasks/:taskId check in server/src/routes/projects.ts, which independently
   *  requires real project edit access for any assigneeId change. Without this, an employee
   *  could open their own assigned task and hand it off to anyone else in the company. */
  function canReassignTask(_task: WorkspaceTask): boolean {
    return canEditTaskPermission && projectHasEditAccess;
  }
  const tasks = sections.flatMap((section) => section.tasks);
  const visibleSections = sections.map((section) => ({
    ...section,
    tasks: serverTasks == null ? section.tasks : serverTasks.filter((task) => task.sectionId === section.id),
  }));
  const visibleTasks = visibleSections.flatMap((section) => section.tasks);
  function exportVisibleTasks() {
    const rows = [
      ["Task ID", "Task Name", "Section", "Assignee", "Status", "Priority", "Due Date", "Tags", "Estimated Minutes", "Tracked Seconds"],
      ...visibleSections.flatMap((section) => section.tasks.map((task) => [task.code, task.name, section.name, task.assignee?.name ?? "", task.status, task.priority, task.dueDate ?? "", task.tags.join("; "), task.estimatedMinutes, task.trackedSeconds])),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.key}-tasks.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-white">
      <div className="shrink-0 border-b border-ink-200 bg-white">
        <div className="flex min-h-14 items-center gap-3 px-4 lg:px-5">
          <Avatar initials={initialsOf(project.name)} color="bg-brand-600" size="md" className="ring-0" />
          <button className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-semibold text-ink-900">{project.name}</span>
            <ChevronDown size={15} className="text-ink-400" />
          </button>
          {canEdit && <button className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100"><Settings size={16} /></button>}
          <button className="rounded-lg p-1.5 text-warning-500 hover:bg-ink-100">
            <Star size={16} className={project.favourite ? "fill-warning-500" : ""} />
          </button>
          <div className="relative mx-auto hidden w-full max-w-md xl:block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search for Tasks, Menu, Client Name & Project Name..."
              className="h-9 w-full rounded-lg border border-ink-200 pl-9 pr-3 text-xs outline-none focus:border-brand-500"
            />
          </div>
          <Badge tone="purple">{project.key}</Badge>
          <Badge tone="blue" className="capitalize">{project.methodology}</Badge>
          <span className="rounded-md border border-ink-200 bg-surface-subtle px-2 py-1 font-mono text-[11px]" title="Project tracked time">{formatSeconds(project.trackedSeconds)}</span>
        </div>

        <div className="flex min-w-0 items-end border-t border-ink-100 px-2">
          <div className="flex min-w-0 flex-1 overflow-x-auto scrollbar-none">
            {views.filter((view) => (view.id !== "budget" || canManageProject) && (view.id !== "automation" || canEdit)).map((view) => (
              <button
                key={view.id}
                onClick={() => setActiveView(view.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-medium transition-colors",
                  activeView === view.id
                    ? "border-brand-600 text-brand-600"
                    : "border-transparent text-ink-600 hover:text-ink-900",
                )}
              >
                {view.icon}
                {view.label}
                {(view.id === "list" || view.id === "kanban") && tasks.length > 0 && (
                  <span className="rounded-full bg-danger-500 px-1.5 py-0.5 text-[10px] text-white">{tasks.length}</span>
                )}
              </button>
            ))}
            <DropdownMenu
              trigger={<button className="flex shrink-0 items-center gap-1 border-b-2 border-transparent px-3 py-3 text-xs font-medium text-ink-600"><MoreHorizontal size={15} /> More</button>}
              items={[
                "Files", "Mind Map", "Timesheet",
                ...(canEdit ? ["Workflow", "Import Tasks", "Form", "MoM"] : []),
                ...(canManageProject ? ["Report", "Billing Report"] : []),
              ].map((label) => ({ id: label, label }))}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 pb-1.5 pl-3">
            <AvatarGroup
              users={members.map((member) => ({
                id: member.user.id,
                tenantId: project.tenantId,
                name: member.user.name,
                email: member.user.email,
                role: member.access,
                initials: initialsOf(member.user.name),
                color: memberColor(member.user.id),
              }))}
              max={4}
              size="sm"
            />
            {canManageProject && (
              <Button size="sm" leftIcon={<UserPlus size={14} />} onClick={() => setMemberDrawer(true)}>
                Add Member
              </Button>
            )}
          </div>
        </div>
      </div>

      {(activeView === "list" || activeView === "kanban") && (
        <WorkspaceToolbar
          search={search}
          onSearch={setSearch}
          filters={taskFilters}
          onFiltersChange={setTaskFilters}
          filterOptions={filterOptions}
          employees={companyUsers}
          milestones={milestones}
          filterLoading={filterLoading}
          collapseSubtasks={collapseSubtasks}
          onCollapseSubtasks={() => setCollapseSubtasks((value) => !value)}
          onExport={exportVisibleTasks}
          canExport={canExportTaskPermission}
          resultCount={visibleTasks.length}
          canCreateTask={canCreateTask}
          onAddTask={() => {
            const first = sections[0];
            if (first) document.getElementById(`add-task-${first.id}`)?.focus();
          }}
        />
      )}

      <main className="min-h-0 flex-1 overflow-auto bg-surface-subtle">
        {error && <div className="m-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
        {activeView === "list" && (
          <TaskListWorkspace
            projectId={project.id}
            sections={visibleSections}
            canCreate={canCreateTask}
            canEditTask={canEditTask}
            canReassignTask={canReassignTask}
            employees={companyUsers}
            milestones={milestones}
            onTaskUpdated={syncWorkspaceTask}
            onProjectTimeChanged={syncProjectTrackedSeconds}
            onSelectTask={setSelectedTask}
            collapseSubtasks={collapseSubtasks}
          />
        )}
        {activeView === "kanban" && (
          <KanbanWorkspace
            projectId={project.id}
            sections={visibleSections}
            canCreate={canCreateTask}
            canEditTask={canEditTask}
            canReassignTask={canReassignTask}
            canManageSections={canManageSections}
            employees={companyUsers}
            onChanged={load}
            onTaskUpdated={syncWorkspaceTask}
            onProjectTimeChanged={syncProjectTrackedSeconds}
            onSelectTask={setSelectedTask}
            collapseSubtasks={collapseSubtasks}
          />
        )}
        {activeView === "dashboard" && <ProjectDashboard workspace={workspace} />}
        {activeView === "milestones" && (
          <MilestoneWorkspace
            projectId={project.id}
            milestones={milestones}
            companyUsers={companyUsers}
            canEdit={canEdit}
            onChanged={load}
          />
        )}
        {activeView === "gantt" && <GanttWorkspace sections={sections} />}
        {activeView === "calendar" && <CalendarWorkspace sections={sections} onSelectTask={setSelectedTask} />}
        {activeView === "activities" && <ActivityWorkspace workspace={workspace} users={companyUsers} />}
        {activeView === "document" && <DocumentWorkspace canEdit={canEdit} />}
        {activeView === "automation" && <AutomationWorkspace canEdit={canEdit} />}
        {activeView === "budget" && <BudgetWorkspace workspace={workspace} />}
      </main>

      <MemberDrawer
        open={memberDrawer}
        projectId={project.id}
        users={companyUsers}
        existingUserIds={members.map((member) => member.userId)}
        onClose={() => setMemberDrawer(false)}
        onChanged={load}
      />
      <TaskWorkspaceDrawer
        task={selectedTask}
        projectId={project.id}
        projectName={project.name}
        allTasks={tasks}
        employees={companyUsers}
        milestones={milestones}
        taskActivities={workspace.activities.filter((activity) => activity.targetId === selectedTask?.id)}
        currentUserId={currentUserId}
        canEdit={selectedTask ? canEditTask(selectedTask) : false}
        canReassign={selectedTask ? canReassignTask(selectedTask) : false}
        canDelete={canDeleteTaskPermission}
        onTaskChanged={syncWorkspaceTask}
        onTaskDeleted={removeWorkspaceTask}
        onProjectTimeChanged={syncProjectTrackedSeconds}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

function WorkspaceToolbar({
  search,
  onSearch,
  filters,
  onFiltersChange,
  filterOptions,
  employees,
  milestones,
  filterLoading,
  collapseSubtasks,
  onCollapseSubtasks,
  onExport,
  canExport,
  resultCount,
  canCreateTask,
  onAddTask,
}: {
  search: string;
  onSearch: (value: string) => void;
  filters: ProjectTaskFilters;
  onFiltersChange: (value: ProjectTaskFilters) => void;
  filterOptions: ProjectTaskFilterOptions;
  employees: CompanyUser[];
  milestones: ProjectMilestone[];
  filterLoading: boolean;
  collapseSubtasks: boolean;
  onCollapseSubtasks: () => void;
  onExport: () => void;
  canExport: boolean;
  resultCount: number;
  canCreateTask: boolean;
  onAddTask: () => void;
}) {
  const activeCount = Object.values(filters).filter((value) => value !== undefined && value !== "" && value !== false).length;
  const update = <K extends keyof ProjectTaskFilters>(key: K, value: ProjectTaskFilters[K] | undefined) => {
    onFiltersChange({ ...filters, [key]: value || undefined });
  };
  const dueOptions = [
    { value: "", label: "Any Due Date" },
    { value: "overdue", label: "Overdue" },
    { value: "today", label: "Due Today" },
    { value: "this_week", label: "Next 7 Days" },
    { value: "no_date", label: "No Due Date" },
  ];
  return (
    <div className="relative z-20 shrink-0 border-b border-ink-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          {canCreateTask && (
            <div className="flex">
              <Button size="sm" className="rounded-r-none" leftIcon={<Plus size={15} />} onClick={onAddTask}>Add Task</Button>
              <Button size="sm" className="rounded-l-none border-l border-brand-500 px-2"><ChevronDown size={14} /></Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-ink-400 lg:inline">{filterLoading ? "Filtering..." : `${resultCount} tasks`}</span>
          <div className="relative hidden sm:block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search tasks" className="h-8 w-44 rounded-md border border-ink-200 pl-8 pr-8 text-xs outline-none focus:border-brand-500" />
            {search && <button onClick={() => onSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"><X size={13} /></button>}
          </div>
          {canExport && <Button variant="outline" size="icon" onClick={onExport} title="Export filtered tasks"><Download size={15} /></Button>}
        </div>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto border-t border-ink-100 px-4 py-2 scrollbar-none">
        <button className="shrink-0 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-700">Group By: Section (default)</button>
        <button onClick={onCollapseSubtasks} className={cn("shrink-0 rounded-md border px-3 py-1.5 text-xs", collapseSubtasks ? "border-brand-200 bg-brand-50 text-brand-700" : "border-ink-200 bg-white text-ink-600")}>Subtasks: {collapseSubtasks ? "Collapse all" : "Expanded"}</button>
        <button onClick={() => update("incomplete", filters.incomplete ? undefined : true)} className={cn("shrink-0 rounded-md border px-3 py-1.5 text-xs", filters.incomplete ? "border-brand-300 bg-brand-50 text-brand-700" : "border-ink-200 bg-white text-ink-600")}>Incomplete Tasks</button>
        <FilterSelect value={filters.status ?? ""} onChange={(value) => update("status", value as ProjectTaskFilters["status"])} options={[{ value: "", label: "All Statuses" }, ...TASK_STATUS_OPTIONS]} className="w-36 shrink-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:text-xs" />
        <FilterSelect value={filters.priority ?? ""} onChange={(value) => update("priority", value as ProjectTaskFilters["priority"])} options={[{ value: "", label: "All Priorities" }, ...["critical", "high", "medium", "low"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} className="w-36 shrink-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:text-xs" />
        <FilterSelect value={filters.due ?? ""} onChange={(value) => update("due", value as ProjectTaskFilters["due"])} options={dueOptions} className="w-36 shrink-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:text-xs" />
        <FilterSelect value={filters.taskType ?? ""} onChange={(value) => update("taskType", value)} options={[{ value: "", label: "All Task Types" }, ...filterOptions.taskTypes.map((value) => ({ value, label: value.replaceAll("_", " ") }))]} className="w-40 shrink-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:text-xs" />
        <FilterSelect value={filters.milestoneId ?? ""} onChange={(value) => update("milestoneId", value)} options={[{ value: "", label: "All Milestones" }, { value: "none", label: "No milestone" }, ...milestones.map((milestone) => ({ value: milestone.id, label: milestone.name }))]} className="w-40 shrink-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:text-xs" />
        <FilterSelect value={filters.tag ?? ""} onChange={(value) => update("tag", value)} options={[{ value: "", label: "All Tags" }, ...filterOptions.tags.map((tag) => ({ value: tag, label: tag }))]} className="w-32 shrink-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:text-xs" />
        <EmployeePicker
          employees={employees}
          value={filters.assigneeId ?? ""}
          onChange={(value) => update("assigneeId", value ?? "")}
          extraOptions={[{ value: "", label: "All Users" }, { value: "unassigned", label: "Unassigned" }]}
          className="w-40 shrink-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:text-xs"
        />
        {activeCount > 0 && <button onClick={() => onFiltersChange({})} className="shrink-0 px-2 py-1.5 text-xs font-medium text-danger-600 hover:underline">Clear filters ({activeCount})</button>}
      </div>
    </div>
  );
}
const TASK_TYPE_OPTIONS = ["new_request", "in_progress", "bug", "feature", "improvement", "review"];
const TASK_STATUS_OPTIONS: { value: ProjectTaskStatus; label: string }[] = [
  { value: "new_request", label: "New Request" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

function TaskListWorkspace({
  projectId,
  sections,
  canCreate,
  canEditTask,
  canReassignTask,
  employees,
  milestones,
  onTaskUpdated,
  onProjectTimeChanged,
  onSelectTask,
  collapseSubtasks,
}: {
  projectId: string;
  sections: ProjectSection[];
  canCreate: boolean;
  canEditTask: (task: WorkspaceTask) => boolean;
  canReassignTask: (task: WorkspaceTask) => boolean;
  employees: CompanyUser[];
  milestones: ProjectMilestone[];
  onTaskUpdated: (task: WorkspaceTask) => void;
  onProjectTimeChanged: (trackedSeconds: number) => void;
  onSelectTask: (task: WorkspaceTask) => void;
  collapseSubtasks: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedTasks, setCollapsedTasks] = useState<Record<string, boolean>>({});
  const [subtaskParent, setSubtaskParent] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftPriorities, setDraftPriorities] = useState<Record<string, ProjectPriority>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [activeTimer, setActiveTimer] = useState<ActiveTaskTimer | null>(null);
  const [stopTarget, setStopTarget] = useState<StopTimerTarget | null>(null);
  const [timerBusy, setTimerBusy] = useState<string | null>(null);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());  useEffect(() => {
    const next: Record<string, boolean> = {};
    sections.flatMap((section) => section.tasks).forEach((task) => {
      if (sections.some((section) => section.tasks.some((candidate) => candidate.parentTaskId === task.id))) next[task.id] = collapseSubtasks;
    });
    setCollapsedTasks(next);
  }, [collapseSubtasks]);

  function loadActiveTimer() {
    api.getActiveTaskTimer(projectId).then(({ entry }) => setActiveTimer(entry));
  }
  useEffect(loadActiveTimer, [projectId]);
  useEffect(() => {
    if (!activeTimer) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeTimer?.id]);

  async function startTimer(task: WorkspaceTask) {
    setTimerBusy(task.id);
    setTimerError(null);
    try {
      const { entry } = await api.startTaskTimer(projectId, task.id);
      setActiveTimer(entry);
      setNow(Date.now());
    } catch (err) {
      setTimerError(err instanceof ApiError ? err.message : "Timer could not be started");
    } finally {
      setTimerBusy(null);
    }
  }

  async function toggleTimer(task: WorkspaceTask) {
    if (activeTimer) {
      const runningTask = sections.flatMap((section) => section.tasks).find((candidate) => candidate.id === activeTimer.taskId);
      setStopTarget({ entry: activeTimer, task: runningTask, nextTask: activeTimer.taskId === task.id ? undefined : task });
      return;
    }
    await startTimer(task);
  }

  async function saveTimerLog(input: StopTimerInput) {
    if (!stopTarget) return;
    setTimerBusy(stopTarget.entry.taskId);
    try {
      const result = await api.stopTaskTimer(stopTarget.entry.projectId, stopTarget.entry.taskId, input);
      if (stopTarget.task) onTaskUpdated({ ...stopTarget.task, trackedSeconds: result.taskTrackedSeconds });
      if (stopTarget.entry.projectId === projectId) onProjectTimeChanged(result.projectTrackedSeconds);
      const nextTask = stopTarget.nextTask;
      setActiveTimer(null);
      setStopTarget(null);
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
      const nextTask = stopTarget.nextTask;
      setActiveTimer(null);
      setStopTarget(null);
      if (nextTask) await startTimer(nextTask);
    } finally {
      setTimerBusy(null);
    }
  }
  async function addTask(section: ProjectSection, parentTaskId?: string) {
    const draftKey = parentTaskId ? `sub-${parentTaskId}` : section.id;
    const name = drafts[draftKey]?.trim();
    if (!name) return;
    setSaving(draftKey);
    try {
      const { task } = await api.createProjectTask(projectId, { name, sectionId: section.id, parentTaskId: parentTaskId ?? null, priority: draftPriorities[draftKey] ?? "medium" });
      setDrafts((current) => ({ ...current, [draftKey]: "" }));
      setDraftPriorities((current) => ({ ...current, [draftKey]: "medium" }));
      setSubtaskParent(null);
      // Merge the created task straight into local state (same path as onTaskUpdated for edits)
      // instead of a full onChanged() reload — that reload raced against the debounced
      // serverTasks refetch (see the effect keyed on filterRevision in ProjectDetailPage),
      // and whichever response landed last could win, which is why a new subtask sometimes
      // needed a second manual refresh — or worse, landed without its parentTaskId link — to
      // actually show up correctly nested under its parent.
      onTaskUpdated(task);
    } finally {
      setSaving(null);
    }
  }

  async function patchTask(taskId: string, field: string, input: Parameters<typeof api.updateProjectTask>[2]) {
    setSavingField(`${taskId}-${field}`);
    try {
      const { task } = await api.updateProjectTask(projectId, taskId, input);
      onTaskUpdated(task);
    } finally {
      setSavingField(null);
    }
  }

  const headers = ["Task Name", "Assignee", "Due Date", "Task Type", "Milestone", "Task Status", "Tags", "Estimation Hours", "Work Logs"];

  return (
    <>
    <div className="h-full overflow-auto bg-white">
      {timerError && (
        <div className="m-3 flex items-center justify-between rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {timerError}
          <button onClick={() => setTimerError(null)} className="text-danger-500 hover:text-danger-700">×</button>
        </div>
      )}
      <table className="w-full min-w-[1450px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-ink-200">
            {headers.map((header, index) => (
              <th key={header} className={cn("border-r border-ink-200 px-3 py-3 text-left text-xs font-semibold text-ink-700", index === 0 && "min-w-[480px]")}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.id}>
              <tr className="border-b border-ink-200 bg-surface-muted">
                <td colSpan={headers.length} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <GripVertical size={15} className="text-ink-400" />
                    <button onClick={() => setCollapsed((value) => ({ ...value, [section.id]: !value[section.id] }))}>
                      {collapsed[section.id] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                    </button>
                    <span className="font-semibold text-ink-900">{section.name}</span>
                    <span className="text-xs text-ink-400">({section.tasks.length})</span>
                    <button className="rounded border border-ink-200 bg-white p-0.5 text-ink-500"><Plus size={13} /></button>
                    <MoreHorizontal size={16} className="text-ink-500" />
                    <div className="ml-auto flex items-center gap-2 text-xs font-medium text-ink-700">
                      Section Owner:
                      {section.owner ? <MemberAvatar id={section.owner.id} name={section.owner.name} size="xs" status={section.owner.accountStatus === "active" ? "active" : "inactive"} /> : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white"><UserPlus size={12} /></span>}
                    </div>
                  </div>
                </td>
              </tr>
              {!collapsed[section.id] && flattenTasks(section.tasks, collapsedTasks).map(({ task, depth, displayCode, childCount }) => (
                <Fragment key={task.id}>
                <tr onClick={() => onSelectTask(task)} className="cursor-pointer border-b border-ink-100 hover:bg-brand-50/30">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 28}px` }}>
                      <span className="w-12 text-right text-xs text-ink-500">{displayCode}</span>
                      {childCount > 0 ? <button onClick={(event) => { event.stopPropagation(); setCollapsedTasks((value) => ({ ...value, [task.id]: !value[task.id] })); }} className="rounded bg-ink-100 p-0.5">{collapsedTasks[task.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button> : <span className="w-4" />}
                      <CheckCircle2 size={16} className={task.status === "done" ? "text-success-500" : "text-ink-400"} />
                      <span className="font-medium text-ink-900">{task.name}</span>
                      {childCount > 0 && <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">{childCount} subtask{childCount === 1 ? "" : "s"}</span>}
                      {canCreate && <button title="Add subtask" onClick={(event) => { event.stopPropagation(); setSubtaskParent(task.id); setCollapsedTasks((value) => ({ ...value, [task.id]: false })); }} className="rounded p-1 text-ink-400 hover:bg-brand-50 hover:text-brand-600"><Plus size={13} /></button>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <AssigneeCell
                      task={task}
                      employees={employees}
                      canEdit={canReassignTask(task)}
                      saving={savingField === `${task.id}-assignee`}
                      onChange={(assigneeId) => patchTask(task.id, "assignee", { assigneeId })}
                    />
                  </td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <DueDateCell
                      task={task}
                      canEdit={canEditTask(task)}
                      saving={savingField === `${task.id}-dueDate`}
                      onChange={(dueDate) => patchTask(task.id, "dueDate", { dueDate })}
                    />
                  </td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <TaskTypeCell
                      task={task}
                      canEdit={canEditTask(task)}
                      saving={savingField === `${task.id}-taskType`}
                      onChange={(taskType) => patchTask(task.id, "taskType", { taskType })}
                    />
                  </td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <MilestoneCell
                      task={task}
                      milestones={milestones}
                      canEdit={canEditTask(task)}
                      saving={savingField === `${task.id}-milestoneId`}
                      onChange={(milestoneId) => patchTask(task.id, "milestoneId", { milestoneId })}
                    />
                  </td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <TaskStatusCell
                      task={task}
                      canEdit={canEditTask(task)}
                      saving={savingField === `${task.id}-status`}
                      onChange={(status) => patchTask(task.id, "status", { status })}
                    />
                  </td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <TagsCell
                      task={task}
                      canEdit={canEditTask(task)}
                      saving={savingField === `${task.id}-tags`}
                      onChange={(tags) => patchTask(task.id, "tags", { tags })}
                    />
                  </td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <EstimationCell
                      task={task}
                      canEdit={canEditTask(task)}
                      saving={savingField === `${task.id}-estimatedMinutes`}
                      onChange={(estimatedMinutes) => patchTask(task.id, "estimatedMinutes", { estimatedMinutes })}
                    />
                  </td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <WorkLogCell
                      task={task}
                      canEdit={canEditTask(task)}
                      isRunning={activeTimer?.taskId === task.id}
                      runningSeconds={activeTimer?.taskId === task.id ? Math.max(0, Math.floor((now - new Date(activeTimer.startedAt).getTime()) / 1000)) : 0}
                      busy={timerBusy === task.id}
                      onToggle={() => toggleTimer(task)}
                    />
                  </td>
                </tr>
                {subtaskParent === task.id && (
                  <tr className="border-b border-ink-100 bg-brand-50/20">
                    <td colSpan={headers.length} className="py-2 pr-4" style={{ paddingLeft: `${92 + (depth + 1) * 28}px` }}>
                      <div className="flex max-w-xl items-center gap-2">
                        <span className="text-xs text-ink-400">↳</span>
                        <input autoFocus value={drafts[`sub-${task.id}`] ?? ""} onChange={(event) => setDrafts((value) => ({ ...value, [`sub-${task.id}`]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") addTask(section, task.id); if (event.key === "Escape") setSubtaskParent(null); }} placeholder={`Add subtask under ${task.name}`} className="h-8 flex-1 rounded-md border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500" />
                        <select value={draftPriorities[`sub-${task.id}`] ?? "medium"} onChange={(event) => setDraftPriorities((value) => ({ ...value, [`sub-${task.id}`]: event.target.value as ProjectPriority }))} className="h-8 rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-700 outline-none focus:border-brand-500">
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                        <Button size="sm" onClick={() => addTask(section, task.id)} disabled={saving === `sub-${task.id}`}>Add Subtask</Button>
                        <button onClick={() => setSubtaskParent(null)} className="p-1 text-ink-400"><X size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {!collapsed[section.id] && canCreate && (
                <tr className="border-b border-ink-100">
                  <td colSpan={headers.length} className="px-4 py-2">
                    <div className="flex max-w-lg items-center gap-2">
                      <Plus size={14} className="text-ink-500" />
                      <input
                        id={`add-task-${section.id}`}
                        value={drafts[section.id] ?? ""}
                        onChange={(event) => setDrafts((value) => ({ ...value, [section.id]: event.target.value }))}
                        onKeyDown={(event) => event.key === "Enter" && addTask(section)}
                        placeholder="Add Task"
                        className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-500"
                      />
                      {drafts[section.id] && (
                        <select value={draftPriorities[section.id] ?? "medium"} onChange={(event) => setDraftPriorities((value) => ({ ...value, [section.id]: event.target.value as ProjectPriority }))} className="h-8 rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-700 outline-none focus:border-brand-500">
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      )}
                      {drafts[section.id] && <Button size="sm" onClick={() => addTask(section)} disabled={saving === section.id}>Add</Button>}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
    <TimerStopDialog target={stopTarget} busy={timerBusy !== null} onCancel={() => setStopTarget(null)} onSave={saveTimerLog} onDiscard={discardTimer} />
    </>
  );
}

function InlineCellShell({
  canEdit,
  saving,
  display,
  editor,
}: {
  canEdit: boolean;
  saving: boolean;
  display: React.ReactNode;
  editor: React.ReactNode;
}) {
  if (!canEdit) return <div className="text-xs">{display}</div>;
  return (
    <div className={cn("min-w-[110px] text-xs", saving && "opacity-50")}>
      {editor}
    </div>
  );
}

function AssigneeCell({
  task,
  employees,
  canEdit,
  saving,
  onChange,
}: {
  task: WorkspaceTask;
  employees: CompanyUser[];
  canEdit: boolean;
  saving: boolean;
  onChange: (assigneeId: string | null) => void;
}) {
  const display = task.assignee ? (
    <span className="flex items-center gap-2 text-xs">
      <MemberAvatar id={task.assignee.id} name={task.assignee.name} size="xs" status={task.assignee.accountStatus === "active" ? "active" : "inactive"} />
      {task.assignee.name}
    </span>
  ) : (
    <span className="text-ink-400">Unassigned</span>
  );
  return (
    <InlineCellShell
      canEdit={canEdit}
      saving={saving}
      display={display}
      editor={
        <EmployeePicker
          employees={employees}
          value={task.assigneeId}
          onChange={onChange}
          allowClear
          placeholder="Unassigned"
        />
      }
    />
  );
}

function DueDateCell({
  task,
  canEdit,
  saving,
  onChange,
}: {
  task: WorkspaceTask;
  canEdit: boolean;
  saving: boolean;
  onChange: (dueDate: string | null) => void;
}) {
  const display = (
    <span className={cn("inline-flex items-center gap-1 font-medium", task.dueDate && new Date(task.dueDate) < new Date() ? "text-danger-600" : "text-ink-600")}>
      {formatDate(task.dueDate)}
    </span>
  );
  if (!canEdit) return <div className="text-xs">{display}</div>;
  return (
    <DatePicker
      value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
      onChange={(value) => onChange(value ? new Date(value).toISOString() : null)}
      disabled={saving}
      className={cn("w-40", saving && "opacity-50")}
    />
  );
}

function TaskTypeCell({
  task,
  canEdit,
  saving,
  onChange,
}: {
  task: WorkspaceTask;
  canEdit: boolean;
  saving: boolean;
  onChange: (taskType: string | null) => void;
}) {
  return (
    <InlineCellShell
      canEdit={canEdit}
      saving={saving}
      display={<span>{task.taskType ?? "—"}</span>}
      editor={
        <FilterSelect
          value={task.taskType ?? ""}
          onChange={(value) => onChange(value || null)}
          options={[{ value: "", label: "None" }, ...TASK_TYPE_OPTIONS.map((type) => ({ value: type, label: type.replace(/_/g, " ") }))]}
        />
      }
    />
  );
}

function MilestoneCell({
  task,
  milestones,
  canEdit,
  saving,
  onChange,
}: {
  task: WorkspaceTask;
  milestones: ProjectMilestone[];
  canEdit: boolean;
  saving: boolean;
  onChange: (milestoneId: string | null) => void;
}) {
  const current = milestones.find((milestone) => milestone.id === task.milestoneId);
  return (
    <InlineCellShell
      canEdit={canEdit}
      saving={saving}
      display={<span>{current?.name ?? "—"}</span>}
      editor={
        <FilterSelect
          value={task.milestoneId ?? ""}
          onChange={(value) => onChange(value || null)}
          options={[{ value: "", label: "None" }, ...milestones.map((milestone) => ({ value: milestone.id, label: milestone.name }))]}
        />
      }
    />
  );
}

function TaskStatusCell({
  task,
  canEdit,
  saving,
  onChange,
}: {
  task: WorkspaceTask;
  canEdit: boolean;
  saving: boolean;
  onChange: (status: ProjectTaskStatus) => void;
}) {
  const display = <Badge tone={task.status === "done" ? "green" : task.status === "in_progress" ? "amber" : "blue"}>{task.status.replace("_", " ")}</Badge>;
  if (!canEdit) return <div className="text-xs">{display}</div>;
  return (
    <FilterSelect
      value={task.status}
      onChange={(value) => onChange(value as ProjectTaskStatus)}
      options={TASK_STATUS_OPTIONS}
      className={saving ? "opacity-50" : undefined}
    />
  );
}

function TagsCell({
  task,
  canEdit,
  saving,
  onChange,
}: {
  task: WorkspaceTask;
  canEdit: boolean;
  saving: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.tags.join(", "));

  if (!canEdit) return <div className="text-xs">{task.tags.join(", ") || "—"}</div>;

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(task.tags.join(", ")); setEditing(true); }}
        className={cn("min-h-8 w-full rounded-md px-1 text-left text-xs hover:bg-ink-100", saving && "opacity-50")}
      >
        {task.tags.join(", ") || <span className="text-ink-400">Add tags</span>}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        const tags = draft.split(",").map((tag) => tag.trim()).filter(Boolean);
        onChange(tags);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setEditing(false);
      }}
      placeholder="tag-one, tag-two"
      className="h-8 w-40 rounded-md border border-brand-500 bg-white px-2 text-xs outline-none"
    />
  );
}

function EstimationCell({
  task,
  canEdit,
  saving,
  onChange,
}: {
  task: WorkspaceTask;
  canEdit: boolean;
  saving: boolean;
  onChange: (estimatedMinutes: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(task.estimatedMinutes / 60)));

  if (!canEdit) return <div className="text-xs">{formatMinutes(task.estimatedMinutes)}</div>;

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(Math.round(task.estimatedMinutes / 60))); setEditing(true); }}
        className={cn("min-h-8 w-full rounded-md px-1 text-left text-xs hover:bg-ink-100", saving && "opacity-50")}
      >
        {formatMinutes(task.estimatedMinutes)}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      min={0}
      step={0.5}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        const hours = Number(draft);
        if (!Number.isNaN(hours) && hours >= 0) onChange(Math.round(hours * 60));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setEditing(false);
      }}
      className="h-8 w-20 rounded-md border border-brand-500 bg-white px-2 text-xs outline-none"
    />
  );
}

function WorkLogCell({
  task,
  canEdit,
  isRunning,
  runningSeconds,
  busy,
  onToggle,
}: {
  task: WorkspaceTask;
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

function KanbanWorkspace({
  projectId,
  sections,
  canCreate,
  canEditTask,
  canReassignTask,
  canManageSections,
  employees,
  onChanged,
  onTaskUpdated,
  onProjectTimeChanged,
  onSelectTask,
  collapseSubtasks,
}: {
  projectId: string;
  sections: ProjectSection[];
  canCreate: boolean;
  canEditTask: (task: WorkspaceTask) => boolean;
  canReassignTask: (task: WorkspaceTask) => boolean;
  canManageSections: boolean;
  employees: CompanyUser[];
  onChanged: () => void;
  onTaskUpdated: (task: WorkspaceTask) => void;
  onProjectTimeChanged: (trackedSeconds: number) => void;
  onSelectTask: (task: WorkspaceTask) => void;
  collapseSubtasks: boolean;
}) {
  const [draggingTask, setDraggingTask] = useState<WorkspaceTask | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftPriority, setDraftPriority] = useState<Record<string, ProjectPriority>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState("");
  const [savingSection, setSavingSection] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [activeTimer, setActiveTimer] = useState<ActiveTaskTimer | null>(null);
  const [stopTarget, setStopTarget] = useState<StopTimerTarget | null>(null);
  const [timerBusy, setTimerBusy] = useState<string | null>(null);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.getActiveTaskTimer(projectId).then(({ entry }) => setActiveTimer(entry));
  }, [projectId]);
  useEffect(() => {
    if (!activeTimer) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeTimer?.id]);

  async function drop(sectionId: string) {
    setDragOverSection(null);
    if (!draggingTask || !canEditTask(draggingTask) || draggingTask.sectionId === sectionId) return;
    const { task } = await api.moveProjectTask(projectId, draggingTask.id, sectionId);
    setDraggingTask(null);
    onTaskUpdated(task);
    onChanged();
  }

  async function addTask(section: ProjectSection) {
    const name = draft[section.id]?.trim();
    if (!name) return;
    setAdding(section.id);
    try {
      const { task } = await api.createProjectTask(projectId, { name, sectionId: section.id, priority: draftPriority[section.id] ?? "medium" });
      setDraft((current) => ({ ...current, [section.id]: "" }));
      setDraftPriority((current) => ({ ...current, [section.id]: "medium" }));
      onTaskUpdated(task);
    } finally {
      setAdding(null);
    }
  }

  async function duplicateTask(task: WorkspaceTask) {
    if (!canCreate) return;
    setSavingField(task.id);
    try {
      await api.createProjectTask(projectId, {
        name: `${task.name} Copy`, sectionId: task.sectionId, parentTaskId: task.parentTaskId,
        description: task.description, assigneeId: task.assigneeId, priority: task.priority,
        dueDate: task.dueDate, taskType: task.taskType, billingType: task.billingType as "billable" | "non_billable",
        tags: task.tags, estimatedMinutes: task.estimatedMinutes,
      });
      onChanged();
    } finally {
      setSavingField(null);
    }
  }

  async function addSection() {
    const name = sectionDraft.trim();
    if (!name) return;
    setSavingSection(true);
    setSectionError(null);
    try {
      await api.createProjectSection(projectId, { name });
      setSectionDraft("");
      setAddingSection(false);
      onChanged();
    } catch (err) {
      setSectionError(err instanceof ApiError ? err.message : "Failed to create section");
    } finally {
      setSavingSection(false);
    }
  }

  async function reassign(task: WorkspaceTask, assigneeId: string | null) {
    setSavingField(task.id);
    try {
      const { task: updated } = await api.updateProjectTask(projectId, task.id, { assigneeId });
      onTaskUpdated(updated);
    } finally {
      setSavingField(null);
    }
  }

  async function startTimer(task: WorkspaceTask) {
    setTimerBusy(task.id);
    setTimerError(null);
    try {
      const { entry } = await api.startTaskTimer(projectId, task.id);
      setActiveTimer(entry);
      setNow(Date.now());
      onChanged();
    } catch (err) {
      setTimerError(err instanceof ApiError ? err.message : "Timer could not be started");
    } finally {
      setTimerBusy(null);
    }
  }

  async function toggleTimer(task: WorkspaceTask) {
    if (activeTimer) {
      const runningTask = sections.flatMap((section) => section.tasks).find((candidate) => candidate.id === activeTimer.taskId);
      setStopTarget({ entry: activeTimer, task: runningTask, nextTask: activeTimer.taskId === task.id ? undefined : task });
      return;
    }
    await startTimer(task);
  }

  async function saveTimerLog(input: StopTimerInput) {
    if (!stopTarget) return;
    setTimerBusy(stopTarget.entry.taskId);
    try {
      const result = await api.stopTaskTimer(stopTarget.entry.projectId, stopTarget.entry.taskId, input);
      if (stopTarget.task) onTaskUpdated({ ...stopTarget.task, trackedSeconds: result.taskTrackedSeconds });
      if (stopTarget.entry.projectId === projectId) onProjectTimeChanged(result.projectTrackedSeconds);
      const nextTask = stopTarget.nextTask;
      setActiveTimer(null);
      setStopTarget(null);
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
      const nextTask = stopTarget.nextTask;
      setActiveTimer(null);
      setStopTarget(null);
      if (nextTask) await startTimer(nextTask);
    } finally {
      setTimerBusy(null);
    }
  }
  return (
    <>
    <div className="flex h-full min-w-max flex-col overflow-auto bg-white">
      {timerError && (
        <div className="mx-3 mt-3 flex items-center justify-between rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {timerError}
          <button onClick={() => setTimerError(null)} className="text-danger-500 hover:text-danger-700">×</button>
        </div>
      )}
    <div className="flex min-w-max flex-1 gap-2.5 p-3">
      {sections.map((section) => {
        const cards = collapseSubtasks
          ? section.tasks.filter((task) => !task.parentTaskId || !section.tasks.some((candidate) => candidate.id === task.parentTaskId))
          : section.tasks;
        if (collapsedSections[section.id]) {
          return (
            <section key={section.id} className="flex h-full w-12 shrink-0 flex-col items-center rounded-xl border border-ink-200 bg-surface-muted py-3">
              <button onClick={() => setCollapsedSections((value) => ({ ...value, [section.id]: false }))} className="rounded-full border border-ink-200 bg-white p-1 text-ink-500 hover:text-brand-600"><ChevronRight size={14} /></button>
              <span className="mt-3 text-xs font-semibold text-brand-600">{section.tasks.length}</span>
              <span className="mt-3 [writing-mode:vertical-rl] text-sm font-semibold text-ink-800">{section.name}</span>
            </section>
          );
        }
        return (
          <section
            key={section.id}
            onDragOver={(event) => { event.preventDefault(); if (draggingTask && canEditTask(draggingTask)) setDragOverSection(section.id); }}
            onDragLeave={() => setDragOverSection((current) => (current === section.id ? null : current))}
            onDrop={() => drop(section.id)}
            className={cn("flex h-full w-[340px] shrink-0 flex-col rounded-xl border bg-[#f7f8fc] transition-colors", dragOverSection === section.id ? "border-brand-400 bg-brand-50/60" : "border-ink-200")}
          >
            <header className="flex min-h-12 items-center gap-2 border-b border-ink-200 px-3">
              <span className="min-w-0 truncate text-sm font-semibold text-ink-900">{section.name}</span>
              <span className="text-xs font-semibold text-brand-600">({section.tasks.length})</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={() => setCollapsedSections((value) => ({ ...value, [section.id]: true }))} className="rounded-full border border-ink-200 bg-white p-1 text-ink-500 hover:text-brand-600" title="Collapse section"><ChevronLeft size={14} /></button>
                {canCreate && <button onClick={() => setAdding(section.id)} className="rounded-full border border-ink-200 bg-white p-1 text-ink-500 hover:text-brand-600" title="Add task"><Plus size={14} /></button>}
                {section.owner ? <MemberAvatar id={section.owner.id} name={section.owner.name} size="xs" status={section.owner.accountStatus === "active" ? "active" : "inactive"} /> : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-ink-400"><UserPlus size={13} /></span>}
                <DropdownMenu align="right" trigger={<button className="rounded p-1 text-ink-500 hover:bg-white"><MoreHorizontal size={15} /></button>} items={[
                  ...(canCreate ? [{ id: "add", label: "Add task", icon: <Plus size={14} />, onSelect: () => setAdding(section.id) }] : []),
                  { id: "collapse", label: "Collapse section", icon: <ChevronLeft size={14} />, onSelect: () => setCollapsedSections((value) => ({ ...value, [section.id]: true })) },
                ]} />
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {cards.length === 0 && adding !== section.id ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Zap size={22} className="text-ink-700" />
                  <p className="text-sm font-semibold text-ink-800">There's no Task made</p>
                  <p className="text-xs text-ink-400">Create to start new task activity</p>
                  {canCreate && <Button size="sm" variant="outline" leftIcon={<Plus size={14} />} onClick={() => setAdding(section.id)}>Add Task</Button>}
                </div>
              ) : cards.map((task) => {
                const childCount = section.tasks.filter((candidate) => candidate.parentTaskId === task.id).length;
                const isRunning = activeTimer?.taskId === task.id;
                const runningSeconds = isRunning ? Math.max(0, Math.floor((now - new Date(activeTimer.startedAt).getTime()) / 1000)) : 0;
                const overdue = Boolean(task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "done");
                return (
                  <article key={task.id} draggable={canEditTask(task)} onDragStart={() => canEditTask(task) && setDraggingTask(task)} onDragEnd={() => setDraggingTask(null)} onClick={() => onSelectTask(task)} className={cn("group relative rounded-xl border border-ink-200 bg-white shadow-sm transition-all hover:border-brand-300 hover:shadow-card", draggingTask?.id === task.id && "opacity-50")}>
                    <div className="flex items-start gap-2 px-3 pt-3">
                      <span className="rounded bg-ink-100 px-2 py-1 text-xs font-semibold text-ink-600">{task.code}</span>
                      <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-ink-900">{task.name}</p>
                      <div onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu trigger={<button className="rounded p-1 text-ink-400 opacity-0 hover:bg-ink-100 group-hover:opacity-100"><MoreHorizontal size={15} /></button>} items={[
                          { id: "open", label: "Open task details", onSelect: () => onSelectTask(task) },
                          ...(canCreate ? [{ id: "duplicate", label: "Duplicate task", icon: <Copy size={14} />, onSelect: () => duplicateTask(task) }] : []),
                        ]} />
                      </div>
                    </div>
                    <div className="flex min-h-11 flex-wrap items-center gap-1.5 px-3 py-2">
                      {task.tags.length ? task.tags.map((tag) => <Badge key={tag} tone="purple">{tag}</Badge>) : <span className="inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 text-[11px] text-ink-500"><Tag size={11} /> No Tags</span>}
                    </div>
                    <div className="flex min-h-12 items-center gap-2 border-t border-ink-100 px-3" onClick={(event) => event.stopPropagation()}>
                      {canReassignTask(task) ? <DropdownMenu align="left" trigger={task.assignee ? <MemberAvatar id={task.assignee.id} name={task.assignee.name} size="xs" status={task.assignee.accountStatus === "active" ? "active" : "inactive"} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full border border-ink-200 text-ink-400"><Users size={13} /></span>} items={[
                        { id: "unassigned", label: "Unassigned", icon: <Users size={14} />, onSelect: () => reassign(task, null) },
                        ...employees.map((user) => ({ id: user.id, label: user.name, icon: <MemberAvatar id={user.id} name={user.name} size="xs" status={user.accountStatus === "active" ? "active" : "inactive"} />, onSelect: () => reassign(task, user.id) })),
                      ]} /> : task.assignee ? <MemberAvatar id={task.assignee.id} name={task.assignee.name} size="xs" status={task.assignee.accountStatus === "active" ? "active" : "inactive"} /> : <Users size={15} className="text-ink-400" />}
                      <span className={cn("text-xs", overdue ? "font-medium text-danger-500" : "text-ink-500")}>{formatDate(task.dueDate)}</span>
                      <div className="ml-auto flex items-center gap-2 text-[11px] text-ink-500">
                        {canEditTask(task) && <button disabled={timerBusy === task.id} onClick={() => toggleTimer(task)} title={isRunning ? "Stop timer" : "Start timer"} className={cn("flex items-center gap-1 rounded px-1.5 py-1", isRunning ? "bg-danger-50 text-danger-600" : "hover:bg-success-50 hover:text-success-600")}>
                          {isRunning ? <span className="h-2.5 w-2.5 rounded-sm bg-danger-500" /> : <Play size={12} className="fill-current" />}
                          {isRunning && <span className="font-mono">{formatSeconds(runningSeconds)}</span>}
                        </button>}
                        {childCount > 0 && <span className="inline-flex items-center gap-0.5"><GitBranch size={12} />{childCount}</span>}
                        {task.attachments.length > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={12} />{task.attachments.length}</span>}
                        {task.comments.length > 0 && <span className="inline-flex items-center gap-0.5"><MessageCircle size={12} />{task.comments.length}</span>}
                        {canCreate && <button onClick={() => duplicateTask(task)} disabled={savingField === task.id} title="Duplicate task" className="hover:text-brand-600"><Copy size={12} /></button>}
                      </div>
                    </div>
                  </article>
                );
              })}

              {adding === section.id && (
                <div className="rounded-xl border border-brand-300 bg-white p-2">
                  <input autoFocus value={draft[section.id] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [section.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") addTask(section); if (event.key === "Escape") setAdding(null); }} onBlur={(event) => { if (!draft[section.id]?.trim() && !event.relatedTarget?.closest("[data-add-task-priority]")) setAdding(null); }} placeholder="Task name" className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-ink-400" />
                  <div className="mt-1.5 flex items-center gap-2">
                    <select data-add-task-priority value={draftPriority[section.id] ?? "medium"} onChange={(event) => setDraftPriority((current) => ({ ...current, [section.id]: event.target.value as ProjectPriority }))} className="h-8 flex-1 rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-700 outline-none focus:border-brand-500">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                    <Button size="sm" disabled={!draft[section.id]?.trim()} onClick={() => addTask(section)}>Add</Button>
                  </div>
                </div>
              )}
            </div>

            {canCreate && cards.length > 0 && adding !== section.id && <button onClick={() => setAdding(section.id)} className="m-3 rounded-lg border border-ink-200 bg-white py-2 text-xs font-medium text-ink-600 hover:border-brand-300 hover:text-brand-600"><Plus size={14} className="mr-1 inline" />Add Task</button>}
          </section>
        );
      })}

      {canManageSections && <div className="h-full w-[280px] shrink-0">{addingSection ? <div className="rounded-xl border border-brand-300 bg-white p-3">
        <input autoFocus value={sectionDraft} onChange={(event) => setSectionDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addSection(); if (event.key === "Escape") { setAddingSection(false); setSectionError(null); } }} placeholder="Section name" className="h-9 w-full rounded-md border border-ink-200 px-2.5 text-sm outline-none focus:border-brand-500" />
        {sectionError && <p className="mt-1.5 text-xs text-danger-600">{sectionError}</p>}
        <div className="mt-2 flex gap-2"><Button size="sm" onClick={addSection} disabled={savingSection || !sectionDraft.trim()}>Add Section</Button><Button size="sm" variant="outline" onClick={() => { setAddingSection(false); setSectionError(null); }}>Cancel</Button></div>
      </div> : <button onClick={() => setAddingSection(true)} className="flex h-11 w-full items-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 text-sm font-medium text-ink-500 hover:border-brand-400 hover:text-brand-600"><Plus size={16} />Add Section</button>}</div>}
    </div>
    </div>
    <TimerStopDialog target={stopTarget} busy={timerBusy !== null} onCancel={() => setStopTarget(null)} onSave={saveTimerLog} onDiscard={discardTimer} />
    </>
  );
}
function ProjectDashboard({ workspace }: { workspace: ProjectWorkspace }) {
  const { project, sections, milestones, members } = workspace;
  const tasks = sections.flatMap((section) => section.tasks);
  const overdue = tasks.filter((task) => task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "done").length;
  const stats = [
    { label: "Completion", value: `${project.completionPercent}%`, icon: <CheckCircle2 size={18} />, tone: "text-success-600 bg-success-50" },
    { label: "Health", value: project.healthStatus.replace("_", " "), icon: <HeartPulse size={18} />, tone: "text-brand-600 bg-brand-50" },
    { label: "Tasks", value: String(tasks.length), icon: <List size={18} />, tone: "text-info-600 bg-info-50" },
    { label: "Overdue", value: String(overdue), icon: <Clock3 size={18} />, tone: "text-danger-600 bg-danger-50" },
    { label: "Milestones", value: String(milestones.length), icon: <Flag size={18} />, tone: "text-purple-600 bg-purple-50" },
    { label: "Members", value: String(members.length), icon: <Users size={18} />, tone: "text-warning-600 bg-warning-50" },
  ];
  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {stats.map((stat) => <Card key={stat.label} className="p-4"><div className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-lg", stat.tone)}>{stat.icon}</div><p className="text-xl font-bold capitalize text-ink-900">{stat.value}</p><p className="text-xs text-ink-500">{stat.label}</p></Card>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold text-ink-900">Project progress</h3>
          <ProgressBar value={project.completionPercent} className="mt-5 h-2" />
          <div className="mt-5 grid grid-cols-3 gap-4 text-sm"><Summary label="Planned start" value={formatDate(project.startDate)} /><Summary label="Planned end" value={formatDate(project.dueDate)} /><Summary label="Methodology" value={project.methodology} /></div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-ink-900">Budget</h3>
          <p className="mt-4 text-2xl font-bold text-ink-900">{project.budget == null ? "Not set" : String(project.budget)}</p>
          <p className="mt-1 text-xs capitalize text-ink-500">{project.budgetStatus.replace("_", " ")}</p>
        </Card>
      </div>
    </div>
  );
}

function MilestoneWorkspace({
  projectId,
  milestones,
  companyUsers,
  canEdit,
  onChanged,
}: {
  projectId: string;
  milestones: ProjectWorkspace["milestones"];
  companyUsers: CompanyUser[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [editingMilestone, setEditingMilestone] = useState<ProjectMilestone | null>(null);
  const [deletingMilestone, setDeletingMilestone] = useState<ProjectMilestone | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    await api.createProjectMilestone(projectId, { name, ownerId: ownerId || null });
    setName("");
    onChanged();
  }

  async function confirmDelete() {
    if (!deletingMilestone) return;
    setDeleting(true);
    try {
      await api.deleteProjectMilestone(projectId, deletingMilestone.id);
      setDeletingMilestone(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Milestone could not be deleted");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="bg-white">
      <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3"><p className="font-semibold text-ink-900">{milestones.length} Milestones</p>{canEdit && <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Milestone name" className="w-52" /><Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-44"><option value="">No owner</option>{companyUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</Select><Button onClick={add}>Add</Button></div>}</div>
      {error && <div className="m-3 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">{error}</div>}
      <table className="w-full min-w-[900px] text-sm">
        <thead><tr className="border-b border-ink-200 bg-surface-subtle">{["Milestone Name", "Owner", "Start Date", "Release Date", "Progress", "Total Tasks", "Tags", "Description", ""].map((header) => <th key={header} className="px-4 py-3 text-left text-xs font-semibold text-ink-600">{header}</th>)}</tr></thead>
        <tbody>{milestones.map((milestone) => <tr key={milestone.id} className="border-b border-ink-100"><td className="px-4 py-3 font-medium text-ink-900">{milestone.name}</td><td className="px-4 py-3">{milestone.owner?.name ?? "—"}</td><td className="px-4 py-3">{formatDate(milestone.startDate)}</td><td className="px-4 py-3">{formatDate(milestone.releaseDate)}</td><td className="px-4 py-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-brand-500 text-[10px] font-semibold">{milestone.progress}%</span></td><td className="px-4 py-3">{milestone._count?.tasks ?? 0}</td><td className="px-4 py-3">{milestone.tags.join(", ") || "—"}</td><td className="px-4 py-3 text-ink-500">{milestone.description ?? "—"}</td><td className="px-4 py-3">{canEdit && <div className="flex items-center gap-0.5"><button onClick={() => setEditingMilestone(milestone)} title="Edit milestone" className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900"><Pencil size={14} /></button><button onClick={() => setDeletingMilestone(milestone)} title="Delete milestone" className="rounded p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"><Trash2 size={14} /></button></div>}</td></tr>)}</tbody>
      </table>

      <ProjectMilestoneEditModal
        projectId={projectId}
        milestone={editingMilestone}
        companyUsers={companyUsers}
        onClose={() => setEditingMilestone(null)}
        onSaved={() => { setEditingMilestone(null); onChanged(); }}
      />

      <Modal
        open={!!deletingMilestone}
        onClose={() => setDeletingMilestone(null)}
        title={`Delete ${deletingMilestone?.name}?`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingMilestone(null)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete Milestone"}</Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This permanently deletes <strong>{deletingMilestone?.name}</strong>. Tasks linked to it will keep their history but lose this milestone reference.
        </p>
      </Modal>
    </div>
  );
}

function ProjectMilestoneEditModal({
  projectId,
  milestone,
  companyUsers,
  onClose,
  onSaved,
}: {
  projectId: string;
  milestone: ProjectMilestone | null;
  companyUsers: CompanyUser[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!milestone) return;
    setName(milestone.name);
    setOwnerId(milestone.owner?.id ?? "");
    setStartDate(milestone.startDate ? milestone.startDate.slice(0, 10) : "");
    setReleaseDate(milestone.releaseDate ? milestone.releaseDate.slice(0, 10) : "");
    setDescription(milestone.description ?? "");
    setTags(milestone.tags.join(", "));
    setError(null);
  }, [milestone]);

  async function save() {
    if (!milestone || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateProjectMilestone(projectId, milestone.id, {
        name: name.trim(),
        ownerId: ownerId || null,
        startDate: startDate || null,
        releaseDate: releaseDate || null,
        description: description.trim() || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Milestone could not be updated");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!milestone}
      onClose={onClose}
      title="Edit milestone"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Milestone name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Owner">
          <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">No owner</option>
            {companyUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><DatePicker value={startDate} onChange={(value) => setStartDate(value ?? "")} max={releaseDate || null} /></Field>
          <Field label="Release date"><DatePicker value={releaseDate} onChange={(value) => setReleaseDate(value ?? "")} min={startDate || null} /></Field>
        </div>
        <Field label="Tags (comma separated)"><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Design, Paid" /></Field>
        <Field label="Description"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></Field>
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>
    </Modal>
  );
}

function GanttWorkspace({ sections }: { sections: ProjectSection[] }) {
  const tasks = sections.flatMap((section) => section.tasks);
  const days = Array.from({ length: 31 }, (_, index) => index + 1);
  return <div className="min-w-[1250px] bg-white">
    <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-3"><span className="text-sm text-ink-600">Group by:</span><Select className="w-36"><option>Tasks</option><option>Sections</option></Select><Button variant="outline" size="icon"><Maximize2 size={15} /></Button><div className="ml-auto flex gap-2"><Button variant="outline" size="sm">Incomplete Tasks</Button><Button variant="outline" size="sm">Due Date</Button><Button variant="outline" size="sm">All Users</Button></div></div>
    <div className="grid grid-cols-[340px_1fr] border-b border-ink-200"><div className="px-4 py-4 font-semibold">Tasks</div><div><div className="border-b border-ink-200 py-1 text-center text-xs font-semibold">July 2026</div><div className="grid" style={{ gridTemplateColumns: "repeat(31, minmax(28px, 1fr))" }}>{days.map((day) => <div key={day} className="border-r border-ink-100 py-2 text-center text-[10px]">{day}</div>)}</div></div></div>
    {tasks.length === 0 ? <EmptyWorkspace label="No data to display" /> : tasks.map((task) => {
      const start = task.startDate ? new Date(task.startDate).getDate() : 1;
      const end = task.dueDate ? new Date(task.dueDate).getDate() : start + 2;
      return <div key={task.id} className="grid grid-cols-[340px_1fr] border-b border-ink-100"><div className="px-4 py-3 text-sm">{task.code} · {task.name}</div><div className="relative grid" style={{ gridTemplateColumns: "repeat(31, minmax(28px, 1fr))" }}>{days.map((day) => <div key={day} className="border-r border-ink-100" />)}<div className="absolute top-2 h-5 rounded bg-brand-500/80" style={{ left: `${((start - 1) / 31) * 100}%`, width: `${(Math.max(1, end - start + 1) / 31) * 100}%` }} /></div></div>;
    })}
  </div>;
}

function CalendarWorkspace({ sections, onSelectTask }: { sections: ProjectSection[]; onSelectTask: (task: WorkspaceTask) => void }) {
  const [cursor, setCursor] = useState(new Date(2026, 6, 1));
  const tasks = sections.flatMap((section) => section.tasks);
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const offset = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => index - offset + 1);
  return <div className="bg-white"><div className="flex items-center gap-2 border-b border-ink-200 p-3"><Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={15} /></Button><b>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b><Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={15} /></Button><Select className="ml-3 w-36"><option>Month</option><option>Week</option></Select><div className="ml-auto"><Button variant="outline" size="sm">View for: Task</Button></div></div><div className="grid grid-cols-7">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <div key={day} className="border-b border-r border-ink-200 py-3 text-center text-xs font-semibold">{day}</div>)}{cells.map((day, index) => <div key={index} className="min-h-32 border-b border-r border-ink-200 p-2"><span className={cn("float-right text-xs font-semibold", day < 1 || day > count ? "text-ink-300" : "text-ink-800")}>{day < 1 ? new Date(year, month, day).getDate() : day > count ? day - count : day}</span>{day > 0 && day <= count && tasks.filter((task) => task.dueDate && new Date(task.dueDate).getFullYear() === year && new Date(task.dueDate).getMonth() === month && new Date(task.dueDate).getDate() === day).map((task) => <button key={task.id} onClick={() => onSelectTask(task)} className="mt-6 block w-full truncate rounded bg-brand-50 px-2 py-1 text-left text-xs text-brand-700">{task.name}</button>)}</div>)}</div></div>;
}

function ActivityWorkspace({ workspace, users }: { workspace: ProjectWorkspace; users: CompanyUser[] }) {
  return <div className="bg-white"><div className="flex items-center border-b border-ink-200 px-4 py-3"><h3 className="font-semibold">Activities</h3><div className="ml-auto flex gap-2"><Button variant="outline" size="sm">Activities Date</Button><Button variant="outline" size="sm">All Types</Button><Button variant="outline" size="sm">All Employees</Button></div></div>{workspace.activities.length === 0 ? <EmptyWorkspace label="No activities yet" /> : workspace.activities.map((activity) => { const actor = users.find((user) => user.id === activity.actorId); return <div key={activity.id} className="flex items-center gap-3 border-b border-ink-100 px-5 py-3">{actor ? <MemberAvatar id={actor.id} name={actor.name} size="sm" status={actor.accountStatus === "active" ? "active" : "inactive"} className="ring-0" /> : <Avatar initials="S" color="bg-ink-400" size="sm" />}<p className="text-sm"><b>{actor?.name ?? "System"}</b> {activity.action.replaceAll(".", " ")}.</p><span className="ml-auto text-xs text-ink-500">{new Date(activity.createdAt).toLocaleString()}</span></div>; })}</div>;
}

function DocumentWorkspace({ canEdit }: { canEdit: boolean }) {
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  return <div className="h-full bg-white"><div className="flex items-center border-b border-ink-200 p-3"><b>{files.length} Documents</b><div className="ml-auto flex gap-2"><Button variant="outline" size="sm">Sort</Button><Button variant="outline" size="sm">Type</Button>{canEdit && <label className="cursor-pointer rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white"><Plus size={14} className="mr-1 inline" />Upload<input type="file" multiple className="hidden" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? []).map((file) => ({ name: file.name, size: file.size }))])} /></label>}</div></div>{files.length === 0 ? <EmptyWorkspace label="No data to display" /> : <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">{files.map((file) => <Card key={file.name} className="p-4"><FileText className="text-brand-600" /><p className="mt-3 truncate text-sm font-semibold">{file.name}</p><p className="text-xs text-ink-500">{Math.ceil(file.size / 1024)} KB · Current version</p></Card>)}</div>}</div>;
}

function AutomationWorkspace({ canEdit }: { canEdit: boolean }) {
  const templates = ["Change Assignee", "Add Comment", "Change Section", "Add Task", "Change Followers", "Change Priority", "Complete Task", "Change Due Date", "Notify People", "Add Subtask"];
  return <div className="flex h-full bg-white"><aside className="w-48 border-r border-ink-200 p-4">{["Created","Assignee","Progress","Priority","Tags","Time","Dates","Sections","Task Type","Task Status","Custom Field"].map((item) => <button key={item} className="block w-full rounded px-2 py-2 text-left text-xs text-ink-600 hover:bg-brand-50">{item}</button>)}</aside><div className="flex-1 overflow-auto p-4"><div className="flex items-center"><h3 className="font-semibold text-brand-600">Templates</h3>{canEdit && <Button size="sm" className="ml-auto">Add Automation</Button>}</div><h4 className="mb-3 mt-5 font-semibold">Priority</h4><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{templates.map((template) => <Card key={template} className="p-4"><div className="flex items-center gap-3 text-brand-600"><Flag size={16} /><span>→</span><Zap size={16} /></div><p className="mt-5 text-sm text-ink-600">When <b>Priority Changes</b> then <b>{template}</b></p></Card>)}</div></div></div>;
}

function BudgetWorkspace({ workspace }: { workspace: ProjectWorkspace }) {
  const budget = Number(workspace.project.budget ?? 0), spent = Number(workspace.project.budgetSpent ?? 0), remaining = Math.max(0, budget - spent);
  return <div className="space-y-4 p-4"><div className="flex gap-6 border-b border-ink-200"><span className="border-b-2 border-brand-600 pb-3 text-sm text-brand-600">Overview</span>{["Budget","Expenses","Employee CTC","Project Health Report"].map((tab) => <span key={tab} className="pb-3 text-sm text-ink-500">{tab}</span>)}</div><div className="grid gap-4 lg:grid-cols-3"><Card className="p-5"><h3 className="font-semibold">Used vs. Remaining</h3><div className="mt-6 flex justify-between text-sm"><span>Total Budget<br/><b>{budget.toLocaleString()}</b></span><span>Used<br/><b>{spent.toLocaleString()}</b></span><span>Remaining<br/><b>{remaining.toLocaleString()}</b></span></div><ProgressBar value={budget ? spent / budget * 100 : 0} className="mt-4" /></Card><Card className="p-5"><h3 className="font-semibold text-success-600">Profitability</h3><p className="mt-6 text-2xl font-bold">{remaining.toLocaleString()}</p><p className="text-xs text-ink-500">Projected margin</p></Card><Card className="p-5"><h3 className="font-semibold text-danger-600">Expenses</h3><p className="mt-6 text-2xl font-bold">{spent.toLocaleString()}</p><p className="text-xs text-ink-500">Total project expenses</p></Card></div><Card className="min-h-80 p-5"><h3 className="font-semibold">Monthly Analysis</h3><div className="mt-20 flex h-36 items-end gap-6 border-b border-ink-200 px-8">{Array.from({ length: 12 }, (_, i) => <div key={i} className="flex-1 rounded-t bg-brand-500/70" style={{ height: `${Math.max(4, (spent / Math.max(1, budget)) * 120 * ((i + 1) / 12))}px` }} />)}</div><div className="mt-2 grid grid-cols-12 text-center text-[10px] text-ink-500">{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m) => <span key={m}>{m}</span>)}</div></Card></div>;
}

function EmptyWorkspace({ label }: { label: string }) {
  return <div className="flex min-h-[520px] items-center justify-center text-center"><div><Folder size={54} className="mx-auto text-brand-200" /><p className="mt-4 text-lg font-semibold text-ink-900">{label}</p></div></div>;
}

function MemberDrawer({
  open,
  projectId,
  users,
  existingUserIds,
  onClose,
  onChanged,
}: {
  open: boolean;
  projectId: string;
  users: CompanyUser[];
  existingUserIds: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [access, setAccess] = useState<"view" | "edit" | "manage">("edit");
  const available = users.filter((user) => !existingUserIds.includes(user.id));
  async function add() {
    if (!userId) return;
    await api.addProjectMember(projectId, { userId, access });
    setUserId("");
    onChanged();
    onClose();
  }
  return (
    <Drawer open={open} onClose={onClose} title="Project team and access" width="max-w-2xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={add} disabled={!userId}>Add Member</Button></>}>
      <div className="space-y-5">
        <div className="flex gap-5 border-b border-ink-200"><span className="border-b-2 border-brand-600 px-1 pb-3 text-sm font-semibold text-brand-600">Active Members</span><span className="px-1 pb-3 text-sm text-ink-500">Inactive Members</span><span className="px-1 pb-3 text-sm text-ink-500">Default Project Access</span></div>
        <Field label="Organization member"><Select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Select a person</option>{available.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</Select></Field>
        <Field label="Project permission"><Select value={access} onChange={(e) => setAccess(e.target.value as typeof access)}><option value="view">Can view</option><option value="edit">Can edit</option><option value="manage">Can manage</option></Select></Field>
      </div>
    </Drawer>
  );
}

const activityLabels: Record<string, string> = {
  "project.task.created": "created this task",
  "project.task.moved": "moved this task",
  "project.task.checklist_added": "added a checklist item",
  "project.task.attachment_added": "added an attachment",
  "project.task.attachment_removed": "removed an attachment",
  "project.task.timer.started": "started the timer",
  "project.task.timer.stopped": "stopped the timer and saved a work log",
  "project.task.timer.discarded": "deleted a running timer",
};
const updatedFieldLabels: Record<string, string> = {
  assigneeId: "assignee",
  status: "status",
  priority: "priority",
  progress: "progress",
  dueDate: "due date",
  startDate: "start date",
  estimatedMinutes: "estimate",
  taskType: "task type",
  milestoneId: "milestone",
  tags: "tags",
  followerIds: "followers",
  dependencyIds: "dependencies",
  name: "name",
  description: "description",
  billingType: "billing type",
  sectionId: "section",
};

function describeActivity(activity: AuditLogEntry): string {
  if (activity.action === "project.task.updated") {
    const changes = (activity.metadata?.changes as string[] | undefined) ?? [];
    const labels = changes.map((field) => updatedFieldLabels[field] ?? field);
    return labels.length ? `updated ${labels.join(", ")}` : "updated this task";
  }
  return activityLabels[activity.action] ?? activity.action.replaceAll(".", " ");
}

/** Merges audit-log events and comments into one chronological feed. `project.task.comment_added`
 *  audit entries are excluded — the comment itself (with its body) already appears via `comments`,
 *  so including both would show the same event twice with no text on the audit-log copy. */
function ActivityTimeline({
  activities,
  comments,
  employees,
  canEdit,
  currentUserId,
  onRemoveComment,
}: {
  activities: AuditLogEntry[];
  comments: TaskComment[];
  employees: CompanyUser[];
  canEdit: boolean;
  currentUserId: string;
  onRemoveComment: (commentId: string) => void;
}) {
  type TimelineEntry =
    | { kind: "activity"; id: string; createdAt: string; activity: AuditLogEntry }
    | { kind: "comment"; id: string; createdAt: string; comment: TaskComment };

  const entries: TimelineEntry[] = [
    ...activities
      .filter((activity) => activity.action !== "project.task.comment_added")
      .map((activity): TimelineEntry => ({ kind: "activity", id: activity.id, createdAt: activity.createdAt, activity })),
    ...comments.map((comment): TimelineEntry => ({ kind: "comment", id: comment.id, createdAt: comment.createdAt, comment })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (entries.length === 0) return <p>No task activity yet.</p>;

  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        if (entry.kind === "comment") {
          const comment = entry.comment;
          return (
            <div key={`comment-${comment.id}`} className="flex gap-2">
              <MemberAvatar id={comment.authorId} name={comment.author.name} size="sm" status={comment.author.accountStatus === "active" ? "active" : "inactive"} className="ring-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <b className="text-ink-900">{comment.author.name}</b>
                  <span className="text-xs text-ink-400">{new Date(comment.createdAt).toLocaleString()}</span>
                  {canEdit && comment.authorId === currentUserId && (
                    <button className="ml-auto text-ink-400 hover:text-danger-600" onClick={() => onRemoveComment(comment.id)}><Trash2 size={13} /></button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-ink-700">{comment.body}</p>
              </div>
            </div>
          );
        }
        const activity = entry.activity;
        const actor = employees.find((employee) => employee.id === activity.actorId);
        return (
          <div key={`activity-${activity.id}`} className="flex gap-2">
            {actor ? <MemberAvatar id={actor.id} name={actor.name} size="sm" status={actor.accountStatus === "active" ? "active" : "inactive"} className="ring-0" /> : <Avatar initials="S" color="bg-ink-400" size="sm" />}
            <div>
              <p><b className="text-ink-900">{actor?.name ?? "Project system"}</b> {describeActivity(activity)}</p>
              <p className="mt-0.5 text-xs text-ink-400">{new Date(activity.createdAt).toLocaleString()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TaskWorkspaceDrawer({
  task,
  projectId,
  projectName,
  allTasks,
  employees,
  milestones,
  taskActivities,
  currentUserId,
  canEdit,
  canReassign,
  canDelete,
  onTaskChanged,
  onTaskDeleted,
  onProjectTimeChanged,
  onClose,
}: {
  task: WorkspaceTask | null;
  projectId: string;
  projectName: string;
  allTasks: WorkspaceTask[];
  employees: CompanyUser[];
  milestones: ProjectMilestone[];
  taskActivities: AuditLogEntry[];
  currentUserId: string;
  canEdit: boolean;
  canReassign: boolean;
  canDelete: boolean;
  onTaskChanged: (task: WorkspaceTask) => void;
  onTaskDeleted: (taskId: string) => void;
  onProjectTimeChanged: (trackedSeconds: number) => void;
  onClose: () => void;
}) {
  const [localTask, setLocalTask] = useState<WorkspaceTask | null>(task);
  const [panel, setPanel] = useState<"activities" | "worklog" | "approval" | "planner">("activities");
  const [lowerTab, setLowerTab] = useState<"subtasks" | "checklist">("subtasks");
  const [entries, setEntries] = useState(task?.timeEntries ?? []);
  const [activeTimer, setActiveTimer] = useState<ActiveTaskTimer | null>(null);
  const [stopTarget, setStopTarget] = useState<StopTimerTarget | null>(null);
  const [trackedSeconds, setTrackedSeconds] = useState(task?.trackedSeconds ?? 0);
  const [now, setNow] = useState(Date.now());
  const [timerBusy, setTimerBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(task?.description ?? "");
  const [descriptionEditing, setDescriptionEditing] = useState(canEdit && !task?.description);
  const [tagText, setTagText] = useState(task?.tags.join(", ") ?? "");
  const [estimateHours, setEstimateHours] = useState(task?.estimatedMinutes ? String(Math.floor(task.estimatedMinutes / 60)) : "");
  const [estimateMinutes, setEstimateMinutes] = useState(task?.estimatedMinutes ? String(task.estimatedMinutes % 60).padStart(2, "0") : "");
  const [commentText, setCommentText] = useState("");
  const [checkItem, setCheckItem] = useState("");
  const [subtaskName, setSubtaskName] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logDate, setLogDate] = useState("");
  const [logHours, setLogHours] = useState("");
  const [logMinutes, setLogMinutes] = useState("");
  const [logActivity, setLogActivity] = useState("");
  const [logBillable, setLogBillable] = useState(false);
  const [logNote, setLogNote] = useState("");
  const [logSaving, setLogSaving] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    setLocalTask(task);
    setEntries(task?.timeEntries ?? []);
    setTrackedSeconds(task?.trackedSeconds ?? 0);
    setDescription(task?.description ?? "");
    setDescriptionEditing(canEdit && !task?.description);
    setTagText(task?.tags.join(", ") ?? "");
    setEstimateHours(task?.estimatedMinutes ? String(Math.floor(task.estimatedMinutes / 60)) : "");
    setEstimateMinutes(task?.estimatedMinutes ? String(task.estimatedMinutes % 60).padStart(2, "0") : "");
    setError(null);
  }, [task]);

  useEffect(() => {
    if (!task || !currentUserId) { setActiveTimer(null); return; }
    let cancelled = false;
    api.getActiveTaskTimer(projectId)
      .then(({ entry }) => {
        if (cancelled) return;
        setActiveTimer(entry);
        if (entry?.taskId === task.id) {
          setEntries((current) => current.some((item) => item.id === entry.id) ? current : [entry, ...current]);
        }
        setNow(Date.now());
      })
      .catch(() => { if (!cancelled) setActiveTimer(null); });
    return () => { cancelled = true; };
  }, [task?.id, currentUserId, projectId]);

  useEffect(() => {
    if (!activeTimer) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeTimer?.id]);

  if (!localTask) return null;
  const currentTask: WorkspaceTask = localTask;
  const taskId = currentTask.id;
  const runningSeconds = activeTimer ? Math.max(0, Math.floor((now - new Date(activeTimer.startedAt).getTime()) / 1000)) : 0;
  const liveSeconds = trackedSeconds + (activeTimer?.taskId === taskId ? runningSeconds : 0);
  const subtasks = allTasks.filter((candidate) => candidate.parentTaskId === taskId);
  const activeEmployees = employees.filter((employee) => employee.accountStatus === "active");
  const followerIds = localTask.followers.map((follower) => follower.userId);
  const dependencyIds = localTask.dependencies.map((dependency) => dependency.dependsOnTaskId);
  const dependencyOptions = allTasks.filter((candidate) => candidate.id !== taskId && !dependencyIds.includes(candidate.id));

  async function updateTask(input: Parameters<typeof api.updateProjectTask>[2]) {
    if (!canEdit) return null;
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateProjectTask(projectId, taskId, input);
      setLocalTask(result.task);
      setEntries(result.task.timeEntries);
      setTrackedSeconds(result.task.trackedSeconds);
      onTaskChanged(result.task);
      return result.task;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Task could not be updated");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteProjectTask(projectId, taskId);
      setConfirmDelete(false);
      onTaskDeleted(taskId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Task could not be deleted");
    } finally {
      setDeleting(false);
    }
  }

  async function saveDescription() {
    const saved = await updateTask({ description: description.trim() || null });
    if (!saved) return;
    setDescription(saved.description ?? "");
    setDescriptionEditing(false);
  }

  async function saveEstimate(hoursValue = estimateHours, minutesValue = estimateMinutes) {
    const hours = Math.max(0, Math.floor(Number(hoursValue || 0)));
    const enteredMinutes = Math.max(0, Math.floor(Number(minutesValue || 0)));
    const normalizedHours = hours + Math.floor(enteredMinutes / 60);
    const normalizedMinutes = enteredMinutes % 60;
    setEstimateHours(normalizedHours ? String(normalizedHours) : "");
    setEstimateMinutes(normalizedHours || normalizedMinutes ? String(normalizedMinutes).padStart(2, "0") : "");
    await updateTask({ estimatedMinutes: normalizedHours * 60 + normalizedMinutes });
  }

  async function clearEstimate() {
    setEstimateHours("");
    setEstimateMinutes("");
    await updateTask({ estimatedMinutes: 0 });
  }

  async function logTime() {
    if (!canEdit) return;
    const hours = Math.max(0, Math.floor(Number(logHours || 0)));
    const minutes = Math.max(0, Math.floor(Number(logMinutes || 0)));
    const durationMinutes = hours * 60 + minutes;
    if (!logDate) { setLogError("Please choose a date"); return; }
    if (durationMinutes <= 0) { setLogError("Duration must be greater than 0"); return; }
    if (!logActivity) { setLogError("Please select an activity"); return; }
    if (!logNote.trim()) { setLogError("Please add a description"); return; }
    setLogSaving(true);
    setLogError(null);
    try {
      const result = await api.logTaskTime(projectId, taskId, {
        date: logDate,
        durationMinutes,
        activityType: logActivity,
        billable: logBillable,
        note: logNote.trim(),
      });
      setEntries((current) => [result.entry, ...current]);
      setTrackedSeconds(result.taskTrackedSeconds);
      if (result.entry.projectId === projectId) onProjectTimeChanged(result.projectTrackedSeconds);
      setShowLogForm(false);
      setLogDate(""); setLogHours(""); setLogMinutes(""); setLogActivity(""); setLogBillable(false); setLogNote("");
    } catch (err) {
      setLogError(err instanceof ApiError ? err.message : "Time log could not be saved");
    } finally {
      setLogSaving(false);
    }
  }

  async function toggleTimer() {
    if (!canEdit) return;
    setError(null);
    if (activeTimer) {
      const runningTask = activeTimer.taskId === taskId ? currentTask : allTasks.find((candidate) => candidate.id === activeTimer.taskId);
      setStopTarget({ entry: activeTimer, task: runningTask });
      return;
    }
    setTimerBusy(true);
    try {
      const result = await api.startTaskTimer(projectId, taskId, {
        activityType: currentTask.taskType ?? "Work",
        billable: currentTask.billingType === "billable",
      });
      setActiveTimer(result.entry);
      setEntries((current) => current.some((entry) => entry.id === result.entry.id) ? current : [result.entry, ...current]);
      setNow(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const conflictingEntry = (err.body as { activeEntry?: ActiveTaskTimer } | undefined)?.activeEntry;
        if (conflictingEntry) {
          setActiveTimer(conflictingEntry);
          setStopTarget({ entry: conflictingEntry, task: allTasks.find((candidate) => candidate.id === conflictingEntry.taskId) });
          setNow(Date.now());
          setError("Another task timer is running. Save its work log before starting this task.");
        } else setError(err.message);
      } else setError(err instanceof ApiError ? err.message : "Timer could not be started");
    } finally {
      setTimerBusy(false);
    }
  }

  async function saveTimerLog(input: StopTimerInput) {
    if (!stopTarget) return;
    setTimerBusy(true);
    setError(null);
    try {
      const result = await api.stopTaskTimer(stopTarget.entry.projectId, stopTarget.entry.taskId, input);
      if (stopTarget.entry.taskId === taskId) {
        const nextEntries = entries.map((entry) => entry.id === result.entry.id ? result.entry : entry);
        setEntries(nextEntries);
        setTrackedSeconds(result.taskTrackedSeconds);
        onTaskChanged({ ...currentTask, trackedSeconds: result.taskTrackedSeconds, timeEntries: nextEntries });
      } else {
        const affectedTask = allTasks.find((item) => item.id === stopTarget.entry.taskId);
        if (affectedTask) onTaskChanged({ ...affectedTask, trackedSeconds: result.taskTrackedSeconds });
      }
      if (stopTarget.entry.projectId === projectId) onProjectTimeChanged(result.projectTrackedSeconds);
      setActiveTimer(null);
      setStopTarget(null);
      setNow(Date.now());
    } finally {
      setTimerBusy(false);
    }
  }

  async function discardTimer() {
    if (!stopTarget) return;
    setTimerBusy(true);
    try {
      await api.discardTaskTimer(stopTarget.entry.projectId, stopTarget.entry.taskId);
      if (stopTarget.entry.taskId === taskId) setEntries((current) => current.filter((entry) => entry.id !== stopTarget.entry.id));
      setActiveTimer(null);
      setStopTarget(null);
      setNow(Date.now());
    } finally {
      setTimerBusy(false);
    }
  }
  async function addFollower(userId: string) {
    if (!userId || followerIds.includes(userId)) return;
    await updateTask({ followerIds: [...followerIds, userId] });
  }

  async function addDependency(dependsOnTaskId: string) {
    if (!dependsOnTaskId) return;
    await updateTask({ dependencyIds: [...dependencyIds, dependsOnTaskId] });
  }

  async function addComment() {
    if (!commentText.trim() || !canEdit) return;
    setSaving(true);
    try {
      const result = await api.addTaskComment(projectId, taskId, commentText.trim());
      setLocalTask((current) => current ? { ...current, comments: [...current.comments, result.comment] } : current);
      setCommentText("");
  
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Comment could not be added");
    } finally {
      setSaving(false);
    }
  }

  async function removeComment(commentId: string) {
    await api.deleteTaskComment(projectId, taskId, commentId);
    setLocalTask((current) => current ? { ...current, comments: current.comments.filter((comment) => comment.id !== commentId) } : current);

  }

  async function addChecklistItem() {
    if (!checkItem.trim() || !canEdit) return;
    const result = await api.addTaskChecklistItem(projectId, taskId, checkItem.trim());
    setLocalTask((current) => current ? { ...current, checklistItems: [...current.checklistItems, result.item] } : current);
    setCheckItem("");

  }

  async function toggleChecklistItem(itemId: string, completed: boolean) {
    const result = await api.updateTaskChecklistItem(projectId, taskId, itemId, { completed });
    setLocalTask((current) => current ? { ...current, checklistItems: current.checklistItems.map((item) => item.id === itemId ? result.item : item) } : current);

  }

  async function removeChecklistItem(itemId: string) {
    await api.deleteTaskChecklistItem(projectId, taskId, itemId);
    setLocalTask((current) => current ? { ...current, checklistItems: current.checklistItems.filter((item) => item.id !== itemId) } : current);

  }

  async function addAttachment() {
    if (!attachmentName.trim() || !attachmentUrl.trim() || !canEdit) return;
    try {
      const result = await api.addTaskAttachment(projectId, taskId, { name: attachmentName.trim(), url: attachmentUrl.trim() });
      setLocalTask((current) => current ? { ...current, attachments: [...current.attachments, result.attachment] } : current);
      setAttachmentName("");
      setAttachmentUrl("");
  
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Attachment could not be added");
    }
  }

  async function removeAttachment(attachmentId: string) {
    if (!canEdit) return;
    await api.deleteTaskAttachment(projectId, taskId, attachmentId);
    setLocalTask((current) => current ? { ...current, attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId) } : current);

  }

  async function addSubtask() {
    if (!subtaskName.trim() || !canEdit) return;
    const result = await api.createProjectTask(projectId, { name: subtaskName.trim(), sectionId: currentTask.sectionId, parentTaskId: taskId });
    setSubtaskName("");
    onTaskChanged(result.task);
  }

  const dateValue = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : "";

  return (
    <>
    <Drawer open={!!task} onClose={onClose} title={`Task ${localTask.code} · ${localTask.name}`} width="max-w-[1280px]">
      <div className="-mx-6 -my-5 grid min-h-[calc(100vh-65px)] gap-0 overflow-hidden border-t border-ink-200 bg-white lg:grid-cols-[minmax(0,1fr)_430px]">
        <div className="min-w-0 border-r border-ink-200">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-surface-subtle px-4 py-3">
            <div className="w-40 shrink-0">
              <Select value={localTask.status} onChange={(event) => updateTask({ status: event.target.value as WorkspaceTask["status"] })} disabled={!canEdit || saving}>
                <option value="new_request">New Request</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Completed</option>
              </Select>
            </div>
            <div className="w-32 shrink-0">
              <Select value={localTask.priority} onChange={(event) => updateTask({ priority: event.target.value as WorkspaceTask["priority"] })} disabled={!canEdit || saving}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </Select>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3">
              <span className="text-xs font-medium text-ink-500">Progress</span>
              <Select value={localTask.progress} onChange={(event) => updateTask({ progress: Number(event.target.value) })} disabled={!canEdit || saving} className="h-9 w-20 border-0 px-1 pr-6 shadow-none focus:ring-0">
                {[0, 10, 25, 50, 75, 90, 100].map((value) => <option key={value} value={value}>{value}%</option>)}
              </Select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {activeTimer && activeTimer.taskId !== taskId && <span className="hidden max-w-36 truncate text-[11px] font-medium text-warning-600 xl:inline" title={activeTimer.task?.name ?? "Another task"}>Running: {activeTimer.task ? `#${activeTimer.task.code} ${activeTimer.task.name}` : "another task"}</span>}
              <span className={cn("rounded-md bg-white px-2 py-1 font-mono text-xs", activeTimer && "text-danger-600 ring-1 ring-danger-200")}>{formatSeconds(activeTimer ? runningSeconds : trackedSeconds)}</span>
              <Button size="sm" onClick={toggleTimer} disabled={!canEdit || timerBusy} className={cn("px-3", activeTimer ? "bg-danger-500 hover:bg-danger-600" : "bg-success-500 hover:bg-success-600")}>
                {activeTimer ? <><span className="mr-1.5 h-3 w-3 rounded-sm bg-white" /> Stop</> : <><Play size={14} className="mr-1.5 fill-white" /> Start</>}
              </Button>
              {canDelete && (
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)} className="border-danger-200 px-3 text-danger-600 hover:bg-danger-50">
                  <Trash2 size={14} className="mr-1.5" /> Delete
                </Button>
              )}
            </div>
          </div>

          {error && <div className="m-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</div>}

          <div className="p-4">
            <Input
              value={localTask.name}
              onChange={(event) => setLocalTask((current) => current ? { ...current, name: event.target.value } : current)}
              onBlur={() => updateTask({ name: localTask.name })}
              disabled={!canEdit}
              className="mb-3 border-0 px-0 text-lg font-semibold shadow-none focus:ring-0"
            />
            <dl className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              <TaskRow icon={<Folder size={15} />} label="Project Name"><span className="font-medium text-ink-800">{projectName}</span></TaskRow>
              <TaskRow icon={<Users size={15} />} label="Assignee">
                <EmployeePicker employees={activeEmployees} value={localTask.assigneeId} onChange={(employeeId) => updateTask({ assigneeId: employeeId })} disabled={!canReassign || saving} placeholder="Unassigned" allowClear />
              </TaskRow>
              <TaskRow icon={<CalendarDays size={15} />} label="Start Date"><DatePicker value={dateValue(localTask.startDate)} onChange={(value) => updateTask({ startDate: value })} disabled={!canEdit} max={dateValue(localTask.dueDate) || null} /></TaskRow>
              <TaskRow icon={<CalendarDays size={15} />} label="Due Date"><DatePicker value={dateValue(localTask.dueDate)} onChange={(value) => updateTask({ dueDate: value })} disabled={!canEdit} min={dateValue(localTask.startDate) || null} /></TaskRow>
              <TaskRow icon={<Clock3 size={15} />} label="Estimation Hours">
                <div className="flex max-w-sm items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2">
                  <input type="number" min="0" inputMode="numeric" value={estimateHours} onChange={(event) => setEstimateHours(event.target.value)} onBlur={(event) => saveEstimate(event.currentTarget.value, estimateMinutes)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} disabled={!canEdit || saving} placeholder="00" aria-label="Estimated hours" className="w-14 border-0 border-b border-ink-300 bg-transparent px-1 py-1 text-center text-sm font-semibold text-ink-800 outline-none focus:border-brand-500 disabled:text-ink-400" />
                  <span className="text-xs font-medium text-ink-500">H :</span>
                  <input type="number" min="0" max="59" inputMode="numeric" value={estimateMinutes} onChange={(event) => setEstimateMinutes(event.target.value)} onBlur={(event) => saveEstimate(estimateHours, event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} disabled={!canEdit || saving} placeholder="00" aria-label="Estimated minutes" className="w-14 border-0 border-b border-ink-300 bg-transparent px-1 py-1 text-center text-sm font-semibold text-ink-800 outline-none focus:border-brand-500 disabled:text-ink-400" />
                  <span className="text-xs font-medium text-ink-500">M</span>
                  {canEdit && localTask.estimatedMinutes > 0 && <button type="button" onClick={clearEstimate} disabled={saving} className="rounded-md p-1 text-ink-400 hover:bg-white hover:text-danger-600" title="Clear estimate"><X size={14} /></button>}
                  <span className="ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500" title="Task estimate"><AlarmClock size={15} /></span>
                </div>
              </TaskRow>
              <TaskRow icon={<Users size={15} />} label="Task Followers">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">{localTask.followers.map((follower) => <span key={follower.id} className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-700"><MemberAvatar id={follower.userId} name={follower.user.name} size="xs" status={follower.user.accountStatus === "active" ? "active" : "inactive"} />{follower.user.name}{canEdit && <button onClick={() => updateTask({ followerIds: followerIds.filter((id) => id !== follower.userId) })}><X size={12} /></button>}</span>)}{localTask.followers.length === 0 && <span className="text-xs text-ink-400">No followers</span>}</div>
                  {canEdit && <EmployeePicker employees={activeEmployees} value={null} excludeIds={followerIds} onChange={(employeeId) => employeeId && addFollower(employeeId)} disabled={saving} placeholder="Add follower" />}
                </div>
              </TaskRow>
              <TaskRow icon={<List size={15} />} label="Task Type"><Input defaultValue={localTask.taskType ?? ""} placeholder="e.g. Development, Bug, Review" onBlur={(event) => updateTask({ taskType: event.target.value.trim() || null })} disabled={!canEdit} /></TaskRow>
              <TaskRow icon={<WalletCards size={15} />} label="Billing Type"><Select value={localTask.billingType} onChange={(event) => updateTask({ billingType: event.target.value as "billable" | "non_billable" })} disabled={!canEdit}><option value="non_billable">Non-billable</option><option value="billable">Billable</option></Select></TaskRow>
              <TaskRow icon={<Flag size={15} />} label="Milestone"><Select value={localTask.milestoneId ?? ""} onChange={(event) => updateTask({ milestoneId: event.target.value || null })} disabled={!canEdit}><option value="">Not selected</option>{milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.name}</option>)}</Select></TaskRow>
              <TaskRow icon={<Tag size={15} />} label="Tags"><Input value={tagText} onChange={(event) => setTagText(event.target.value)} onBlur={() => updateTask({ tags: tagText.split(",").map((tag) => tag.trim()).filter(Boolean) })} placeholder="Bug, UI, Urgent" disabled={!canEdit} /></TaskRow>
              <TaskRow icon={<GanttChartSquare size={15} />} label="Dependencies">
                <div className="space-y-2"><div className="flex flex-wrap gap-1.5">{localTask.dependencies.map((dependency) => <span key={dependency.id} className="flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-xs"><Link2 size={11} />#{dependency.dependsOnTask.code} {dependency.dependsOnTask.name}{canEdit && <button onClick={() => updateTask({ dependencyIds: dependencyIds.filter((id) => id !== dependency.dependsOnTaskId) })}><X size={11} /></button>}</span>)}{localTask.dependencies.length === 0 && <span className="text-xs text-ink-400">No dependencies</span>}</div>{canEdit && <Select value="" onChange={(event) => addDependency(event.target.value)}><option value="">+ Add dependency</option>{dependencyOptions.map((candidate) => <option key={candidate.id} value={candidate.id}>#{candidate.code} {candidate.name}</option>)}</Select>}</div>
              </TaskRow>
            </dl>

            <div className="mt-4 rounded-lg border border-ink-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-ink-700">Description</p>
                {canEdit && (descriptionEditing ? (
                  <Button size="sm" variant="outline" onClick={saveDescription} disabled={saving}>Save</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setDescriptionEditing(true)} disabled={saving}>Edit</Button>
                ))}
              </div>
              {canEdit && descriptionEditing ? (
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Please enter task description..." className="min-h-28 w-full resize-y text-sm outline-none" />
              ) : (
                <div className="min-h-20 whitespace-pre-wrap break-words text-sm leading-6 text-ink-700">{renderLinkedDescription(description)}</div>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-ink-200 p-4">
              <div className="mb-3 flex items-center gap-2"><Paperclip size={15} className="text-ink-500" /><p className="text-sm font-medium text-ink-700">Attachments ({localTask.attachments.length})</p></div>
              <div className="mb-3 flex flex-wrap gap-2">{localTask.attachments.map((attachment) => <span key={attachment.id} className="inline-flex items-center rounded-lg border border-ink-200 text-xs"><a href={attachment.url} target="_blank" rel="noreferrer" className="px-3 py-2 text-brand-600 hover:bg-brand-50"><FileText size={14} className="mr-1.5 inline" />{attachment.name}</a>{canEdit && <button type="button" onClick={() => removeAttachment(attachment.id)} className="border-l border-ink-200 px-2 py-2 text-ink-400 hover:text-danger-600" aria-label={`Remove ${attachment.name}`}><Trash2 size={13} /></button>}</span>)}{localTask.attachments.length === 0 && <span className="text-xs text-ink-400">No attachments</span>}</div>
              {canEdit && <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"><Input value={attachmentName} onChange={(event) => setAttachmentName(event.target.value)} placeholder="File name" /><Input value={attachmentUrl} onChange={(event) => setAttachmentUrl(event.target.value)} placeholder="https:// file URL" /><Button variant="outline" onClick={addAttachment}>Add</Button></div>}
            </div>

            <div className="mt-4 flex gap-5 border-b border-ink-200 text-sm"><button onClick={() => setLowerTab("subtasks")} className={cn("pb-2", lowerTab === "subtasks" ? "border-b-2 border-brand-600 font-semibold text-brand-600" : "text-ink-500")}>Subtasks ({subtasks.length})</button><button onClick={() => setLowerTab("checklist")} className={cn("pb-2", lowerTab === "checklist" ? "border-b-2 border-brand-600 font-semibold text-brand-600" : "text-ink-500")}>Checklist ({localTask.checklistItems.length})</button></div>
            {lowerTab === "subtasks" ? <div className="divide-y divide-ink-100">{subtasks.map((subtask) => <div key={subtask.id} className="flex items-center gap-3 py-3 text-sm"><CheckCircle2 size={15} className={subtask.status === "done" ? "text-success-500" : "text-ink-400"} /><span className="font-medium">#{subtask.code} {subtask.name}</span><Badge className="ml-auto" tone={subtask.status === "done" ? "green" : "blue"}>{subtask.status.replace("_", " ")}</Badge><span className="font-mono text-xs text-ink-500">{formatSeconds(subtask.trackedSeconds)}</span></div>)}{canEdit && <div className="flex gap-2 py-3"><Input value={subtaskName} onChange={(event) => setSubtaskName(event.target.value)} placeholder="Add subtask" /><Button variant="outline" onClick={addSubtask}>Add</Button></div>}</div> : <div className="divide-y divide-ink-100">{localTask.checklistItems.map((item) => <div key={item.id} className="flex items-center gap-3 py-2 text-sm"><input type="checkbox" checked={item.completed} onChange={(event) => toggleChecklistItem(item.id, event.target.checked)} disabled={!canEdit} /><span className={item.completed ? "text-ink-400 line-through" : ""}>{item.text}</span>{canEdit && <button className="ml-auto text-ink-400 hover:text-danger-600" onClick={() => removeChecklistItem(item.id)}><Trash2 size={14} /></button>}</div>)}{canEdit && <div className="flex gap-2 py-3"><Input value={checkItem} onChange={(event) => setCheckItem(event.target.value)} placeholder="Add checklist item" /><Button variant="outline" onClick={addChecklistItem}>Add</Button></div>}</div>}
          </div>
        </div>

        <div className="flex min-h-[640px] flex-col bg-white">
          <div className="flex overflow-x-auto border-b border-ink-200">{(["activities", "worklog", "approval", "planner"] as const).map((id) => <button key={id} onClick={() => setPanel(id)} className={cn("shrink-0 border-b-2 px-4 py-3 text-xs font-semibold capitalize", panel === id ? "border-brand-600 text-brand-600" : "border-transparent text-ink-500")}>{id === "worklog" ? "Work Log" : id}</button>)}</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-ink-600">
            {panel === "activities" && <ActivityTimeline activities={taskActivities} comments={localTask.comments} employees={employees} canEdit={canEdit} currentUserId={currentUserId} onRemoveComment={removeComment} />}
            {panel === "worklog" && (
              <div className="space-y-3">
                {canEdit && (
                  showLogForm ? (
                    <Card className="p-3">
                      <p className="mb-3 text-sm font-semibold text-ink-900">Log time</p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <Field label="Date" className="mb-0"><DatePicker value={logDate} onChange={(value) => setLogDate(value ?? "")} max={dateValue(new Date().toISOString())} allowClear={false} /></Field>
                        <Field label="Duration" className="mb-0">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="flex h-10 min-w-0 items-center rounded-lg border border-ink-200 bg-white px-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                              <input type="number" min="0" inputMode="numeric" value={logHours} onChange={(event) => setLogHours(event.target.value)} placeholder="00" aria-label="Worklog hours" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400" />
                              <span className="ml-1 shrink-0 text-xs font-semibold text-ink-500">H</span>
                            </label>
                            <label className="flex h-10 min-w-0 items-center rounded-lg border border-ink-200 bg-white px-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                              <input type="number" min="0" max="59" inputMode="numeric" value={logMinutes} onChange={(event) => setLogMinutes(event.target.value)} placeholder="00" aria-label="Worklog minutes" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400" />
                              <span className="ml-1 shrink-0 text-xs font-semibold text-ink-500">M</span>
                            </label>
                          </div>
                        </Field>
                        <Field label="Activity" className="mb-0">
                          <Select value={logActivity} onChange={(event) => setLogActivity(event.target.value)}>
                            <option value="">Select activity</option>
                            {timerActivityOptions.map((activity) => <option key={activity} value={activity}>{activity}</option>)}
                          </Select>
                        </Field>
                        <Field label="Billing" className="mb-0">
                          <Select value={logBillable ? "billable" : "non_billable"} onChange={(event) => setLogBillable(event.target.value === "billable")}>
                            <option value="non_billable">Non-billable</option>
                            <option value="billable">Billable</option>
                          </Select>
                        </Field>
                      </div>
                      <Field label="Description" className="mb-0 mt-2.5">
                        <Textarea value={logNote} onChange={(event) => setLogNote(event.target.value)} rows={2} placeholder="What did you work on?" />
                      </Field>
                      {logError && <p className="mt-2 text-xs text-danger-600">{logError}</p>}
                      <div className="mt-3 flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setShowLogForm(false); setLogError(null); }} disabled={logSaving}>Cancel</Button>
                        <Button size="sm" onClick={logTime} disabled={logSaving}>{logSaving ? "Saving…" : "Save log"}</Button>
                      </div>
                    </Card>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setShowLogForm(true)}><Plus size={14} className="mr-1.5" />Add time log</Button>
                  )
                )}
                {entries.length === 0 ? <p>No work logs recorded yet.</p> : entries.map((entry) => <Card key={entry.id} className="p-3"><div className="flex justify-between"><b>{entry.user.name}</b><span className="font-mono">{entry.endedAt ? formatSeconds(entry.durationSeconds) : "Running"}</span></div><p className="mt-1 text-xs text-ink-500">{entry.activityType} · {entry.billable ? "Billable" : "Non-billable"} · {new Date(entry.startedAt).toLocaleString()}</p>{entry.note && <p className="mt-2 text-xs">{entry.note}</p>}</Card>)}
              </div>
            )}
            {panel === "approval" && <div className="rounded-lg border border-dashed border-ink-200 p-6 text-center"><CheckCircle2 className="mx-auto text-ink-300" /><p className="mt-2">No approvals requested for this task.</p></div>}
            {panel === "planner" && <div className="space-y-3"><Summary label="Assignee" value={localTask.assignee?.name ?? "Unassigned"} /><Summary label="Estimate" value={formatMinutes(localTask.estimatedMinutes)} /><Summary label="Tracked" value={formatSeconds(liveSeconds)} /><Summary label="Due" value={formatDate(localTask.dueDate)} /><Summary label="Followers" value={localTask.followers.map((follower) => follower.user.name).join(", ") || "None"} /></div>}
          </div>
          <div className="border-t border-ink-200 p-3"><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} disabled={!canEdit} placeholder={canEdit ? "Please enter your comment..." : "You do not have permission to comment"} className="min-h-24 w-full rounded-lg border border-ink-200 p-3 text-sm outline-none focus:border-brand-500 disabled:bg-ink-50" /><div className="mt-2 flex items-center justify-between"><span className="text-xs text-ink-400">{commentText.length}/24000</span><Button size="sm" onClick={addComment} disabled={!canEdit || saving || !commentText.trim()}><Send size={14} className="mr-1.5" />Send</Button></div></div>
        </div>
      </div>
    </Drawer>
    <TimerStopDialog target={stopTarget} busy={timerBusy} onCancel={() => setStopTarget(null)} onSave={saveTimerLog} onDiscard={discardTimer} />
    <Modal
      open={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      title={`Delete task ${currentTask.code}?`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
          <Button variant="danger" onClick={deleteTask} disabled={deleting}>{deleting ? "Deleting…" : "Delete Task"}</Button>
        </>
      }
    >
      <p className="text-sm text-ink-600">
        This permanently deletes <strong>{currentTask.name}</strong>, its subtasks, comments, checklist items, attachments, and time entries. This cannot be undone.
      </p>
    </Modal>
    </>
  );
}

function TaskRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[155px_minmax(0,1fr)] items-start gap-4 px-4 py-3 text-sm"><dt className="flex items-center gap-2 pt-2 text-ink-500">{icon}{label}</dt><dd className="min-w-0">{children}</dd></div>;
}
function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-ink-500">{label}</p><p className="mt-1 font-semibold capitalize text-ink-900">{value}</p></div>;
}
const timerActivityOptions = ["Coding", "Meeting", "Learning", "Designing", "Bug fixing", "Testing", "Documentation", "Review", "Support", "Other"];

export function TimerStopDialog({
  target,
  busy,
  onCancel,
  onSave,
  onDiscard,
}: {
  target: StopTimerTarget | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: StopTimerInput) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [activityType, setActivityType] = useState("");
  const [note, setNote] = useState("");
  const [billable, setBillable] = useState(false);
  const [durationHours, setDurationHours] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [durationTouched, setDurationTouched] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    const liveSeconds = Math.max(60, Math.floor((Date.now() - new Date(target.entry.startedAt).getTime()) / 1000));
    const liveMinutes = Math.max(1, Math.ceil(liveSeconds / 60));
    setActivityType("");
    setNote("");
    setBillable(target.entry.billable);
    setDurationHours(liveMinutes >= 60 ? String(Math.floor(liveMinutes / 60)) : "");
    setDurationMinutes(String(liveMinutes % 60).padStart(2, "0"));
    setDurationTouched(false);
    setError(null);
    setNow(Date.now());
  }, [target?.entry.id]);

  useEffect(() => {
    if (!target) return;
    const interval = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (!durationTouched) {
        const liveMinutes = Math.max(1, Math.ceil(Math.max(0, Math.floor((nextNow - new Date(target.entry.startedAt).getTime()) / 1000)) / 60));
        setDurationHours(liveMinutes >= 60 ? String(Math.floor(liveMinutes / 60)) : "");
        setDurationMinutes(String(liveMinutes % 60).padStart(2, "0"));
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [target?.entry.id, durationTouched]);

  if (!target) return null;
  const seconds = Math.max(0, Math.floor((now - new Date(target.entry.startedAt).getTime()) / 1000));
  const taskName = target.task?.name ?? target.entry.task?.name ?? "Task";
  const projectName = target.entry.project?.name ?? "Project";
  const correctedHours = Math.max(0, Math.floor(Number(durationHours || 0)));
  const correctedMinutes = Math.max(0, Math.floor(Number(durationMinutes || 0)));
  const correctedSeconds = correctedHours * 3600 + correctedMinutes * 60;

  function useLiveDuration() {
    const liveMinutes = Math.max(1, Math.ceil(seconds / 60));
    setDurationHours(liveMinutes >= 60 ? String(Math.floor(liveMinutes / 60)) : "");
    setDurationMinutes(String(liveMinutes % 60).padStart(2, "0"));
    setDurationTouched(false);
  }

  async function save() {
    if (!activityType) { setError("Select an activity before saving the work log."); return; }
    if (!note.trim()) { setError("Description is required before the timer can stop."); return; }
    if (correctedSeconds <= 0) { setError("Correct duration must be greater than 0 minutes."); return; }
    if (correctedSeconds > seconds + 60) { setError("Correct duration cannot be greater than the running timer duration."); return; }
    setError(null);
    try {
      await onSave({ activityType, billable, note: note.trim(), durationSeconds: correctedSeconds });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The work log could not be saved");
    }
  }

  async function discard() {
    if (!window.confirm("Delete this running timer without adding its time to the task?")) return;
    setError(null);
    try {
      await onDiscard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The timer could not be deleted");
    }
  }

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-ink-900/35 p-4" onMouseDown={() => !busy && onCancel()}>
    <div className="w-full max-w-md overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex items-center gap-3 border-b border-ink-200 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-100 text-sm font-semibold text-ink-700">{target.task?.code ?? target.entry.task?.code ?? ""}</span>
        <div><p className="font-semibold text-ink-900">Stop timer & save work log</p><p className="text-xs text-ink-500">Started {new Date(target.entry.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div>
        <span className="ml-auto rounded-lg border border-danger-100 bg-danger-50 px-2.5 py-1 font-mono text-sm font-semibold text-danger-600">{formatSeconds(seconds)}</span>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100"><X size={16} /></button>
      </header>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3"><Summary label="Project Name" value={projectName} /><Summary label="Task Name" value={taskName} /></div>
        <Field label="Select activity" required><Select value={activityType} onChange={(event) => setActivityType(event.target.value)} disabled={busy}><option value="">Select activity</option>{timerActivityOptions.map((activity) => <option key={activity} value={activity}>{activity}</option>)}</Select></Field>
        <Field label="Correct work duration" required>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-10 min-w-[96px] flex-1 items-center rounded-lg border border-ink-200 bg-white px-3 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
              <input type="number" min="0" inputMode="numeric" value={durationHours} onChange={(event) => { setDurationTouched(true); setDurationHours(event.target.value); }} placeholder="00" disabled={busy} className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400" />
              <span className="ml-2 shrink-0 text-xs font-semibold text-ink-500">H</span>
            </label>
            <label className="flex h-10 min-w-[96px] flex-1 items-center rounded-lg border border-ink-200 bg-white px-3 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
              <input type="number" min="0" max="59" inputMode="numeric" value={durationMinutes} onChange={(event) => { setDurationTouched(true); setDurationMinutes(event.target.value); }} placeholder="00" disabled={busy} className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400" />
              <span className="ml-2 shrink-0 text-xs font-semibold text-ink-500">M</span>
            </label>
            <button type="button" onClick={useLiveDuration} disabled={busy} className="h-10 rounded-lg border border-ink-200 px-3 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50">Use live</button>
          </div>
          <p className="mt-1 text-[11px] text-ink-400">Live timer: {formatSeconds(seconds)}. Adjust this if the timer was left running after actual work ended.</p>
        </Field>
        <Field label="Description" required><textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 2000))} disabled={busy} placeholder="What did you work on?" className="min-h-28 w-full resize-none rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" /><p className="mt-1 text-right text-[11px] text-ink-400">{note.length}/2000</p></Field>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600"><input type="checkbox" checked={billable} onChange={(event) => setBillable(event.target.checked)} disabled={busy} className="h-4 w-4 rounded border-ink-300 text-brand-600" />Billable</label>
        {error && <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      </div>
      <footer className="flex items-center border-t border-ink-200 px-4 py-3">
        <button type="button" onClick={discard} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-medium text-danger-500 hover:text-danger-700 disabled:opacity-50"><Trash2 size={14} />Delete Timer</button>
        <div className="ml-auto flex gap-2"><Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy || !activityType || !note.trim()}>{busy ? "Saving..." : "Save work log"}</Button></div>
      </footer>
    </div>
  </div>;
}
