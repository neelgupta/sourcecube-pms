import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Gauge,
  Medal,
  TimerReset,
  Trophy,
  Users,
} from "lucide-react";
import { Badge, Card, DateRangePicker, FilterSelect, MemberAvatar, ProgressBar, SearchBar, initialsOf } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { TeamMemberProductivityReport, TeamMemberProductivityRow } from "@/types/tenant";

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function daysAgo(count: number) { const date = new Date(); date.setDate(date.getDate() - count); return dateKey(date); }
function displayDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
function timeFromSeconds(seconds: number) { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`; }
function timeFromMinutes(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}h ${String(minutes % 60).padStart(2, "0")}m`; }

export function TeamReportDetailPage() {
  const { teamId = "" } = useParams();
  const [params] = useSearchParams();
  const today = useMemo(() => dateKey(new Date()), []);
  const [start, setStart] = useState(params.get("start") || today);
  const [end, setEnd] = useState(params.get("end") || today);
  const [preset, setPreset] = useState(params.get("start") || params.get("end") ? "custom" : "today");
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<TeamMemberProductivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId || !start || !end || start > end) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      api.getTeamMemberProductivityReport(teamId, { start, end, search: search.trim() || undefined })
        .then((result) => { if (!cancelled) { setReport(result); setError(null); } })
        .catch((reason) => { if (!cancelled) setError(reason instanceof ApiError ? reason.message : "Team report could not be loaded"); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [teamId, start, end, search]);

  function chooseRange(value: string) {
    setPreset(value);
    if (value === "today") { setStart(today); setEnd(today); }
    if (value === "7d") { setStart(daysAgo(6)); setEnd(today); }
    if (value === "30d") { setStart(daysAgo(29)); setEnd(today); }
  }

  return <div className="min-h-full bg-surface-subtle p-4 lg:p-6">
    <div className="mx-auto max-w-[1800px] space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/reports?start=${start}&end=${end}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"><ArrowLeft size={15} />Back to reports</Link>
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-sm font-bold text-brand-700">{report ? initialsOf(report.team.name) : "T"}</span><div><h1 className="text-xl font-bold text-ink-900">{report?.team.name ?? "Team performance"}</h1><p className="mt-0.5 text-sm text-ink-500">{report?.team.purpose || "Member productivity, workload, working hours and ranking."}</p></div></div>
        </div>
        {report?.team.lead && <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"><span className="text-ink-400">Team lead</span><span className="ml-2 font-semibold text-ink-800">{report.team.lead.name}</span></div>}
      </header>

      <Card className="overflow-visible p-4"><div className="flex flex-wrap items-end gap-3">
        <div><p className="mb-1 text-xs font-medium text-ink-500">Date range</p><FilterSelect value={preset} onChange={chooseRange} className="w-36" options={[{ value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "custom", label: "Custom range" }]} /></div>
        <div className="w-64"><p className="mb-1 text-xs font-medium text-ink-500">From – To</p><DateRangePicker from={start} to={end} onChange={(range) => { if (range.from) setStart(range.from); if (range.to) setEnd(range.to); setPreset("custom"); }} /></div>
        <div className="min-w-64 flex-1"><p className="mb-1 text-xs font-medium text-ink-500">Member, project or task</p><SearchBar value={search} onChange={setSearch} placeholder="Search team performance" /></div>
      </div>{start > end && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">The start date must be before the end date.</p>}</Card>

      {error && <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
      {!report && loading && <Card className="flex min-h-72 items-center justify-center text-sm text-ink-500">Generating member productivity report...</Card>}

      {report && <div className={cn("space-y-5 transition-opacity", loading && "pointer-events-none opacity-60")}>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-ink-500">{displayDate(report.range.start)} - {displayDate(report.range.end)} · {report.range.timezone}</p><div className="flex flex-wrap gap-2"><Badge tone="blue">{report.schedule.name}</Badge><Badge>{report.schedule.startTime} - {report.schedule.endTime}</Badge><Badge>{report.team.visibleMemberCount} visible of {report.team.memberCount} members</Badge></div></div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 2xl:grid-cols-10">
          <Summary icon={<Users size={16} />} label="Members" value={report.summary.membersCount} />
          <Summary icon={<BriefcaseBusiness size={16} />} label="Projects" value={report.summary.projectsCount} />
          <Summary icon={<FolderKanban size={16} />} label="Assigned" value={report.summary.assignedTasks} />
          <Summary icon={<TimerReset size={16} />} label="In progress" value={report.summary.inProgressTasks} tone="amber" />
          <Summary icon={<CheckCircle2 size={16} />} label="Completed" value={report.summary.completedTasks} tone="green" />
          <Summary icon={<AlertTriangle size={16} />} label="Overdue" value={report.summary.overdueTasks} tone="red" />
          <Summary icon={<Gauge size={16} />} label="Productivity" value={`${report.summary.productivityPercent}%`} tone="blue" />
          <Summary icon={<Clock3 size={16} />} label="Tracked" value={timeFromSeconds(report.summary.trackedSeconds)} tone="purple" />
          <Summary icon={<Clock3 size={16} />} label="Capacity" value={timeFromMinutes(report.summary.capacityMinutes)} />
          <Summary icon={<Gauge size={16} />} label="Utilisation" value={`${report.summary.utilizationPercent}%`} tone="blue" />
        </section>

        <Card className="p-4"><div className="mb-4 flex items-center gap-2"><Trophy size={18} className="text-warning-500" /><div><h2 className="font-semibold text-ink-900">Top three performers</h2><p className="text-xs text-ink-500">Ranked inside this team and selected reporting range.</p></div></div>
          {report.ranking.length ? <div className="grid gap-3 md:grid-cols-3">{report.ranking.map((member, index) => <RankingCard key={member.id} member={member} place={index + 1} />)}</div> : <p className="rounded-lg bg-surface-subtle p-6 text-center text-sm text-ink-500">No member activity is available for ranking.</p>}
        </Card>

        <Card className="overflow-hidden"><div className="border-b border-ink-200 px-4 py-3"><h2 className="font-semibold text-ink-900">Member-wise performance</h2><p className="mt-0.5 text-xs text-ink-500">Tasks, overdue work, company capacity, logged time, utilisation and productivity.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1500px] border-collapse text-sm"><thead><tr className="border-b border-ink-200 bg-surface-subtle text-left text-xs uppercase tracking-wide text-ink-500"><th className="px-4 py-3">Rank / member</th><th className="px-3 py-3">Projects</th><th className="px-3 py-3">Assigned</th><th className="px-3 py-3">New</th><th className="px-3 py-3">In progress</th><th className="px-3 py-3">Completed</th><th className="px-3 py-3">Overdue</th><th className="min-w-48 px-3 py-3">Productivity</th><th className="px-3 py-3">Working hours</th><th className="px-3 py-3">Planned</th><th className="px-3 py-3">Tracked</th><th className="min-w-44 px-3 py-3">Utilisation</th><th className="px-3 py-3">Billable</th></tr></thead><tbody>
            {report.members.map((member) => <tr key={member.id} className="border-b border-ink-100 hover:bg-brand-50/20"><td className="px-4 py-3"><div className="flex items-center gap-3"><span className="w-6 text-center text-xs font-bold text-ink-400">#{member.rank}</span><MemberAvatar id={member.id} name={member.name} size="md" status="active" className="ring-0" /><div><p className="font-semibold text-ink-900">{member.name}</p><div className="mt-0.5 flex gap-1">{member.isLead && <Badge tone="blue">Team lead</Badge>}<span className="text-[11px] text-ink-400">Joined {displayDate(member.joinedAt.slice(0, 10))}</span></div></div></div></td><td className="px-3 py-3">{member.projectsCount}</td><td className="px-3 py-3 font-semibold">{member.assignedTasks}</td><td className="px-3 py-3">{member.newTasks}</td><td className="px-3 py-3"><Badge tone="amber">{member.inProgressTasks}</Badge></td><td className="px-3 py-3"><Badge tone="green">{member.completedTasks}</Badge></td><td className="px-3 py-3"><span className={member.overdueTasks ? "font-semibold text-danger-600" : "text-ink-400"}>{member.overdueTasks}</span></td><td className="px-3 py-3"><div className="flex items-center gap-2"><ProgressBar value={member.productivityPercent} className="w-28" /><span className="font-semibold">{member.productivityPercent}%</span></div><p className="mt-1 text-[11px] text-ink-400">{member.completionRate}% completed</p></td><td className="px-3 py-3 font-mono text-xs">{timeFromMinutes(member.capacityMinutes)}</td><td className="px-3 py-3 font-mono text-xs">{timeFromMinutes(member.plannedMinutes)}</td><td className="px-3 py-3 font-mono text-xs">{timeFromSeconds(member.trackedSeconds)}</td><td className="px-3 py-3"><div className="flex items-center gap-2"><ProgressBar value={member.utilizationPercent} className="w-24" tone="brand" /><span className={cn("font-semibold", member.utilizationPercent > 100 && "text-danger-600")}>{member.utilizationPercent}%</span></div></td><td className="px-3 py-3 font-mono text-xs">{timeFromSeconds(member.billableSeconds)}</td></tr>)}
            {report.members.length === 0 && <tr><td colSpan={13} className="px-4 py-12 text-center text-ink-500">No members or assigned work match the selected filters.</td></tr>}
          </tbody></table></div>
        </Card>
        <p className="rounded-lg border border-info-100 bg-info-50 px-3 py-2 text-xs text-info-700">{report.methodology}</p>
      </div>}
    </div>
  </div>;
}

function Summary({ icon, label, value, tone = "neutral" }: { icon: ReactNode; label: string; value: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" | "purple" }) {
  const tones = { neutral: "bg-ink-100 text-ink-600", green: "bg-success-50 text-success-600", amber: "bg-warning-50 text-warning-600", red: "bg-danger-50 text-danger-600", blue: "bg-info-50 text-info-600", purple: "bg-purple-50 text-purple-600" };
  return <Card className="p-3"><div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", tones[tone])}>{icon}</div><p className="mt-3 text-[11px] uppercase tracking-wide text-ink-400">{label}</p><p className="mt-1 text-lg font-bold text-ink-900">{value}</p></Card>;
}
function RankingCard({ member, place }: { member: TeamMemberProductivityRow; place: number }) {
  const colors = ["border-warning-300 bg-warning-50/50", "border-ink-300 bg-ink-50", "border-orange-200 bg-orange-50/40"];
  return <div className={cn("rounded-xl border p-4", colors[place - 1])}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><MemberAvatar id={member.id} name={member.name} size="lg" status="active" className="ring-2 ring-white shadow-sm" /><div><p className="font-semibold text-ink-900">{member.name}</p><p className="text-xs text-ink-500">{member.assignedTasks} assigned · {member.completedTasks} completed</p></div></div><span className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-bold text-ink-700 shadow-sm"><Medal size={14} className={place === 1 ? "text-warning-500" : "text-ink-400"} />#{place}</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><RankMetric label="Productivity" value={`${member.productivityPercent}%`} /><RankMetric label="Tracked" value={timeFromSeconds(member.trackedSeconds)} /><RankMetric label="Overdue" value={String(member.overdueTasks)} danger={member.overdueTasks > 0} /></div></div>;
}
function RankMetric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { return <div className="rounded-lg bg-white/80 px-2 py-2"><p className={cn("text-sm font-bold text-ink-900", danger && "text-danger-600")}>{value}</p><p className="mt-0.5 text-[10px] text-ink-400">{label}</p></div>; }