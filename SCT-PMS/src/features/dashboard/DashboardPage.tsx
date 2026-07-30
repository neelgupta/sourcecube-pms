import { useMemo, useState } from "react";
import { Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button, Tabs, type TabItem } from "@/components/common";
import { useSession } from "@/lib/session";
import { formatHoursMinutes, isDueToday, isOverdue, useDashboardData } from "./useDashboardData";
import { OverviewTab } from "./OverviewTab";
import { WidgetTile } from "./components/WidgetTile";
import { TasksByAssigneeCard, TasksByPriorityCard } from "./components/AnalyticsCharts";
import type { AssignedTask } from "@/types/tenant";

const tabs: TabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "global", label: "Global Dashboard" },
  { id: "my", label: "My Dashboard" },
];

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const { session } = useSession();
  const canViewGlobal = session?.user.kind === "company" && session.user.roles.some((role) => role === "company_super_admin" || role === "hr_admin" || role === "auditor");
  const visibleTabs = canViewGlobal ? tabs : tabs.filter((tab) => tab.id !== "global");
  const { projects, myTasks, loading, reload } = useDashboardData();
  const currentUserId = session?.user.kind === "company" ? session.user.id : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-ink-200 bg-white px-4 lg:px-6">
        <Tabs tabs={visibleTabs} activeId={activeTab} onChange={setActiveTab} />
        {activeTab !== "overview" && (
          <div className="flex shrink-0 items-center gap-2 py-2.5">
            <Button variant="ghost" size="icon" title="Refresh" onClick={reload}>
              <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
            </Button>
            <Button variant="ghost" size="icon" title="Layout">
              <SlidersHorizontal size={16} />
            </Button>
            <Button size="sm" leftIcon={<Plus size={15} />} disabled>
              Add Widget
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 lg:p-6">
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "global" && canViewGlobal && <TaskMetricsTab tasks={myTasks} projects={projects} scope="tenant" />}
        {activeTab === "my" && <TaskMetricsTab tasks={myTasks.filter((t) => t.assigneeId === currentUserId)} projects={projects} scope="mine" />}
      </div>
    </div>
  );
}

function TaskMetricsTab({
  tasks,
  projects,
  scope,
}: {
  tasks: AssignedTask[];
  projects: { estimatedHours?: number | null }[];
  scope: "tenant" | "mine";
}) {
  const widgets = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "done").length;
    const open = total - completed;
    const overdue = tasks.filter((t) => isOverdue(t.dueDate, t.status)).length;
    const dueToday = tasks.filter((t) => t.status !== "done" && isDueToday(t.dueDate)).length;
    const estimatedMinutes = tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
    const trackedMinutes = tasks.reduce((sum, t) => sum + t.trackedMinutes, 0);

    const base = [
      { id: "total", label: scope === "tenant" ? "Total Tasks" : "My Tasks", value: total },
      { id: "completed", label: "Completed Tasks", value: completed },
      { id: "open", label: scope === "tenant" ? "Open Tasks" : "My Open Tasks", value: open },
      { id: "overdue", label: scope === "tenant" ? "Overdue Tasks" : "My Overdue Tasks", value: overdue },
      { id: "dueToday", label: "Due Today", value: dueToday },
      { id: "estimation", label: scope === "tenant" ? "Total Estimation Hours" : "My Estimation Hours", value: formatHoursMinutes(estimatedMinutes) },
      { id: "worklog", label: scope === "tenant" ? "Total Work Log Hours" : "My Work Log Hours", value: formatHoursMinutes(trackedMinutes) },
    ];
    if (scope === "tenant") base.unshift({ id: "projects", label: "Total Projects", value: projects.length });
    return base;
  }, [tasks, projects, scope]);

  const byAssignee = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const name = task.assignee?.name ?? "Unassigned";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [tasks]);

  const byPriority = useMemo(() => {
    const labels: Record<string, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const label = labels[task.priority] ?? task.priority;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return ["Low", "Medium", "High", "Critical"]
      .filter((label) => counts.has(label))
      .map((label) => ({ priority: label, count: counts.get(label) ?? 0 }));
  }, [tasks]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        {widgets.map((metric) => (
          <WidgetTile key={metric.id} metric={metric} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <TasksByAssigneeCard data={byAssignee} />
        <TasksByPriorityCard data={byPriority} />
      </div>
    </div>
  );
}
