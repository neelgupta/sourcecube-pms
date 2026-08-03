import type {
  Company,
  CompanyStats,
  CompanyStatus,
  CompanyUser,
  AuditLogEntry,
  Department,
  Designation,
  Holiday,
  HolidayType,
  LeaveType,
  WorkingSchedule,
  OnboardingState,
  SystemRole,
  Team,
  TeamDetail,
  TeamMember,
  TeamStatus,
  RealProject,
  RealProjectStatus,
  ProjectPriority,
  ProjectMethodology,
  ProjectType,
  ProjectVisibility,
  ProjectWorkspace,
  ProjectMember,
  ProjectSection,
  WorkspaceTask,
  AssignedTask,
  TaskBreakdownRow,
  ProjectMilestone,
  AllMilestone,
  TaskTimeEntry,
  TaskComment,
  TaskChecklistItem,
  TaskAttachment,
  ProjectTaskStatus,
  ProjectTaskFilters,
  ProjectTaskFilterOptions,
  ResourcePlannerResponse,
  ResourcePlannerDayDetail,
  TeamProductivityReport,
  TeamMemberProductivityReport,
  ProjectPerformanceReport,
  TimeUtilisationReport,
  ChatChannel,
  ChatMessage,
  ChatUser,
  Notification,
  ChatChannelType,
} from "@/types/tenant";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4100/api";
export const AUTH_FAILURE_EVENT = "sourcecube-pms:auth-failed";
export const AUTH_FAILURE_STORAGE_KEY = "sourcecube-pms:last-auth-failure";

function notifyAuthFailure() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_FAILURE_EVENT));
  try {
    window.localStorage.setItem(AUTH_FAILURE_STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore private-mode/storage-disabled cases; same-tab event still works.
  }
}

export function isAuthFailureStatus(status: number) {
  return status === 401;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    if (isAuthFailureStatus(res.status)) notifyAuthFailure();
    throw new ApiError((body as { error?: string })?.error ?? "Request failed", res.status, body);
  }
  return body as T;
}

