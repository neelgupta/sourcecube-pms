import { NavLink } from "react-router-dom";
import {
  BarChart3,
  Briefcase,
  Building2,
  // CalendarDays,
  // CheckSquare,
  // ClipboardCheck,
  Flag,
  LayoutGrid,
  ListTodo,
  MessageCircle,
  // PiggyBank,
  Settings2,
  ShieldCheck,
  Sliders,
  Users,
  Users2,
  // Workflow,
  X,
} from "lucide-react";
import { LogoMark } from "@/components/common/Logo";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { hasPermission, type Action, type Module } from "@/lib/permissions";
import { useUnreadChatCount } from "@/features/chat/useUnreadChatCount";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  badge?: boolean;
  /** Nav item is hidden unless the current user has this module/action permission. Omit to always show. */
  requires?: { module: Module; action: Action };
}

const companyNavItems: NavItem[] = [
  { to: "/onboarding", label: "Company setup", icon: Settings2, requires: { module: "company_settings", action: "manage" } },
  { to: "/settings", label: "Settings", icon: Sliders, requires: { module: "company_settings", action: "manage" } },
  { to: "/team", label: "Team & roles", icon: ShieldCheck, requires: { module: "company_users", action: "invite" } },
  { to: "/departments", label: "Departments", icon: Building2, requires: { module: "company_settings", action: "manage" } },
  { to: "/teams", label: "Teams", icon: Users2, requires: { module: "company_settings", action: "manage" } },
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/chat", label: "Chat", icon: MessageCircle, requires: { module: "chat", action: "view" } },
  { to: "/projects", label: "Projects", icon: Briefcase, requires: { module: "projects", action: "view" } },
  { to: "/tasks", label: "Tasks", icon: ListTodo, requires: { module: "tasks", action: "view" } },
  // { to: "/check-ins", label: "Check-ins", icon: ClipboardCheck, badge: true, requires: { module: "tasks", action: "view" } },
  // { to: "/calendar", label: "Calendar", icon: CalendarDays, requires: { module: "tasks", action: "view" } },
  // { to: "/workflow", label: "Workflow", icon: Workflow, requires: { module: "projects", action: "edit" } },
  // { to: "/budgets", label: "Budgets", icon: PiggyBank, requires: { module: "projects", action: "manage" } },
  { to: "/milestones", label: "Milestones", icon: Flag, requires: { module: "projects", action: "view" } },
  { to: "/resources", label: "Resources", icon: Users, requires: { module: "resources", action: "view" } },
  // { to: "/timesheet", label: "Timesheet", icon: CheckSquare, requires: { module: "tasks", action: "view" } },
  { to: "/reports", label: "Reports", icon: BarChart3, requires: { module: "resources", action: "view" } },
];

const platformNavItems: NavItem[] = [
  { to: "/saas", label: "Companies", icon: Building2 },
  { to: "/saas/audit", label: "Audit log", icon: ShieldCheck },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useSession();
  const canUseChat = session?.user.kind === "company" && hasPermission(session.user.roles, "chat", "view");
  const unreadChatCount = useUnreadChatCount(canUseChat);
  const navItems =
    session?.user.kind === "platform"
      ? platformNavItems
      : companyNavItems.filter(
          (item) =>
            !item.requires ||
            (session?.user.kind === "company" &&
              hasPermission(session.user.roles, item.requires.module, item.requires.action)),
        );

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink-900/30 lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[88px] flex-col border-r border-ink-200 bg-white transition-transform duration-200",
          "lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-center border-b border-ink-200">
          <LogoMark size={36} />
          <button
            onClick={onClose}
            className="absolute right-2 top-5 rounded-lg p-1 text-ink-500 hover:bg-ink-100 lg:hidden"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-none py-3">
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "group relative flex flex-col items-center gap-1.5 px-1 py-3 text-[10.5px] font-medium transition-colors",
                  isActive ? "text-brand-600" : "text-ink-500 hover:bg-ink-100/70 hover:text-ink-900",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-brand-600" />
                  )}
                  <span className="relative">
                    <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                    {badge && (
                      <span className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-danger-500" />
                    )}
                    {to === "/chat" && unreadChatCount > 0 && (
                      <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-white">
                        {unreadChatCount > 99 ? "99+" : unreadChatCount}
                      </span>
                    )}
                  </span>
                  <span className="text-center leading-tight">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
