import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginOrInvitationPage } from "@/features/auth/InvitationAcceptPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { AccessDeniedPage } from "@/features/auth/AccessDeniedPage";
import { AccountSuspendedPage } from "@/features/auth/AccountSuspendedPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { ProjectDetailPage } from "@/features/projects/ProjectDetailPage";
import { MilestonesPage } from "@/features/projects/MilestonesPage";
import { ResourcesPage } from "@/features/resources/ResourcesPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { TeamReportDetailPage } from "@/features/reports/TeamReportDetailPage";
import { AssignedTasksPage } from "@/features/tasks/AssignedTasksPage";
import { ChatPage } from "@/features/chat/ChatPage";
import { PlaceholderPage } from "./PlaceholderPage";
import { ProtectedRoute } from "./ProtectedRoute";
import { RootRedirect } from "./RootRedirect";
import { CompaniesPage } from "@/features/saas/CompaniesPage";
import { AuditLogPage } from "@/features/saas/AuditLogPage";
import { OnboardingWizardPage } from "@/features/onboarding/OnboardingWizardPage";
import { TeamRolesPage } from "@/features/team/TeamRolesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AccountSettingsPage } from "@/features/settings/AccountSettingsPage";
import { DepartmentsPage } from "@/features/departments/DepartmentsPage";
import { TeamsPage } from "@/features/teams/TeamsPage";

// Company portal: tenant-scoped once inside AppLayout — ProtectedRoute enforces an
// active company-user session before any of these render (session.tenantId then
// gates data reads via scopeToCurrentTenant, see src/lib/session.tsx).
const companyPortalRoutes = [
  { path: "/dashboard", element: <DashboardPage /> },
];

// SaaS portal: platform-level, not scoped to any tenant.
const saasPortalRoutes = [
  { path: "/saas", element: <CompaniesPage /> },
  { path: "/saas/audit", element: <AuditLogPage /> },
];

export const router = createBrowserRouter([
  { path: "/", element: <RootRedirect /> },
  { path: "/login", element: <LoginOrInvitationPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/access-denied", element: <AccessDeniedPage /> },
  { path: "/account-suspended", element: <AccountSuspendedPage /> },
  {
    element: <ProtectedRoute requireKind="company" />,
    children: [{ element: <AppLayout />, children: companyPortalRoutes }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "projects", action: "view" }} />,
    children: [{ element: <AppLayout />, children: [
      { path: "/projects", element: <ProjectsPage /> },
      { path: "/projects/:projectId", element: <ProjectDetailPage /> },
      { path: "/milestones", element: <MilestonesPage /> },
    ] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "tasks", action: "view" }} />,
    children: [{ element: <AppLayout />, children: [
      { path: "/tasks", element: <AssignedTasksPage /> },
      { path: "/check-ins", element: <PlaceholderPage title="Check-ins" /> },
      { path: "/calendar", element: <PlaceholderPage title="Calendar" /> },
      { path: "/timesheet", element: <PlaceholderPage title="Timesheet" /> },
    ] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "chat", action: "view" }} />,
    children: [{ element: <AppLayout />, children: [{ path: "/chat", element: <ChatPage /> }] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "projects", action: "edit" }} />,
    children: [{ element: <AppLayout />, children: [{ path: "/workflow", element: <PlaceholderPage title="Workflow" /> }] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "projects", action: "manage" }} />,
    children: [{ element: <AppLayout />, children: [{ path: "/budgets", element: <PlaceholderPage title="Budgets" /> }] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "resources", action: "view" }} />,
    children: [{ element: <AppLayout />, children: [{ path: "/resources", element: <ResourcesPage /> }] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "resources", action: "view" }} />,
    children: [{ element: <AppLayout />, children: [
      { path: "/reports", element: <ReportsPage /> },
      { path: "/reports/teams/:teamId", element: <TeamReportDetailPage /> },
    ] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "company_settings", action: "manage" }} />,
    children: [{ element: <AppLayout />, children: [{ path: "/onboarding", element: <OnboardingWizardPage /> }] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "company_users", action: "invite" }} />,
    children: [{ element: <AppLayout />, children: [{ path: "/team", element: <TeamRolesPage /> }] }],
  },
  {
    element: <ProtectedRoute requireKind="company" requiredPermission={{ module: "company_settings", action: "manage" }} />,
    children: [
      { element: <AppLayout />, children: [{ path: "/settings", element: <SettingsPage /> }] },
      { element: <AppLayout />, children: [{ path: "/departments", element: <DepartmentsPage /> }] },
      { element: <AppLayout />, children: [{ path: "/teams", element: <TeamsPage /> }] },
    ],
  },
  {
    element: <ProtectedRoute requireKind="platform" />,
    children: [{ element: <AppLayout />, children: saasPortalRoutes }],
  },
  {
    // Personal account settings (change password) — open to any authenticated user,
    // company or platform, unlike /settings which is tenant-wide and admin-only.
    element: <ProtectedRoute />,
    children: [{ element: <AppLayout />, children: [{ path: "/account", element: <AccountSettingsPage /> }] }],
  },
  { path: "*", element: <RootRedirect /> },
]);
