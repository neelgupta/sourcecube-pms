import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock3,
  HelpCircle,
  ListChecks,
  Plus,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge, Button, Card, DateRangePicker, EmployeeMultiPicker, FilterSelect, Input, MemberAvatar, Select } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePermission } from "@/lib/session";
import { projectWorkspacePath } from "@/features/projects/projectRoutes";
import type { ProjectPriority, ProjectSection, RealProject, ResourcePlannerDay, ResourcePlannerDayDetail, ResourcePlannerEmployee, ResourcePlannerResponse, WorkspaceTask } from "@/types/tenant";

const occupancyOptions = [
  { value: "all", label: "All Employees" },
  { value: "occupied", label: "Employees With Tasks" },
  { value: "unoccupied", label: "Employees Without Tasks" },
];

type RangePreset = "today" | "this_week" | "last_week" | "this_month" | "custom";

const presetOptions: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

function dateKey(date: Date) {
  const year = date.getFullYear(), month = String(date.getMonth() + 1).padStart(2, "0"), day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}
/** Monday-start week bounds for the week containing `date`. */
function weekBounds(date: Date) {
  const weekday = (date.getDay() + 6) % 7; // 0 = Monday
  const start = addDays(date, -weekday);
  return { start, end: addDays(start, 6) };
}
function presetRange(preset: RangePreset): { start: string; end: string } {
  const today = new Date();
  if (preset === "today") return { start: dateKey(today), end: dateKey(today) };
  if (preset === "this_week") { const { start, end } = weekBounds(today); return { start: dateKey(start), end: dateKey(end) }; }
  if (preset === "last_week") { const { start } = weekBounds(addDays(today, -7)); return { start: dateKey(start), end: dateKey(addDays(start, 6)) }; }
  if (preset === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: dateKey(start), end: dateKey(end) };
  }
  return { start: dateKey(today), end: dateKey(today) };
}
function hoursFromMinutes(minutes: number) {
  const value = minutes / 60;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function hoursFromSeconds(seconds: number) {
  const value = seconds / 3600;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function durationLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}
function displayDate(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

export function ResourcesPage() {
  const navigate = useNavigate();
  const canAssign = usePermission("tasks", "manage");
  const canEditAllocation = usePermission("resources", "edit");
  const [preset, setPreset] = useState<RangePreset>("this_week");
  const [customRange, setCustomRange] = useState<{ start: string; end: string }>(() => presetRange("this_week"));
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [occupancy, setOccupancy] = useState<"all" | "occupied" | "unoccupied">("all");
  const [teamId, setTeamId] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [dropdownCloseSignal, setDropdownCloseSignal] = useState(0);
  const filterButtonRef = useRef<HTMLSpanElement>(null);
  const scheduleButtonRef = useRef<HTMLSpanElement>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const schedulePopoverRef = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  const [planner, setPlanner] = useState<ResourcePlannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<{ employeeId: string; date: string } | null>(null);
  const [detail, setDetail] = useState<ResourcePlannerDayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [unestimatedCount, setUnestimatedCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const selectedPeriod = useMemo(
    () => (preset === "custom" ? customRange : presetRange(preset)),
    [preset, customRange],
  );

  function closeTopDropdowns() {
    setDropdownCloseSignal((value) => value + 1);
  }

  function closeResourcePopovers() {
    setShowFilters(false);
    setShowSchedule(false);
  }

  function openFilterPopover() {
    closeTopDropdowns();
    setShowSchedule(false);
    setShowFilters((value) => !value);
  }

  function openSchedulePopover() {
    closeTopDropdowns();
    setShowFilters(false);
    setShowSchedule((value) => !value);
  }

  function clearResourceFilters() {
    setTeamId("");
    setShowFilters(false);
    setRevision((value) => value + 1);
  }
  function choosePreset(value: RangePreset) {
    setPreset(value);
    if (value !== "custom") setCustomRange(presetRange(value));
  }

  useEffect(() => {
    if (!showFilters && !showSchedule) return;
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (filterButtonRef.current?.contains(target) || scheduleButtonRef.current?.contains(target)) return;
      if (filterPopoverRef.current?.contains(target) || schedulePopoverRef.current?.contains(target)) return;
      // Nested pickers (FilterSelect, EmployeePicker, etc.) render their dropdown panel via a
      // body portal, so it isn't a DOM descendant of filterPopoverRef even though it's visually
      // inside the "Resource filters" popover — without this check, clicking a team option here
      // closes the whole popover on mousedown before the option's own onClick can fire.
      if (target instanceof Element && target.closest("[data-portal-panel]")) return;
      closeResourcePopovers();
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showFilters, showSchedule]);
  useEffect(() => {
    if (!selectedPeriod.start || !selectedPeriod.end || selectedPeriod.start > selectedPeriod.end) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      api.getResourcePlanner({ ...selectedPeriod, occupancy, teamId: teamId || undefined, employeeIds: employeeIds.length ? employeeIds.join(",") : undefined })
        .then((result) => { if (!cancelled) { setPlanner(result); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load resource planner"); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [selectedPeriod.start, selectedPeriod.end, employeeIds, occupancy, teamId, revision]);

  useEffect(() => {
    if (!selectedDay) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    api.getResourcePlannerDay(selectedDay.employeeId, selectedDay.date)
      .then((result) => { if (!cancelled) setDetail(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load employee day details"); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDay?.employeeId, selectedDay?.date]);

  // Tasks with no estimate never become plannable (the planner requires remainingMinutes > 0),
  // and previously just vanished from here with no explanation. This surfaces a proactive nudge
  // instead of leaving the user to notice the gap on their own. Scoped by the same task
  // visibility rules as "My Tasks" (see GET /projects/tasks/assigned).
  useEffect(() => {
    let cancelled = false;
    api.listAssignedTasks({ estimated: "unestimated" })
      .then(({ tasks }) => { if (!cancelled) setUnestimatedCount(tasks.length); })
      .catch(() => { if (!cancelled) setUnestimatedCount(0); });
    return () => { cancelled = true; };
  }, [revision]);

  function handleTaskAssigned() {
    if (!selectedDay) return;
    api.getResourcePlannerDay(selectedDay.employeeId, selectedDay.date).then(setDetail);
    setRevision((value) => value + 1);
  }

  function handleAllocationsSaved(nextDetail: ResourcePlannerDayDetail) {
    setDetail(nextDetail);
    setRevision((value) => value + 1);
  }

  async function openResourceTask(projectId: string, taskId: string) {
    try {
      const result = await api.getProject(projectId);
      navigate(`${projectWorkspacePath(result.project)}?task=${taskId}`);
    } catch {
      navigate(`/projects/${projectId}?task=${taskId}`);
    }
  }

  const employees = planner?.employees ?? [];
  const days = planner?.days ?? [];
  return (
    <div className="relative flex h-full min-w-0 flex-col bg-surface-subtle">
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink-700"><span className="text-lg font-bold text-ink-900">{employees.length}</span> Employees</p>
          <button className="text-ink-400 hover:text-ink-700" title="Tracked hours come from task work logs. Planned hours come from assigned task estimates across their working dates."><HelpCircle size={16} /></button>
          <div className="ml-2 flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-ink-200 bg-white p-0.5">
              {presetOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => choosePreset(option.value)}
                  className={cn(
                    "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    preset === option.value ? "bg-brand-600 text-white" : "text-ink-500 hover:bg-ink-100",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {preset === "custom" ? (
              <DateRangePicker
                from={customRange.start}
                to={customRange.end}
                onChange={(next) => setCustomRange((current) => ({ start: next.from ?? current.start, end: next.to ?? current.end }))}
                className="w-64"
              />
            ) : (
              <span className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-700"><CalendarDays size={15} className="text-ink-400" />{displayDate(selectedPeriod.start)} – {displayDate(selectedPeriod.end)}</span>
            )}
            <IconBtn title="Refresh" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></IconBtn>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div onMouseDown={closeResourcePopovers}>
            <EmployeeMultiPicker
              employees={planner?.filterOptions.employees ?? []}
              value={employeeIds}
              onChange={(next) => { setEmployeeIds(next); closeResourcePopovers(); }}
              placeholder="All employees"
              className="w-56"
              closeSignal={dropdownCloseSignal}
            />
          </div>
          <div onMouseDown={closeResourcePopovers}>
            <FilterSelect
              value={occupancy}
              options={occupancyOptions}
              onChange={(value) => { setOccupancy(value as typeof occupancy); closeResourcePopovers(); }}
              className="w-52"
              closeSignal={dropdownCloseSignal}
            />
          </div>
          <span ref={filterButtonRef}>
            <Button variant={teamId ? "secondary" : "outline"} size="sm" leftIcon={<SlidersHorizontal size={14} />} onClick={openFilterPopover}>Filter{teamId ? " (1)" : ""}</Button>
          </span>
          <span ref={scheduleButtonRef}>
            <Button variant="outline" size="icon" title="Company working hours" onClick={openSchedulePopover}><Settings size={16} /></Button>
          </span>
          <Button size="icon" title="Assign work from Projects" onClick={() => navigate("/projects")}><Plus size={18} /></Button>
        </div>
        {showFilters && <div ref={filterPopoverRef} className="absolute right-20 top-full z-40 mt-2 w-72 rounded-xl border border-ink-200 bg-white p-4 shadow-popover">
          <div className="flex items-center justify-between"><p className="font-semibold text-ink-900">Resource filters</p><button onClick={() => setShowFilters(false)}><X size={15} className="text-ink-400" /></button></div>
          <label className="mb-1 mt-3 block text-xs font-medium text-ink-600">Team</label>
          <FilterSelect value={teamId} onChange={setTeamId} options={[{ value: "", label: "All teams" }, ...(planner?.filterOptions.teams ?? []).map((team) => ({ value: team.id, label: team.name }))]} />
          <div className="mt-3 flex justify-end gap-2"><Button variant="outline" size="sm" onClick={clearResourceFilters}>Clear</Button><Button size="sm" onClick={() => setShowFilters(false)}>Apply</Button></div>
        </div>}
        {showSchedule && planner && <div ref={schedulePopoverRef} className="absolute right-12 top-full z-40 mt-2 w-80 rounded-xl border border-ink-200 bg-white p-4 shadow-popover">
          <div className="flex items-center justify-between"><p className="font-semibold text-ink-900">Company working hours</p><button onClick={() => setShowSchedule(false)}><X size={15} className="text-ink-400" /></button></div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Summary label="Schedule" value={planner.schedule.name} /><Summary label="Hours" value={`${planner.schedule.startTime} – ${planner.schedule.endTime}`} /><Summary label="Break" value={`${planner.schedule.breakMinutes} minutes`} /><Summary label="Daily capacity" value={`${hoursFromMinutes(planner.schedule.dailyMinutes)} hours`} /></div>
          <p className="mt-3 text-xs text-ink-500">Capacity is applied only on configured working days. Non-optional holidays have zero capacity.</p>
        </div>}
      </div>

      {error && <div className="m-4 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
      {!bannerDismissed && unestimatedCount > 0 && (
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800 lg:mx-6">
          <HelpCircle size={16} className="shrink-0 text-warning-600" />
          <span className="flex-1">
            You have <strong>{unestimatedCount}</strong> task{unestimatedCount === 1 ? "" : "s"} with no time estimate — {unestimatedCount === 1 ? "it" : "they"} won't appear in this planner until an estimate is set.
          </span>
          <button onClick={() => navigate("/tasks?estimated=unestimated")} className="shrink-0 font-semibold text-warning-700 hover:underline">View them</button>
          <button onClick={() => setBannerDismissed(true)} title="Dismiss" className="shrink-0 text-warning-500 hover:text-warning-700"><X size={14} /></button>
        </div>
      )}
      <div className="min-h-0 flex-1 p-4 lg:p-6">
        <Card className="h-full overflow-hidden">
          <div className="h-full overflow-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <colgroup>
                <col className="w-[300px] min-w-[300px]" />
                <col className="w-32 min-w-32" />
                <col className="w-48 min-w-48" />
                {days.map((day) => <col key={day.date} className="w-28 min-w-28" />)}
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-ink-200 bg-surface-subtle">
                  <th className="sticky left-0 z-40 w-[300px] min-w-[300px] max-w-[300px] border-r border-ink-200 bg-surface-subtle px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 shadow-[4px_0_8px_-8px_rgba(15,23,42,0.35)]">Employee Name</th>
                  <th className="min-w-32 border-r border-ink-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Employee ID</th>
                  <th className="min-w-48 border-r border-ink-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Projects / Tasks</th>
                  {days.map((day) => <th key={day.date} className={cn("min-w-28 border-r border-ink-200 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide", !day.isWorkingDay ? "bg-info-50 text-info-600" : "text-ink-500")}>{day.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => <ResourceRow key={employee.id} employee={employee} days={days} onSelectDay={(date) => setSelectedDay({ employeeId: employee.id, date })} />)}
                {!loading && employees.length === 0 && <tr><td colSpan={3 + days.length} className="px-4 py-16 text-center text-sm text-ink-500">No employees match the selected server filters</td></tr>}
                {loading && !planner && <tr><td colSpan={3 + Math.max(1, days.length)} className="px-4 py-16 text-center text-sm text-ink-500">Loading real employee capacity and work logs…</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {selectedDay && (
        <DayDetailPanel
          detail={detail}
          loading={detailLoading}
          canAssign={canAssign}
          canEditAllocation={canEditAllocation}
          employeeId={selectedDay.employeeId}
          date={selectedDay.date}
          workingDays={planner?.schedule.workingDays ?? [1, 2, 3, 4, 5]}
          onClose={() => setSelectedDay(null)}
          onOpenTask={(projectId, taskId) => openResourceTask(projectId, taskId)}
          onTaskAssigned={handleTaskAssigned}
          onAllocationsSaved={handleAllocationsSaved}
        />
      )}
    </div>
  );
}

function ResourceRow({ employee, days, onSelectDay }: { employee: ResourcePlannerEmployee; days: ResourcePlannerDay[]; onSelectDay: (date: string) => void }) {
  return <tr className="group border-b border-ink-100 transition-colors hover:bg-brand-50/30">
    <td className="sticky left-0 z-30 w-[300px] min-w-[300px] max-w-[300px] overflow-hidden border-r border-ink-200 bg-white px-4 py-3 shadow-[4px_0_8px_-8px_rgba(15,23,42,0.35)] group-hover:bg-brand-50">
      <div className="flex w-full min-w-0 items-center gap-3 overflow-hidden"><MemberAvatar id={employee.id} name={employee.name} size="sm" status="active" className="shrink-0 ring-0" /><div className="min-w-0 flex-1 overflow-hidden"><p className="truncate font-medium text-ink-900">{employee.name}</p><p className="truncate text-[11px] text-ink-400">{employee.email}</p></div><span className={cn("ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", employee.utilisationPercent === 0 ? "bg-ink-100 text-ink-500" : employee.utilisationPercent > 100 ? "bg-danger-50 text-danger-600" : "bg-success-50 text-success-600")}>{employee.utilisationPercent}%</span></div>
    </td>
    <td className="border-r border-ink-200 px-4 py-3 text-xs font-medium text-ink-500">{employee.employeeCode}</td>
    <td className="border-r border-ink-200 px-4 py-3 text-xs text-ink-700"><div className="flex items-center gap-1.5"><Briefcase size={13} className="text-brand-500" />Projects: <b>{employee.projectsCount}</b></div><div className="mt-1 flex items-center gap-1.5"><ListChecks size={13} className={employee.hasTasks ? "text-success-500" : "text-ink-400"} />Tasks: <b>{employee.incompleteTaskCount}</b> active / {employee.taskCount}</div><Badge className="mt-1.5" tone={employee.hasTasks ? "green" : "neutral"}>{employee.hasTasks ? "Has assigned tasks" : "No assigned tasks"}</Badge></td>
    {days.map((day, index) => {
      const value = employee.days[index];
      if (!day.isWorkingDay) return <td key={day.date} className="border-r border-ink-200 bg-info-50 p-0 text-center"><button onClick={() => onSelectDay(day.date)} className="h-full min-h-16 w-full px-3 py-3 text-xs font-semibold text-info-600" title={day.holidayName ?? "Non-working day"}>{day.holidayName ? "HOL" : "WK"}</button></td>;
      const capacityHours = day.capacityMinutes / 60, trackedHours = value.trackedSeconds / 3600, load = capacityHours ? trackedHours / capacityHours : 0;
      return <td key={day.date} className="border-r border-ink-200 p-0 text-center"><button onClick={() => onSelectDay(day.date)} className="min-h-16 w-full px-3 py-2 hover:bg-brand-50" title={`${employee.name}: ${hoursFromSeconds(value.trackedSeconds)}h tracked, ${hoursFromMinutes(value.plannedMinutes)}h planned, ${value.taskCount} tasks`}><span className={cn("text-xs font-medium", load > 1 ? "text-danger-600" : value.trackedSeconds ? "text-ink-900" : "text-ink-400")}>{hoursFromSeconds(value.trackedSeconds)} / {hoursFromMinutes(day.capacityMinutes)}</span><div className="mx-auto mt-1.5 h-1 w-14 overflow-hidden rounded-full bg-ink-100"><div className={cn("h-full rounded-full", load > 1 ? "bg-danger-500" : load > .85 ? "bg-warning-500" : "bg-success-500")} style={{ width: `${Math.min(100, load * 100)}%` }} /></div><div className="mt-1 flex items-center justify-center gap-2 text-[10px] text-ink-400"><span>{hoursFromMinutes(value.plannedMinutes)}h planned</span>{value.taskCount > 0 && <span className="font-semibold text-brand-600">{value.completedTaskCount}/{value.taskCount} tasks</span>}</div></button></td>;
    })}
  </tr>;
}

function DayDetailPanel({
  detail,
  loading,
  canAssign,
  canEditAllocation,
  employeeId,
  date,
  workingDays,
  onClose,
  onOpenTask,
  onTaskAssigned,
  onAllocationsSaved,
}: {
  detail: ResourcePlannerDayDetail | null;
  loading: boolean;
  canAssign: boolean;
  canEditAllocation: boolean;
  employeeId: string;
  date: string;
  workingDays: number[];
  onClose: () => void;
  onOpenTask: (projectId: string, taskId: string) => void;
  onTaskAssigned: () => void;
  onAllocationsSaved: (detail: ResourcePlannerDayDetail) => void;
}) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/25" onMouseDown={onClose}><aside className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
    <header className="flex items-center justify-between border-b border-ink-200 px-5 py-4"><div><p className="font-semibold text-ink-900">{detail?.employee.name ?? "Employee day details"}</p><p className="text-xs text-ink-500">{detail ? displayDate(detail.date) : "Loading…"}</p></div><button onClick={onClose} className="rounded-lg p-2 text-ink-400 hover:bg-ink-100"><X size={18} /></button></header>
    {loading || !detail ? <div className="flex flex-1 items-center justify-center text-sm text-ink-500">Loading task progress and work logs…</div> : <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {detail.holiday && <div className="mb-4 rounded-lg bg-info-50 px-3 py-2 text-sm text-info-700">{detail.holiday.name}{detail.holiday.optional ? " (optional holiday)" : ""}</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric label="Company capacity" value={`${hoursFromMinutes(detail.capacityMinutes)}h`} /><Metric label="Planned hours" value={`${hoursFromMinutes(detail.plannedMinutes)}h`} /><Metric label="Tracked hours" value={durationLabel(detail.trackedSeconds)} /><Metric label="Planned tracked" value={durationLabel(detail.plannedTrackedSeconds)} /><Metric label="Extra / overrun" value={durationLabel(detail.extraPlannedSeconds)} danger={detail.extraPlannedSeconds > 0} /><Metric label="Remaining plan" value={`${hoursFromMinutes(detail.remainingPlannedMinutes)}h`} /></div>
      {canAssign && <AssignTaskSection employeeId={employeeId} date={date} onAssigned={onTaskAssigned} />}
      <AllocationEditor detail={detail} employeeId={employeeId} date={date} workingDays={workingDays} canEdit={canEditAllocation} onOpenTask={onOpenTask} onSaved={onAllocationsSaved} />
      <section className="mt-6"><div className="mb-2 flex items-center gap-2"><Clock3 size={16} className="text-brand-600" /><h3 className="font-semibold text-ink-900">Work logs ({detail.logs.length})</h3></div>{detail.logs.length ? <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">{detail.logs.map((log) => <div key={log.id} className="p-3"><div className="flex items-center gap-2"><CheckCircle2 size={14} className="text-success-500" /><p className="text-sm font-medium text-ink-900">{log.activityType}</p><span className="ml-auto font-mono text-xs text-ink-700">{durationLabel(log.effectiveDurationSeconds)}</span></div><p className="mt-1 text-xs text-ink-500">#{log.task.code} {log.task.name} · {log.project.name}</p><p className="mt-1 text-[11px] text-ink-400">{new Date(log.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – {log.endedAt ? new Date(log.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Running"} · {log.billable ? "Billable" : "Non-billable"}</p>{log.note && <p className="mt-1 text-xs text-ink-600">{log.note}</p>}</div>)}</div> : <p className="rounded-lg border border-dashed border-ink-200 p-4 text-sm text-ink-500">No tracked work was recorded on this date.</p>}</section>
    </div>}
  </aside></div>;
}

/** Editable replacement for the old read-only "planned today" list — lets whoever owns this
 *  day's plan (the employee themselves, or a manager/lead/PM within their existing resource
 *  scope) type an explicit number of hours per task instead of accepting the system's uniform
 *  estimate/span split. Inputs are local until Save; a live running total (computed client-side,
 *  no round trip) shows how the edits compare to the day's capacity before committing. */
/** Working-day count between `from` (inclusive) and `to` (inclusive), both YYYY-MM-DD, per the
 *  company's configured workingDays (0=Sun..6=Sat) — mirrors keysBetween/workingDays filtering in
 *  server/src/routes/resources.ts, kept client-side here since this only ever feeds a draft
 *  suggestion, never a persisted value. */
function workingDaysBetween(from: string, to: string, workingDays: number[]): string[] {
  if (from > to) return [];
  const days: string[] = [];
  let cursor = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  for (let i = 0; i < 740 && cursor <= end; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    if (workingDays.includes(cursor.getUTCDay())) days.push(key);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

function AllocationEditor({
  detail,
  employeeId,
  date,
  workingDays,
  canEdit,
  onOpenTask,
  onSaved,
}: {
  detail: ResourcePlannerDayDetail;
  employeeId: string;
  date: string;
  workingDays: number[];
  canEdit: boolean;
  onOpenTask: (projectId: string, taskId: string) => void;
  onSaved: (detail: ResourcePlannerDayDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingDone, setMarkingDone] = useState<string | null>(null);

  async function markDone(task: ResourcePlannerDayDetail["tasks"][number]) {
    setMarkingDone(task.id);
    setError(null);
    try {
      await api.updateProjectTask(task.project.id, task.id, { status: "done" });
      const next = await api.getResourcePlannerDay(employeeId, date);
      onSaved(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark task done");
    } finally {
      setMarkingDone(null);
    }
  }

  // Only tasks actually assigned to this employee can be planned/saved on their day — a
  // collaborator task (someone logged time or has an allocation on this employee's day for a
  // task assigned to someone else, see resources.ts's loggedOrAllocatedTaskIds) is shown
  // read-only. Submitting it in the PUT allocations payload gets the whole save rejected by the
  // backend's ownership check, silently failing the entire day's plan — see isOwnTask.
  function startEditing() {
    setHours(Object.fromEntries(detail.tasks.filter((task) => task.status !== "done" && task.isOwnTask && !task.isLocked).map((task) => [task.id, hoursFromMinutes(task.plannedMinutes)])));
    setSuggested({});
    setError(null);
    setEditing(true);
  }

  /** Pre-fills the draft `hours` state (never persisted until "Save plan" is clicked) with a
   *  candidate split of each editable task's remaining estimate across its remaining working
   *  days up to its due date. A task without a due date is skipped — there's no span to spread
   *  across, so guessing one would just be the old auto-split bug under a new name. Only ever
   *  touches fields the user hasn't already hand-edited (won't clobber a manual edit if clicked
   *  again), and any field it does touch is flagged "(suggested)" until the user edits it. */
  function suggestHours() {
    const editable = detail.tasks.filter((task) => task.status !== "done" && task.isOwnTask && !task.isLocked);
    const nextHours = { ...hours };
    const nextSuggested = { ...suggested };
    for (const task of editable) {
      if (suggested[task.id] === false) continue; // user already hand-edited this field — leave it alone
      if (!task.dueDate) continue;
      const dueKey = task.dueDate.slice(0, 10);
      if (dueKey < date) continue; // already overdue — no forward span to suggest across
      const span = workingDaysBetween(date, dueKey, workingDays);
      if (!span.length) continue;
      const suggestedMinutes = Math.round(task.remainingMinutes / span.length);
      if (suggestedMinutes <= 0) continue;
      nextHours[task.id] = hoursFromMinutes(suggestedMinutes);
      nextSuggested[task.id] = true;
    }
    setHours(nextHours);
    setSuggested(nextSuggested);
  }

  // Locked tasks (same-day-urgent / carried-forward) aren't part of the editable `hours` draft,
  // but their hours are real and already committed — the running total while editing must
  // include them too, or the capacity meter understates the day (e.g. showing "0h / 8.5h" while
  // 7h of locked work is already sitting on the day), which both misleads the user about
  // remaining room and could let them plan the day well past its actual capacity without warning.
  const lockedMinutes = detail.tasks.filter((task) => task.status !== "done" && task.isOwnTask && task.isLocked).reduce((total, task) => total + task.plannedMinutes, 0);
  const runningTotalMinutes = editing
    ? lockedMinutes + detail.tasks.filter((task) => task.status !== "done" && task.isOwnTask && !task.isLocked).reduce((total, task) => total + Math.round((Number(hours[task.id]) || 0) * 60), 0)
    : detail.plannedMinutes;
  const load = detail.capacityMinutes ? runningTotalMinutes / detail.capacityMinutes : 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const allocations = detail.tasks.filter((task) => task.status !== "done" && task.isOwnTask && !task.isLocked).map((task) => ({ taskId: task.id, plannedMinutes: Math.round((Number(hours[task.id]) || 0) * 60) }));
      const next = await api.saveResourcePlannerDayAllocations(employeeId, date, allocations);
      onSaved(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save today's plan");
    } finally {
      setSaving(false);
    }
  }

  // Once the day's planned total reaches (or exceeds) the working-day capacity, the day is
  // considered fully planned and locked from further editing — for everyone, including TL/PM/
  // admin, not just the employee. Re-plannable again only if planned minutes drop back below
  // capacity (e.g. after a task is marked done and its allocation cleared). This must be judged
  // purely against real capacity — locked (same-day-urgent / carried-forward) tasks count toward
  // the total exactly like any other planned hours, no differently, so a day isn't reported
  // "fully planned" a moment early or late relative to its actual capacityMinutes.
  const isFullyPlanned = detail.capacityMinutes > 0 && detail.plannedMinutes >= detail.capacityMinutes;

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2"><ListChecks size={16} className="text-brand-600" /><h3 className="font-semibold text-ink-900">Assigned task progress ({detail.tasks.length})</h3></div>
        {canEdit && detail.tasks.some((task) => task.status !== "done" && task.isOwnTask && !task.isLocked) && !editing && (
          isFullyPlanned
            ? <span className="text-xs font-medium text-ink-400" title="This day is already fully planned">Day fully planned</span>
            : <button onClick={startEditing} className="text-xs font-semibold text-brand-600 hover:text-brand-700">Edit today's plan</button>
        )}
      </div>
      {editing && (
        <div className={cn("mb-3 flex items-center justify-between rounded-lg border px-3 py-2 text-sm", load > 1 ? "border-danger-200 bg-danger-50 text-danger-700" : load > 0.85 ? "border-warning-200 bg-warning-50 text-warning-700" : "border-success-200 bg-success-50 text-success-700")}>
          <span className="font-semibold">{hoursFromMinutes(runningTotalMinutes)}h / {hoursFromMinutes(detail.capacityMinutes)}h planned</span>
          <div className="flex items-center gap-3">
            <button onClick={suggestHours} title="Fills a draft split of each task's remaining hours across its working days up to its due date — nothing is saved until you click Save plan" className="text-xs font-semibold underline decoration-dotted hover:no-underline">Suggest hours</button>
            <span className="text-xs">{load > 1 ? "Over capacity" : "Looks good"}</span>
          </div>
        </div>
      )}
      {detail.tasks.length ? (
        <div className="space-y-2">
          {detail.tasks.map((task) => (
            <div key={task.id} className={cn("rounded-lg border p-3", editing ? "border-ink-200" : "border-ink-200 hover:border-brand-300 hover:bg-brand-50/30")}>
              <button onClick={() => onOpenTask(task.project.id, task.id)} className="flex w-full items-start gap-2 text-left">
                <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px]">#{task.code}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{task.name}</p>
                  <p className="text-xs text-ink-500">{task.project.key} · {task.project.name}</p>
                </div>
                <Badge tone={task.status === "done" ? "green" : task.status === "in_progress" ? "amber" : "blue"}>{task.progress}%</Badge>
              </button>
              {editing && task.status !== "done" && task.isOwnTask && !task.isLocked ? (
                <div className="mt-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="number" min="0" step="0.25" value={hours[task.id] ?? "0"}
                    onChange={(event) => { setHours((current) => ({ ...current, [task.id]: event.target.value })); setSuggested((current) => ({ ...current, [task.id]: false })); }}
                    className="h-8 w-24 rounded-md border border-ink-200 px-2 text-sm outline-none focus:border-brand-500"
                  />
                  <span className="text-xs text-ink-500">hours planned today</span>
                  {suggested[task.id] && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700" title="Draft suggestion — not saved yet">(suggested)</span>}
                  {!task.dueDate && <span className="text-[11px] text-ink-400">Set a due date to get a suggestion</span>}
                  <span className="ml-auto text-[11px] text-ink-400">{hoursFromMinutes(task.remainingMinutes)}h remaining · {hoursFromMinutes(task.estimatedMinutes)}h total estimate</span>
                </div>
              ) : task.status === "done" ? (
                <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-500">
                  <span className={cn("font-semibold", task.trackedSeconds > task.estimatedMinutes * 60 ? "text-danger-600" : "text-success-700")}>
                    Task done
                    {task.trackedSeconds < task.estimatedMinutes * 60 && " — finished earlier than estimated"}
                    {task.trackedSeconds > task.estimatedMinutes * 60 && ` — took ${durationLabel(task.trackedSeconds - task.estimatedMinutes * 60)} extra to complete`}
                  </span>
                  <span>{hoursFromMinutes(task.estimatedMinutes)}h estimated</span>
                  <span>{durationLabel(task.trackedSeconds)} total tracked</span>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-500">
                  <span>
                    {hoursFromMinutes(task.plannedMinutes)}h planned today
                    {task.isLocked
                      ? <span className="ml-1 font-semibold text-warning-600" title="This task must be finished by its due date — its hours are fixed and can't be edited here">(locked)</span>
                      : task.hasExplicitAllocation && <span className="ml-1 font-semibold text-brand-600">(set)</span>}
                  </span>
                  {task.plannedMinutes > 0 && task.todayTrackedSeconds === 0 ? (
                    <span className="font-medium text-ink-400">Not worked on today</span>
                  ) : (
                    <span className={cn("font-medium", task.extraTrackedSeconds > 0 ? "text-warning-600" : "text-ink-700")}>
                      {durationLabel(task.todayTrackedSeconds)} worked today
                      {task.extraTrackedSeconds > 0 && <span className="ml-1">(+{durationLabel(task.extraTrackedSeconds)} extra)</span>}
                    </span>
                  )}
                  <span className="font-semibold text-ink-700">{hoursFromMinutes(task.remainingMinutes)}h remaining</span>
                  <span>{hoursFromMinutes(task.estimatedMinutes)}h total estimate</span>
                  <span>{durationLabel(task.trackedSeconds)} total tracked</span>
                  {task.isOwnTask && (
                    <button
                      onClick={(event) => { event.stopPropagation(); markDone(task); }}
                      disabled={markingDone === task.id}
                      className="ml-auto rounded-md border border-ink-200 px-2 py-1 text-[11px] font-semibold text-ink-600 hover:border-success-300 hover:text-success-700 disabled:opacity-50"
                    >
                      {markingDone === task.id ? "Marking done…" : "Mark done"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : <p className="rounded-lg border border-dashed border-ink-200 p-4 text-sm text-ink-500">No task was scheduled or logged on this date.</p>}
      {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}
      {editing && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save plan"}</Button>
        </div>
      )}
    </section>
  );
}

function AssignTaskSection({ employeeId, date, onAssigned }: { employeeId: string; date: string; onAssigned: () => void }) {
  const [projects, setProjects] = useState<RealProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sections, setSections] = useState<ProjectSection[]>([]);
  const [unassignedTasks, setUnassignedTasks] = useState<WorkspaceTask[]>([]);
  const [taskId, setTaskId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<ProjectPriority>("medium");

  useEffect(() => {
    api.listProjects().then(({ projects: rows }) => setProjects(rows.filter((project) => !project.isArchived))).finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => {
    setTaskId("");
    setCreating(false);
    setNewTaskName("");
    if (!projectId) { setUnassignedTasks([]); setSections([]); return; }
    setLoadingTasks(true);
    Promise.all([
      api.filterProjectTasks(projectId, { assigneeId: "unassigned", incomplete: true }),
      api.getProjectWorkspace(projectId),
    ])
      .then(([taskRes, workspace]) => { setUnassignedTasks(taskRes.tasks); setSections(workspace.sections); })
      .finally(() => setLoadingTasks(false));
  }, [projectId]);

  async function assign() {
    if (!projectId || !taskId) return;
    setAssigning(true);
    setError(null);
    try {
      await api.updateProjectTask(projectId, taskId, { assigneeId: employeeId, dueDate: date });
      setUnassignedTasks((current) => current.filter((task) => task.id !== taskId));
      setTaskId("");
      onAssigned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Task could not be assigned");
    } finally {
      setAssigning(false);
    }
  }

  async function createAndAssign() {
    if (!projectId || !newTaskName.trim() || !sections[0]) return;
    setAssigning(true);
    setError(null);
    try {
      await api.createProjectTask(projectId, {
        name: newTaskName.trim(),
        sectionId: sections[0].id,
        assigneeId: employeeId,
        startDate: date,
        dueDate: date,
        priority: newTaskPriority,
      });
      setNewTaskName("");
      setNewTaskPriority("medium");
      setCreating(false);
      onAssigned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Task could not be created");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-ink-200 bg-surface-subtle p-4">
      <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-900"><Plus size={15} className="text-brand-600" />Assign a task for this day</h3>
      <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={loadingProjects}>
        <option value="">{loadingProjects ? "Loading projects…" : "Select project"}</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </Select>

      {projectId && !creating && (
        <>
          <div className="mt-2.5 flex gap-2">
            <Select value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={loadingTasks} className="flex-1">
              <option value="">{loadingTasks ? "Loading tasks…" : unassignedTasks.length === 0 ? "No unassigned tasks" : "Select an existing task"}</option>
              {unassignedTasks.map((task) => <option key={task.id} value={task.id}>#{task.code} {task.name}</option>)}
            </Select>
            <Button size="sm" onClick={assign} disabled={!taskId || assigning}>{assigning ? "Assigning…" : "Assign"}</Button>
          </div>
          {!loadingTasks && (
            <button onClick={() => setCreating(true)} className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700">
              <Plus size={13} />{unassignedTasks.length === 0 ? "No matching task — create a new one" : "Or create a new task instead"}
            </button>
          )}
        </>
      )}

      {projectId && creating && (
        <div className="mt-2.5 rounded-lg border border-brand-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium text-ink-500">New task — just the essentials, details can be filled in later</p>
          <div className="flex gap-2">
            <Input value={newTaskName} onChange={(event) => setNewTaskName(event.target.value)} placeholder="What needs to be done?" autoFocus className="flex-1" />
            <Select value={newTaskPriority} onChange={(event) => setNewTaskPriority(event.target.value as ProjectPriority)} className="w-32">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => { setCreating(false); setNewTaskName(""); }} disabled={assigning}>Cancel</Button>
            <Button size="sm" onClick={createAndAssign} disabled={!newTaskName.trim() || assigning}>{assigning ? "Creating…" : "Create & assign"}</Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}
    </section>
  );
}
function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { return <div className={cn("rounded-lg border p-3", danger ? "border-danger-200 bg-danger-50" : "border-ink-200 bg-surface-subtle")}><p className="text-[11px] text-ink-500">{label}</p><p className={cn("mt-1 font-semibold", danger ? "text-danger-600" : "text-ink-900")}>{value}</p></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] text-ink-400">{label}</p><p className="font-medium text-ink-800">{value}</p></div>; }
function IconBtn({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) { return <button title={title} onClick={onClick} className="rounded-lg border border-ink-200 bg-white p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900">{children}</button>; }