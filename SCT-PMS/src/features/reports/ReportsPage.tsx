import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FolderKanban,
  Gauge,
  TimerReset,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge, Button, Card, FilterSelect, MemberAvatar, ProgressBar, SearchBar } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { TeamProductivityReport } from "@/types/tenant";

const reportCards = [
  { id: "team-productivity", title: "Day-wise Team Productivity", description: "Allocated, in-progress and completed project tasks with tracked hours and team progress.", icon: Users, tone: "bg-brand-50 text-brand-600", available: true },
  { id: "project-performance", title: "Project Performance", description: "Project delivery, schedule, health, milestones and completion trends.", icon: FolderKanban, tone: "bg-info-50 text-info-600", available: false },
  { id: "time-utilisation", title: "Time & Utilisation", description: "Employee capacity, billable hours, work logs and utilisation analysis.", icon: Clock3, tone: "bg-purple-50 text-purple-600", available: false },
  { id: "budget-cost", title: "Budget & Cost", description: "Budget consumption, expenses, employee CTC and profitability.", icon: BriefcaseBusiness, tone: "bg-warning-50 text-warning-600", available: false },
];

function key(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function daysAgo(count: number) { const date = new Date(); date.setDate(date.getDate() - count); return key(date); }
function displayDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}
function planned(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m`;
}

export function ReportsPage() {
  const [params] = useSearchParams();
  const today = useMemo(() => key(new Date()), []);
  const [selectedReport, setSelectedReport] = useState("team-productivity");
  const [start, setStart] = useState(params.get("start") || today);
  const [end, setEnd] = useState(params.get("end") || today);
  const [rangePreset, setRangePreset] = useState(params.get("start") || params.get("end") ? "custom" : "today");
  const [teamId, setTeamId] = useState("");
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<TeamProductivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedReport !== "team-productivity" || !start || !end || start > end) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      api.getTeamProductivityReport({ start, end, teamId: teamId || undefined, search: search.trim() || undefined })
        .then((result) => { if (!cancelled) { setReport(result); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Team productivity report could not be loaded"); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [selectedReport, start, end, teamId, search]);

  function chooseRange(value: string) {
    setRangePreset(value);
    if (value === "today") { setStart(today); setEnd(today); }
    if (value === "7d") { setStart(daysAgo(6)); setEnd(today); }
    if (value === "30d") { setStart(daysAgo(29)); setEnd(today); }
  }

  function exportCsv() {
    if (!report) return;
    const rows = [
      ["Team", "Members", "Projects", "Allocated", "New", "In Progress", "Completed", "Overdue", "Productivity %", "Completion %", "Planned", "Tracked", "Billable"],
      ...report.teams.map((team) => [team.name, team.memberCount, team.projectsCount, team.allocatedTasks, team.newTasks, team.inProgressTasks, team.completedTasks, team.overdueTasks, team.productivityPercent, team.completionRate, planned(team.plannedMinutes), duration(team.trackedSeconds), duration(team.billableSeconds)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `team-productivity-${start}-to-${end}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="min-h-full bg-surface-subtle p-4 lg:p-6">
    <div className="mx-auto max-w-[1800px] space-y-5">
      <header><div className="flex items-center gap-2"><BarChart3 size={22} className="text-brand-600" /><h1 className="text-xl font-bold text-ink-900">Reports</h1></div><p className="mt-1 text-sm text-ink-500">Operational reports generated from real projects, tasks, teams and saved work logs.</p></header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {reportCards.map((item) => { const Icon = item.icon; const selected = selectedReport === item.id; return <button key={item.id} type="button" disabled={!item.available} onClick={() => item.available && setSelectedReport(item.id)} className={cn("rounded-xl border bg-white p-4 text-left shadow-sm transition", selected ? "border-brand-400 ring-2 ring-brand-500/10" : "border-ink-200 hover:border-brand-200", !item.available && "cursor-not-allowed opacity-65")}>
          <div className="flex items-start gap-3"><span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", item.tone)}><Icon size={19} /></span><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-semibold text-ink-900">{item.title}</p>{!item.available && <Badge>Coming soon</Badge>}</div><p className="mt-1 text-xs leading-5 text-ink-500">{item.description}</p></div></div>
        </button>; })}
      </section>

      {selectedReport === "team-productivity" && <>
        <Card className="overflow-visible p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div><p className="mb-1 text-xs font-medium text-ink-500">Date range</p><FilterSelect value={rangePreset} onChange={chooseRange} className="w-36" options={[{ value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "custom", label: "Custom range" }]} /></div>
            <label><span className="mb-1 block text-xs font-medium text-ink-500">From</span><input type="date" value={start} max={end} onChange={(event) => { setStart(event.target.value); setRangePreset("custom"); }} className="h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500" /></label>
            <label><span className="mb-1 block text-xs font-medium text-ink-500">To</span><input type="date" value={end} min={start} onChange={(event) => { setEnd(event.target.value); setRangePreset("custom"); }} className="h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500" /></label>
            <div><p className="mb-1 text-xs font-medium text-ink-500">Team</p><FilterSelect value={teamId} onChange={setTeamId} className="w-52" options={[{ value: "", label: "All visible teams" }, ...(report?.filterOptions.teams ?? []).map((team) => ({ value: team.id, label: team.name }))]} /></div>
            <div className="min-w-56 flex-1"><p className="mb-1 text-xs font-medium text-ink-500">Project, task or employee</p><SearchBar value={search} onChange={setSearch} placeholder="Search report data" /></div>
            <Button variant="outline" leftIcon={<Download size={15} />} onClick={exportCsv} disabled={!report || loading}>Export CSV</Button>
          </div>
          {start > end && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">The start date must be before the end date.</p>}
        </Card>

        {error && <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
        {report && <div className={cn("space-y-5 transition-opacity", loading && "pointer-events-none opacity-60")}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-ink-900">Team productivity report</h2><p className="text-xs text-ink-500">{displayDate(report.range.start)} - {displayDate(report.range.end)} · {report.range.timezone}</p></div><Badge tone="blue">Server generated</Badge></div>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <Metric icon={<Users size={16} />} label="Teams" value={report.overall.teamsCount} />
            <Metric icon={<BriefcaseBusiness size={16} />} label="Projects" value={report.overall.projectsCount} />
            <Metric icon={<FolderKanban size={16} />} label="Allocated" value={report.overall.allocatedTasks} />
            <Metric icon={<TimerReset size={16} />} label="In progress" value={report.overall.inProgressTasks} tone="amber" />
            <Metric icon={<CheckCircle2 size={16} />} label="Completed" value={report.overall.completedTasks} tone="green" />
            <Metric icon={<TrendingUp size={16} />} label="Productivity" value={`${report.overall.productivityPercent}%`} tone="blue" />
            <Metric icon={<Gauge size={16} />} label="Completion" value={`${report.overall.completionRate}%`} tone="green" />
            <Metric icon={<Clock3 size={16} />} label="Tracked" value={duration(report.overall.trackedSeconds)} tone="purple" />
          </section>

          <Card className="overflow-hidden">
            <div className="border-b border-ink-200 px-4 py-3"><h3 className="font-semibold text-ink-900">Team-wise allocated work</h3><p className="mt-0.5 text-xs text-ink-500">Current task status with completions recorded inside the selected range.</p></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[1250px] border-collapse text-sm"><thead><tr className="border-b border-ink-200 bg-surface-subtle text-left text-xs uppercase tracking-wide text-ink-500"><th className="px-4 py-3">Team</th><th className="min-w-64 px-3 py-3">Assigned members</th><th className="px-3 py-3">Projects</th><th className="px-3 py-3">Allocated</th><th className="px-3 py-3">New</th><th className="px-3 py-3">In progress</th><th className="px-3 py-3">Completed</th><th className="px-3 py-3">Overdue</th><th className="min-w-44 px-3 py-3">Productivity</th><th className="px-3 py-3">Planned</th><th className="px-3 py-3">Tracked</th><th className="px-3 py-3">Billable</th></tr></thead><tbody>
              {report.teams.map((team) => <tr key={team.id} className="border-b border-ink-100 hover:bg-brand-50/20"><td className="px-4 py-3">{team.id === "unassigned" ? <div className="font-medium text-ink-900">{team.name}</div> : <Link to={`/reports/teams/${team.id}?start=${start}&end=${end}`} className="font-semibold text-brand-700 hover:text-brand-800 hover:underline">{team.name}</Link>}<div className="text-[11px] text-ink-400">{team.memberCount} members{team.lead ? ` · Lead: ${team.lead.name}` : ""}</div></td><td className="px-3 py-3"><div className="flex max-w-72 flex-wrap items-center gap-2">{team.members.slice(0, 5).map((member) => <div key={member.id} className="flex items-center gap-1.5 rounded-full bg-white px-1.5 py-1 shadow-sm ring-1 ring-ink-100"><MemberAvatar id={member.id} name={member.name} size="sm" status="active" className="ring-0" /><span className="max-w-28 truncate text-xs font-medium text-ink-800">{member.name}</span></div>)}{team.memberCount > 5 && <span className="rounded-full bg-ink-100 px-2 py-1 text-xs font-medium text-ink-600">+{team.memberCount - 5} more</span>}{team.memberCount === 0 && <span className="text-xs text-ink-400">No members assigned</span>}</div></td><td className="px-3 py-3">{team.projectsCount}</td><td className="px-3 py-3 font-semibold">{team.allocatedTasks}</td><td className="px-3 py-3">{team.newTasks}</td><td className="px-3 py-3"><Badge tone="amber">{team.inProgressTasks}</Badge></td><td className="px-3 py-3"><Badge tone="green">{team.completedTasks}</Badge></td><td className="px-3 py-3"><span className={team.overdueTasks ? "font-semibold text-danger-600" : "text-ink-400"}>{team.overdueTasks}</span></td><td className="px-3 py-3"><div className="flex items-center gap-2"><ProgressBar value={team.productivityPercent} className="w-24" /><span className="font-semibold text-ink-800">{team.productivityPercent}%</span></div><p className="mt-1 text-[11px] text-ink-400">{team.completionRate}% completed</p></td><td className="px-3 py-3 font-mono text-xs">{planned(team.plannedMinutes)}</td><td className="px-3 py-3 font-mono text-xs">{duration(team.trackedSeconds)}</td><td className="px-3 py-3 font-mono text-xs">{duration(team.billableSeconds)}</td></tr>)}
              {report.teams.length === 0 && <tr><td colSpan={12} className="px-4 py-12 text-center text-ink-500">No team work was found for the selected dates and filters.</td></tr>}
            </tbody></table></div>
          </Card>

          <Card className="overflow-hidden"><div className="border-b border-ink-200 px-4 py-3"><h3 className="font-semibold text-ink-900">Date-wise team progress</h3><p className="mt-0.5 text-xs text-ink-500">Daily allocated workload, completion activity and saved work-log hours.</p></div><div className="overflow-x-auto"><div className="flex min-w-max gap-3 p-4">{report.daily.map((day) => <div key={day.date} className="w-44 rounded-xl border border-ink-200 bg-white p-3"><div className="flex items-center gap-2"><CalendarDays size={14} className="text-brand-600" /><p className="text-xs font-semibold text-ink-800">{displayDate(day.date)}</p></div><div className="mt-3 flex items-end justify-between"><div><p className="text-2xl font-bold text-ink-900">{day.productivityPercent}%</p><p className="text-[11px] text-ink-400">productivity</p></div><div className="flex h-14 w-8 items-end rounded bg-ink-100 p-1"><div className="w-full rounded bg-brand-500" style={{ height: `${Math.max(3, day.productivityPercent)}%` }} /></div></div><ProgressBar value={day.productivityPercent} className="mt-3" /><div className="mt-3 grid grid-cols-3 gap-1 text-center"><Tiny label="Allocated" value={day.allocatedTasks} /><Tiny label="Progress" value={day.inProgressTasks} /><Tiny label="Done" value={day.completedTasks} /></div><p className="mt-3 border-t border-ink-100 pt-2 text-xs text-ink-500"><Clock3 size={12} className="mr-1 inline" />{duration(day.trackedSeconds)} tracked</p></div>)}</div></div></Card>
          <p className="rounded-lg border border-info-100 bg-info-50 px-3 py-2 text-xs text-info-700">{report.methodology}</p>
        </div>}
        {!report && loading && <Card className="flex min-h-72 items-center justify-center text-sm text-ink-500">Generating team productivity report...</Card>}
      </>}
    </div>
  </div>;
}

function Metric({ icon, label, value, tone = "neutral" }: { icon: ReactNode; label: string; value: ReactNode; tone?: "neutral" | "green" | "amber" | "blue" | "purple" }) {
  const tones = { neutral: "bg-ink-100 text-ink-600", green: "bg-success-50 text-success-600", amber: "bg-warning-50 text-warning-600", blue: "bg-info-50 text-info-600", purple: "bg-purple-50 text-purple-600" };
  return <Card className="p-3"><div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", tones[tone])}>{icon}</div><p className="mt-3 text-[11px] uppercase tracking-wide text-ink-400">{label}</p><p className="mt-1 text-lg font-bold text-ink-900">{value}</p></Card>;
}
function Tiny({ label, value }: { label: string; value: number }) { return <div className="rounded bg-surface-subtle px-1 py-1.5"><p className="font-semibold text-ink-800">{value}</p><p className="text-[9px] text-ink-400">{label}</p></div>; }