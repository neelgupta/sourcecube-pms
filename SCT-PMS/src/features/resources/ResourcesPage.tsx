import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HelpCircle,
  ListChecks,
  Plus,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge, Button, Card, FilterSelect, MemberAvatar, SearchBar } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ResourcePlannerDay, ResourcePlannerDayDetail, ResourcePlannerEmployee, ResourcePlannerResponse } from "@/types/tenant";

const rangeOptions = [
  { value: "1w", label: "1 Week" },
  { value: "1m", label: "1 Month" },
  { value: "3m", label: "3 Months" },
];
const occupancyOptions = [
  { value: "all", label: "All Employees" },
  { value: "occupied", label: "Employees With Tasks" },
  { value: "unoccupied", label: "Employees Without Tasks" },
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
function period(anchor: Date, range: string) {
  if (range === "1w") return { start: dateKey(anchor), end: dateKey(addDays(anchor, 6)) };
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const months = range === "3m" ? 3 : 1;
  const end = new Date(start.getFullYear(), start.getMonth() + months, 0);
  return { start: dateKey(start), end: dateKey(end) };
}
function movePeriod(anchor: Date, range: string, direction: number) {
  if (range === "1w") return addDays(anchor, 7 * direction);
  const months = range === "3m" ? 3 : 1;
  return new Date(anchor.getFullYear(), anchor.getMonth() + months * direction, 1);
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
  const [anchor, setAnchor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [search, setSearch] = useState("");
  const [range, setRange] = useState("1m");
  const [occupancy, setOccupancy] = useState<"all" | "occupied" | "unoccupied">("all");
  const [teamId, setTeamId] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [revision, setRevision] = useState(0);
  const [planner, setPlanner] = useState<ResourcePlannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<{ employeeId: string; date: string } | null>(null);
  const [detail, setDetail] = useState<ResourcePlannerDayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const selectedPeriod = useMemo(() => period(anchor, range), [anchor, range]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      api.getResourcePlanner({ ...selectedPeriod, search: search.trim() || undefined, occupancy, teamId: teamId || undefined })
        .then((result) => { if (!cancelled) { setPlanner(result); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load resource planner"); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [selectedPeriod.start, selectedPeriod.end, search, occupancy, teamId, revision]);

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

  const employees = planner?.employees ?? [];
  const days = planner?.days ?? [];
  return (
    <div className="relative flex h-full min-w-0 flex-col bg-surface-subtle">
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink-700"><span className="text-lg font-bold text-ink-900">{employees.length}</span> Employees</p>
          <button className="text-ink-400 hover:text-ink-700" title="Tracked hours come from task work logs. Planned hours come from assigned task estimates across their working dates."><HelpCircle size={16} /></button>
          <div className="ml-2 flex items-center gap-1">
            <IconBtn title="Previous period" onClick={() => setAnchor((value) => movePeriod(value, range, -1))}><ChevronLeft size={16} /></IconBtn>
            <span className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-700"><CalendarDays size={15} className="text-ink-400" />{displayDate(selectedPeriod.start)} – {displayDate(selectedPeriod.end)}</span>
            <IconBtn title="Next period" onClick={() => setAnchor((value) => movePeriod(value, range, 1))}><ChevronRight size={16} /></IconBtn>
            <IconBtn title="Refresh" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></IconBtn>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search employees" className="w-44" />
          <FilterSelect value={range} options={rangeOptions} onChange={(value) => setRange(value)} className="w-36" />
          <FilterSelect value={occupancy} options={occupancyOptions} onChange={(value) => setOccupancy(value as typeof occupancy)} className="w-52" />
          <Button variant={teamId ? "secondary" : "outline"} size="sm" leftIcon={<SlidersHorizontal size={14} />} onClick={() => setShowFilters((value) => !value)}>Filter{teamId ? " (1)" : ""}</Button>
          <Button variant="outline" size="icon" title="Company working hours" onClick={() => setShowSchedule((value) => !value)}><Settings size={16} /></Button>
          <Button size="icon" title="Assign work from Projects" onClick={() => navigate("/projects")}><Plus size={18} /></Button>
        </div>
        {showFilters && <div className="absolute right-20 top-full z-40 mt-2 w-72 rounded-xl border border-ink-200 bg-white p-4 shadow-popover">
          <div className="flex items-center justify-between"><p className="font-semibold text-ink-900">Resource filters</p><button onClick={() => setShowFilters(false)}><X size={15} className="text-ink-400" /></button></div>
          <label className="mb-1 mt-3 block text-xs font-medium text-ink-600">Team</label>
          <FilterSelect value={teamId} onChange={setTeamId} options={[{ value: "", label: "All teams" }, ...(planner?.filterOptions.teams ?? []).map((team) => ({ value: team.id, label: team.name }))]} />
          <div className="mt-3 flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setTeamId("")}>Clear</Button><Button size="sm" onClick={() => setShowFilters(false)}>Apply</Button></div>
        </div>}
        {showSchedule && planner && <div className="absolute right-12 top-full z-40 mt-2 w-80 rounded-xl border border-ink-200 bg-white p-4 shadow-popover">
          <div className="flex items-center justify-between"><p className="font-semibold text-ink-900">Company working hours</p><button onClick={() => setShowSchedule(false)}><X size={15} className="text-ink-400" /></button></div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Summary label="Schedule" value={planner.schedule.name} /><Summary label="Hours" value={`${planner.schedule.startTime} – ${planner.schedule.endTime}`} /><Summary label="Break" value={`${planner.schedule.breakMinutes} minutes`} /><Summary label="Daily capacity" value={`${hoursFromMinutes(planner.schedule.dailyMinutes)} hours`} /></div>
          <p className="mt-3 text-xs text-ink-500">Capacity is applied only on configured working days. Non-optional holidays have zero capacity.</p>
        </div>}
      </div>

      {error && <div className="m-4 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
      <div className="min-h-0 flex-1 p-4 lg:p-6">
        <Card className="h-full overflow-hidden">
          <div className="h-full overflow-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-ink-200 bg-surface-subtle">
                  <th className="sticky left-0 z-30 min-w-72 border-r border-ink-200 bg-surface-subtle px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Employee Name</th>
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
      {selectedDay && <DayDetailPanel detail={detail} loading={detailLoading} onClose={() => setSelectedDay(null)} onOpenTask={(projectId, taskId) => navigate(`/projects/${projectId}?task=${taskId}`)} />}
    </div>
  );
}

function ResourceRow({ employee, days, onSelectDay }: { employee: ResourcePlannerEmployee; days: ResourcePlannerDay[]; onSelectDay: (date: string) => void }) {
  return <tr className="group border-b border-ink-100 transition-colors hover:bg-brand-50/30">
    <td className="sticky left-0 z-10 border-r border-ink-200 bg-white px-4 py-3 group-hover:bg-brand-50/30">
      <div className="flex items-center gap-3"><MemberAvatar id={employee.id} name={employee.name} size="sm" status="active" className="ring-0" /><div className="min-w-0"><p className="truncate font-medium text-ink-900">{employee.name}</p><p className="truncate text-[11px] text-ink-400">{employee.email}</p></div><span className={cn("ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", employee.utilisationPercent === 0 ? "bg-ink-100 text-ink-500" : employee.utilisationPercent > 100 ? "bg-danger-50 text-danger-600" : "bg-success-50 text-success-600")}>{employee.utilisationPercent}%</span></div>
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

function DayDetailPanel({ detail, loading, onClose, onOpenTask }: { detail: ResourcePlannerDayDetail | null; loading: boolean; onClose: () => void; onOpenTask: (projectId: string, taskId: string) => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/25" onMouseDown={onClose}><aside className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
    <header className="flex items-center justify-between border-b border-ink-200 px-5 py-4"><div><p className="font-semibold text-ink-900">{detail?.employee.name ?? "Employee day details"}</p><p className="text-xs text-ink-500">{detail ? displayDate(detail.date) : "Loading…"}</p></div><button onClick={onClose} className="rounded-lg p-2 text-ink-400 hover:bg-ink-100"><X size={18} /></button></header>
    {loading || !detail ? <div className="flex flex-1 items-center justify-center text-sm text-ink-500">Loading task progress and work logs…</div> : <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {detail.holiday && <div className="mb-4 rounded-lg bg-info-50 px-3 py-2 text-sm text-info-700">{detail.holiday.name}{detail.holiday.optional ? " (optional holiday)" : ""}</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric label="Company capacity" value={`${hoursFromMinutes(detail.capacityMinutes)}h`} /><Metric label="Planned hours" value={`${hoursFromMinutes(detail.plannedMinutes)}h`} /><Metric label="Tracked hours" value={durationLabel(detail.trackedSeconds)} /><Metric label="Planned tracked" value={durationLabel(detail.plannedTrackedSeconds)} /><Metric label="Extra / overrun" value={durationLabel(detail.extraPlannedSeconds)} danger={detail.extraPlannedSeconds > 0} /><Metric label="Remaining plan" value={`${hoursFromMinutes(detail.remainingPlannedMinutes)}h`} /></div>
      <section className="mt-6"><div className="mb-2 flex items-center gap-2"><ListChecks size={16} className="text-brand-600" /><h3 className="font-semibold text-ink-900">Assigned task progress ({detail.tasks.length})</h3></div>{detail.tasks.length ? <div className="space-y-2">{detail.tasks.map((task) => <button key={task.id} onClick={() => onOpenTask(task.project.id, task.id)} className="w-full rounded-lg border border-ink-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/30"><div className="flex items-start gap-2"><span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px]">#{task.code}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink-900">{task.name}</p><p className="text-xs text-ink-500">{task.project.key} · {task.project.name}</p></div><Badge tone={task.status === "done" ? "green" : task.status === "in_progress" ? "amber" : "blue"}>{task.progress}%</Badge></div><div className="mt-2 flex gap-4 text-[11px] text-ink-500"><span>{hoursFromMinutes(task.plannedMinutes)}h planned today</span><span>{hoursFromMinutes(task.estimatedMinutes)}h estimated</span><span>{durationLabel(task.trackedSeconds)} total tracked</span></div></button>)}</div> : <p className="rounded-lg border border-dashed border-ink-200 p-4 text-sm text-ink-500">No task was scheduled or logged on this date.</p>}</section>
      <section className="mt-6"><div className="mb-2 flex items-center gap-2"><Clock3 size={16} className="text-brand-600" /><h3 className="font-semibold text-ink-900">Work logs ({detail.logs.length})</h3></div>{detail.logs.length ? <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">{detail.logs.map((log) => <div key={log.id} className="p-3"><div className="flex items-center gap-2"><CheckCircle2 size={14} className="text-success-500" /><p className="text-sm font-medium text-ink-900">{log.activityType}</p><span className="ml-auto font-mono text-xs text-ink-700">{durationLabel(log.effectiveDurationSeconds)}</span></div><p className="mt-1 text-xs text-ink-500">#{log.task.code} {log.task.name} · {log.project.name}</p><p className="mt-1 text-[11px] text-ink-400">{new Date(log.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – {log.endedAt ? new Date(log.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Running"} · {log.billable ? "Billable" : "Non-billable"}</p>{log.note && <p className="mt-1 text-xs text-ink-600">{log.note}</p>}</div>)}</div> : <p className="rounded-lg border border-dashed border-ink-200 p-4 text-sm text-ink-500">No tracked work was recorded on this date.</p>}</section>
    </div>}
  </aside></div>;
}
function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { return <div className={cn("rounded-lg border p-3", danger ? "border-danger-200 bg-danger-50" : "border-ink-200 bg-surface-subtle")}><p className="text-[11px] text-ink-500">{label}</p><p className={cn("mt-1 font-semibold", danger ? "text-danger-600" : "text-ink-900")}>{value}</p></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] text-ink-400">{label}</p><p className="font-medium text-ink-800">{value}</p></div>; }
function IconBtn({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) { return <button title={title} onClick={onClick} className="rounded-lg border border-ink-200 bg-white p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900">{children}</button>; }