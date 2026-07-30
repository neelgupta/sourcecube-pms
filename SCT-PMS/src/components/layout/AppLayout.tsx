import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/tasks": "Tasks",
  "/check-ins": "Check-ins",
  "/calendar": "Calendar",
  "/workflow": "Workflow",
  "/budgets": "Budgets",
  "/milestones": "Milestones",
  "/resources": "Resource",
  "/timesheet": "Timesheet",
  "/reports": "Reports",
};

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  const isProjectWorkspace = pathname.startsWith("/projects/");
  const isReportWorkspace = pathname.startsWith("/reports/");
  const title = isProjectWorkspace ? "Project Workspace" : isReportWorkspace ? "Reports" : (titles[pathname] ?? "Sourcecube PMS");

  return (
    <div className="flex h-full">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-22">
        <Topbar title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