export const api = {
  getEmployeeInvitation: (token: string) =>
    request<{ invitation: { name: string; email: string; companyName: string; companyLogoUrl?: string | null; message?: string | null; expiresAt: string } }>(`/company-users/invitations/${token}`),
  acceptEmployeeInvitation: (token: string, password: string) =>
    request<{ user: CompanyUser }>(`/company-users/invitations/${token}/accept`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  loginPlatform: (email: string, password: string) =>
    request<{ user: unknown }>("/auth/login/platform", { method: "POST", body: JSON.stringify({ email, password }) }),
  loginCompany: (email: string, password: string) =>
    request<{ user: unknown; company: unknown }>("/auth/login/company", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: unknown; company?: unknown }>("/auth/me"),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<void>("/auth/change-password", { method: "POST", body: JSON.stringify(input) }),

  listCompanies: () => request<{ companies: Company[]; stats: CompanyStats }>("/companies"),
  getCompany: (id: string) => request<{ company: Company & { companyUsers: CompanyUser[] } }>(`/companies/${id}`),
  createCompany: (input: {
    name: string;
    code: string;
    domain?: string;
    country: string;
    timezone: string;
    currency: string;
    fiscalYearStart: string;
    plan: string;
    employeeSeatLimit: number;
    adminName: string;
    adminEmail: string;
  }) =>
    request<{ company: Company; adminUser: CompanyUser; inviteToken: string }>("/companies", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCompany: (id: string, input: Partial<Company>) =>
    request<{ company: Company }>(`/companies/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  setCompanyStatus: (id: string, status: CompanyStatus) =>
    request<{ company: Company }>(`/companies/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  generateCompanyUserPassword: (companyId: string, userId: string) =>
    request<{ email: string; password: string }>(`/companies/${companyId}/users/${userId}/generate-password`, {
      method: "POST",
    }),

  listAuditLogs: (params?: { tenantId?: string; action?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ logs: AuditLogEntry[] }>(`/audit${qs ? `?${qs}` : ""}`);
  },

  getOnboardingProgress: () => request<{ state: OnboardingState }>("/onboarding/progress"),

  updateCompanyProfile: (input: Partial<Pick<Company, "name" | "domain" | "logoUrl" | "country" | "timezone" | "currency" | "fiscalYearStart">>) =>
    request<{ company: Company }>("/onboarding/profile", { method: "PATCH", body: JSON.stringify(input) }),

  listSchedules: () => request<{ schedules: WorkingSchedule[] }>("/onboarding/schedules"),

  getResourcePlanner: (input: { start: string; end: string; search?: string; occupancy?: "all" | "occupied" | "unoccupied"; teamId?: string; employeeIds?: string }) => {
    const params = new URLSearchParams();
    Object.entries(input).forEach(([key, value]) => { if (value) params.set(key, value); });
    return request<ResourcePlannerResponse>(`/resources/planner?${params.toString()}`);
  },
  getResourcePlannerDay: (employeeId: string, date: string) =>
    request<ResourcePlannerDayDetail>(`/resources/planner/${employeeId}/day?date=${encodeURIComponent(date)}`),
  getTeamProductivityReport: (input: { start: string; end: string; teamId?: string; search?: string }) => {
    const params = new URLSearchParams();
    Object.entries(input).forEach(([key, value]) => { if (value) params.set(key, value); });
    return request<TeamProductivityReport>(`/reports/team-productivity?${params.toString()}`);
  },
  getTeamMemberProductivityReport: (teamId: string, input: { start: string; end: string; search?: string }) => {
    const params = new URLSearchParams();
    Object.entries(input).forEach(([key, value]) => { if (value) params.set(key, value); });
    return request<TeamMemberProductivityReport>(`/reports/team-productivity/${teamId}/members?${params.toString()}`);
  },
  getProjectPerformanceReport: (input: { start: string; end: string; search?: string }) => {
    const params = new URLSearchParams();
    Object.entries(input).forEach(([key, value]) => { if (value) params.set(key, value); });
    return request<ProjectPerformanceReport>(`/reports/project-performance?${params.toString()}`);
  },
  getTimeUtilisationReport: (input: { start: string; end: string; teamId?: string; search?: string; billable?: "all" | "billable" | "non_billable" }) => {
    const params = new URLSearchParams();
    Object.entries(input).forEach(([key, value]) => { if (value) params.set(key, value); });
    return request<TimeUtilisationReport>(`/reports/time-utilisation?${params.toString()}`);
  },
  saveSchedule: (input: { name?: string; workingDays: number[]; startTime: string; endTime: string; breakMinutes: number }) =>
    request<{ schedule: WorkingSchedule }>("/onboarding/schedules", { method: "POST", body: JSON.stringify(input) }),

  listDepartments: () => request<{ departments: Department[] }>("/onboarding/departments"),
  createDepartment: (name: string) =>
    request<{ department: Department }>("/onboarding/departments", { method: "POST", body: JSON.stringify({ name }) }),
  deleteDepartment: (id: string) => request<void>(`/onboarding/departments/${id}`, { method: "DELETE" }),

  listDesignations: () => request<{ designations: Designation[] }>("/onboarding/designations"),
  createDesignation: (title: string) =>
    request<{ designation: Designation }>("/onboarding/designations", { method: "POST", body: JSON.stringify({ title }) }),
  deleteDesignation: (id: string) => request<void>(`/onboarding/designations/${id}`, { method: "DELETE" }),

  listHolidays: () => request<{ holidays: Holiday[] }>("/onboarding/holidays"),
  createHoliday: (input: { name: string; date: string; type: HolidayType; optional: boolean }) =>
    request<{ holiday: Holiday }>("/onboarding/holidays", { method: "POST", body: JSON.stringify(input) }),
  deleteHoliday: (id: string) => request<void>(`/onboarding/holidays/${id}`, { method: "DELETE" }),

  listLeaveTypes: () => request<{ leaveTypes: LeaveType[] }>("/onboarding/leave-types"),
  createLeaveType: (input: { name: string; annualQuota: number; paid: boolean; carryForward: boolean }) =>
    request<{ leaveType: LeaveType }>("/onboarding/leave-types", { method: "POST", body: JSON.stringify(input) }),
  deleteLeaveType: (id: string) => request<void>(`/onboarding/leave-types/${id}`, { method: "DELETE" }),

  listCompanyUsers: () => request<{ users: CompanyUser[] }>("/company-users"),
  createCompanyUser: (input: {
    name: string;
    email: string;
    roles: SystemRole[];
    teamIds: string[];
    sendInvite: boolean;
    invitationMessage?: string | null;
  }) =>
    request<{ user: CompanyUser; inviteToken: string | null; inviteExpiresAt: string | null }>("/company-users", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  inviteCompanyUser: (id: string) =>
    request<{ token: string; expiresAt: string }>(`/company-users/${id}/invite`, { method: "POST" }),
  updateCompanyUserRoles: (id: string, roles: SystemRole[]) =>
    request<{ user: CompanyUser }>(`/company-users/${id}/roles`, { method: "PATCH", body: JSON.stringify({ roles }) }),
  updateCompanyUserStatus: (id: string, accountStatus: "active" | "suspended" | "deactivated") =>
    request<{ user: CompanyUser }>(`/company-users/${id}/status`, { method: "PATCH", body: JSON.stringify({ accountStatus }) }),
  deleteCompanyUser: (id: string) => request<void>(`/company-users/${id}`, { method: "DELETE" }),

  getSettings: () => request<{ company: Company }>("/settings"),
  updateSettings: (
    input: Partial<
      Pick<
        Company,
        | "name"
        | "domain"
        | "logoUrl"
        | "country"
        | "timezone"
        | "currency"
        | "fiscalYearStart"
        | "legalName"
        | "taxId"
        | "addressLine1"
        | "addressLine2"
        | "city"
        | "state"
        | "postalCode"
        | "contactEmail"
        | "contactPhone"
        | "dateFormat"
        | "weekStart"
      >
    >,
  ) => request<{ company: Company }>("/settings", { method: "PATCH", body: JSON.stringify(input) }),

  listDepartmentsFull: () => request<{ departments: Department[] }>("/departments"),
  createDepartmentFull: (input: {
    name: string;
    parentId?: string | null;
    headUserId?: string | null;
    costCenter?: string | null;
    budget?: number | null;
  }) => request<{ department: Department }>("/departments", { method: "POST", body: JSON.stringify(input) }),
  updateDepartment: (
    id: string,
    input: Partial<{ name: string; parentId: string | null; headUserId: string | null; costCenter: string | null; budget: number | null }>,
  ) => request<{ department: Department }>(`/departments/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  setDepartmentStatus: (id: string, isActive: boolean) =>
    request<{ department: Department }>(`/departments/${id}/status`, { method: "POST", body: JSON.stringify({ isActive }) }),

  listTeams: () => request<{ teams: Team[] }>("/teams"),
  getTeam: (id: string) => request<{ team: TeamDetail }>(`/teams/${id}`),
  createTeam: (input: { name: string; purpose?: string | null; leadUserId?: string | null; memberIds?: string[] }) =>
    request<{ team: Team }>("/teams", { method: "POST", body: JSON.stringify(input) }),
  updateTeam: (id: string, input: Partial<{ name: string; purpose: string | null; leadUserId: string | null; status: TeamStatus }>) =>
    request<{ team: Team }>(`/teams/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  addTeamMember: (teamId: string, userId: string) =>
    request<{ member: TeamMember }>(`/teams/${teamId}/members`, { method: "POST", body: JSON.stringify({ userId }) }),
  removeTeamMember: (teamId: string, userId: string) =>
    request<void>(`/teams/${teamId}/members/${userId}`, { method: "DELETE" }),
  replaceTeamMembers: (teamId: string, userIds: string[]) =>
    request<{ team: TeamDetail }>(`/teams/${teamId}/members`, { method: "PUT", body: JSON.stringify({ userIds }) }),

  listProjects: () => request<{ projects: RealProject[] }>("/projects"),
  getProject: (id: string) => request<{ project: RealProject }>(`/projects/${id}`),
  listAssignedTasks: () => request<{ tasks: AssignedTask[] }>("/projects/tasks/assigned"),
  getTaskBreakdown: () => request<{ employees: TaskBreakdownRow[] }>("/projects/tasks/breakdown"),
  createProject: (input: {
    name: string;
    key?: string;
    logoUrl?: string | null;
    clientName?: string | null;
    description?: string | null;
    status?: RealProjectStatus;
    priority?: ProjectPriority;
    methodology?: ProjectMethodology;
    type?: ProjectType;
    visibility?: ProjectVisibility;
    category?: string | null;
    tags?: string[];
    startDate?: string | null;
    dueDate?: string | null;
    estimatedHours?: number | null;
    budget?: number | null;
    departmentId?: string | null;
    ownerId?: string | null;
    managerId?: string | null;
    remindersEnabled?: boolean;
  }) => request<{ project: RealProject }>("/projects", { method: "POST", body: JSON.stringify(input) }),
  updateProject: (
    id: string,
    input: Partial<{
      name: string;
      key: string;
      logoUrl: string | null;
      clientName: string | null;
      description: string | null;
      status: RealProjectStatus;
      priority: ProjectPriority;
      methodology: ProjectMethodology;
      type: ProjectType;
      visibility: ProjectVisibility;
      category: string | null;
      tags: string[];
      startDate: string | null;
      dueDate: string | null;
      estimatedHours: number | null;
      budget: number | null;
      departmentId: string | null;
      ownerId: string | null;
      managerId: string | null;
      remindersEnabled: boolean;
    }>,
  ) => request<{ project: RealProject }>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  toggleProjectFavourite: (id: string) => request<{ favourite: boolean }>(`/projects/${id}/favourite`, { method: "POST" }),
  setProjectArchived: (id: string, isArchived: boolean) =>
    request<{ project: RealProject }>(`/projects/${id}/archive`, { method: "POST", body: JSON.stringify({ isArchived }) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  getProjectWorkspace: (id: string) => request<ProjectWorkspace>(`/projects/${id}/workspace`),
  listProjectEligibleUsers: (id: string) => request<{ users: CompanyUser[] }>(`/projects/${id}/eligible-users`),
  filterProjectTasks: (id: string, filters: ProjectTaskFilters) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
    });
    return request<{ tasks: WorkspaceTask[]; options: ProjectTaskFilterOptions }>(`/projects/${id}/tasks/query?${params.toString()}`);
  },
  createProjectSection: (projectId: string, input: { name: string; status?: ProjectTaskStatus }) =>
    request<{ section: ProjectSection }>(`/projects/${projectId}/sections`, { method: "POST", body: JSON.stringify(input) }),
  createProjectTask: (
    projectId: string,
    input: {
      name: string;
      sectionId: string;
      parentTaskId?: string | null;
      description?: string | null;
      assigneeId?: string | null;
      priority?: ProjectPriority;
      dueDate?: string | null;
      taskType?: string | null;
      billingType?: "billable" | "non_billable";
      tags?: string[];
      estimatedMinutes?: number;
    },
  ) =>
    request<{ task: WorkspaceTask }>(`/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProjectTask: (
    projectId: string,
    taskId: string,
    input: Partial<{
      name: string; description: string | null; assigneeId: string | null; followerIds: string[];
      status: ProjectTaskStatus; sectionId: string; progress: number; priority: ProjectPriority;
      startDate: string | null; dueDate: string | null; estimatedMinutes: number; taskType: string | null;
      billingType: "billable" | "non_billable"; milestoneId: string | null; tags: string[]; dependencyIds: string[];
    }>,
  ) => request<{ task: WorkspaceTask }>(`/projects/${projectId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteProjectTask: (projectId: string, taskId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}`, { method: "DELETE" }),
  addTaskComment: (projectId: string, taskId: string, body: string) =>
    request<{ comment: TaskComment }>(`/projects/${projectId}/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
  deleteTaskComment: (projectId: string, taskId: string, commentId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" }),
  addTaskChecklistItem: (projectId: string, taskId: string, text: string) =>
    request<{ item: TaskChecklistItem }>(`/projects/${projectId}/tasks/${taskId}/checklist`, { method: "POST", body: JSON.stringify({ text }) }),
  updateTaskChecklistItem: (projectId: string, taskId: string, itemId: string, input: { text?: string; completed?: boolean }) =>
    request<{ item: TaskChecklistItem }>(`/projects/${projectId}/tasks/${taskId}/checklist/${itemId}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteTaskChecklistItem: (projectId: string, taskId: string, itemId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}/checklist/${itemId}`, { method: "DELETE" }),
  addTaskAttachment: (projectId: string, taskId: string, input: { name: string; url: string; mimeType?: string | null; sizeBytes?: number | null }) =>
    request<{ attachment: TaskAttachment }>(`/projects/${projectId}/tasks/${taskId}/attachments`, { method: "POST", body: JSON.stringify(input) }),
  deleteTaskAttachment: (projectId: string, taskId: string, attachmentId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`, { method: "DELETE" }),
  moveProjectTask: (projectId: string, taskId: string, sectionId: string) =>
    request<{ task: WorkspaceTask }>(`/projects/${projectId}/tasks/${taskId}/move`, {
      method: "PATCH",
      body: JSON.stringify({ sectionId }),
    }),
  addProjectMember: (
    projectId: string,
    input: { userId: string; access?: "view" | "edit" | "manage"; isFollower?: boolean; allocationPercent?: number },
  ) =>
    request<{ member: ProjectMember }>(`/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createProjectMilestone: (
    projectId: string,
    input: {
      name: string;
      ownerId?: string | null;
      startDate?: string | null;
      releaseDate?: string | null;
      description?: string | null;
      tags?: string[];
    },
  ) =>
    request<{ milestone: ProjectMilestone }>(`/projects/${projectId}/milestones`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProjectMilestone: (
    projectId: string,
    milestoneId: string,
    input: Partial<{
      name: string;
      ownerId: string | null;
      startDate: string | null;
      releaseDate: string | null;
      description: string | null;
      tags: string[];
    }>,
  ) =>
    request<{ milestone: ProjectMilestone }>(`/projects/${projectId}/milestones/${milestoneId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteProjectMilestone: (projectId: string, milestoneId: string) =>
    request<void>(`/projects/${projectId}/milestones/${milestoneId}`, { method: "DELETE" }),
  listAllMilestones: () => request<{ milestones: AllMilestone[] }>("/projects/milestones/all"),
  getActiveTaskTimer: (projectId: string) =>
    request<{ entry: (TaskTimeEntry & { task?: { id: string; code: number; name: string; projectId: string }; project?: { id: string; name: string } }) | null }>(`/projects/${projectId}/timer/active`),
  startTaskTimer: (
    projectId: string,
    taskId: string,
    input?: { activityType?: string; billable?: boolean; note?: string | null },
  ) =>
    request<{ entry: TaskTimeEntry }>(`/projects/${projectId}/tasks/${taskId}/timer/start`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  stopTaskTimer: (
    projectId: string,
    taskId: string,
    input: { activityType: string; billable: boolean; note: string },
  ) =>
    request<{ entry: TaskTimeEntry; taskTrackedSeconds: number; projectTrackedSeconds: number }>(
      `/projects/${projectId}/tasks/${taskId}/timer/stop`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  discardTaskTimer: (projectId: string, taskId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}/timer`, { method: "DELETE" }),
  logTaskTime: (
    projectId: string,
    taskId: string,
    input: { date: string; durationMinutes: number; activityType: string; billable: boolean; note: string },
  ) =>
    request<{ entry: TaskTimeEntry; taskTrackedSeconds: number; projectTrackedSeconds: number }>(
      `/projects/${projectId}/tasks/${taskId}/timer/log`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  // ---- Chat ----
  listChatUsers: () => request<{ users: ChatUser[] }>("/chat/users"),
  listChatChannels: () => request<{ channels: ChatChannel[] }>("/chat/channels"),
  createChatChannel: (input: { type: Extract<ChatChannelType, "group" | "dm">; name?: string; description?: string | null; memberIds: string[] }) =>
    request<{ channel: ChatChannel }>("/chat/channels", { method: "POST", body: JSON.stringify(input) }),
  markChannelRead: (channelId: string) => request<{ ok: true }>(`/chat/channels/${channelId}/read`, { method: "POST" }),
  listChatMessages: (channelId: string, params?: { before?: string; parentMessageId?: string }) => {
    const query = new URLSearchParams();
    if (params?.before) query.set("before", params.before);
    if (params?.parentMessageId) query.set("parentMessageId", params.parentMessageId);
    const qs = query.toString();
    return request<{ messages: ChatMessage[] }>(`/chat/channels/${channelId}/messages${qs ? `?${qs}` : ""}`);
  },
  sendChatMessage: (
    channelId: string,
    input: {
      body?: string;
      parentMessageId?: string;
      isAnnouncement?: boolean;
      attachmentType?: "file" | "voice_note";
      attachmentUrl?: string;
      attachmentName?: string;
      durationSeconds?: number;
    },
  ) => request<{ message: ChatMessage }>(`/chat/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(input) }),
  editChatMessage: (messageId: string, body: string) =>
    request<{ message: ChatMessage }>(`/chat/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  deleteChatMessage: (messageId: string) => request<void>(`/chat/messages/${messageId}`, { method: "DELETE" }),
  addChatChannelMembers: (channelId: string, memberIds: string[]) =>
    request<{ channel: ChatChannel }>(`/chat/channels/${channelId}/members`, { method: "POST", body: JSON.stringify({ memberIds }) }),
  removeChatChannelMember: (channelId: string, userId: string) =>
    request<{ channel: ChatChannel }>(`/chat/channels/${channelId}/members/${userId}`, { method: "DELETE" }),
  setChatChannelFavorite: (channelId: string, isFavorite: boolean) =>
    request<{ ok: true }>(`/chat/channels/${channelId}/favorite`, { method: "PATCH", body: JSON.stringify({ isFavorite }) }),
  pinChatMessage: (messageId: string, isPinned: boolean) =>
    request<{ message: ChatMessage }>(`/chat/messages/${messageId}/pin`, { method: "PATCH", body: JSON.stringify({ isPinned }) }),
  addChatReaction: (messageId: string, emoji: string) =>
    request<{ message: ChatMessage }>(`/chat/messages/${messageId}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) }),
  removeChatReaction: (messageId: string, emoji: string) =>
    request<{ message: ChatMessage }>(`/chat/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: "DELETE" }),
  uploadChatFile: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/chat/upload`, { method: "POST", credentials: "include", body: formData });
    const body = await res.json().catch(() => undefined);
    if (!res.ok) {
      if (isAuthFailureStatus(res.status)) notifyAuthFailure();
      throw new ApiError((body as { error?: string })?.error ?? "Upload failed", res.status, body);
    }
    return body as { url: string; name: string; size: number };
  },
  listNotifications: () => request<{ notifications: Notification[] }>("/chat/notifications"),
  markNotificationRead: (id: string) => request<{ ok: true }>(`/chat/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () => request<{ ok: true }>("/chat/notifications/read-all", { method: "POST" }),
};
