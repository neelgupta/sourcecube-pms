import type { ID } from "./index";

/** Audit metadata every tenant-owned or platform-owned record carries. */
export interface AuditMetadata {
  createdBy: ID;
  createdAt: string;
  updatedBy: ID;
  updatedAt: string;
}

/** Mixin for any record that belongs to exactly one company/tenant. */
export interface TenantOwned {
  tenantId: ID;
}

export type CompanyStatus =
  | "provisioning"
  | "invitation_pending"
  | "trial"
  | "active"
  | "suspended"
  | "deactivated";

export type SubscriptionPlan = "starter" | "growth" | "enterprise";

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

export interface Company extends AuditMetadata {
  id: ID; // a company's own id doubles as its tenant id
  name: string;
  code: string;
  domain?: string | null;
  logoUrl?: string | null;
  country: string;
  timezone: string;
  currency: string;
  fiscalYearStart: string; // e.g. "04-01" (MM-DD)
  status: CompanyStatus;
  plan: SubscriptionPlan;
  employeeSeatLimit: number;
  enabledModules: string[];
  onboardingCompletedAt?: string | null;
  legalName?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  dateFormat: DateFormat;
  weekStart: number;
  _count?: { companyUsers: number };
}

export interface CompanyStats {
  total: number;
  active: number;
  trial: number;
  suspended: number;
  totalUsers: number;
}

/** Platform-level user. Not scoped to any tenant. */
export interface PlatformUser extends AuditMetadata {
  id: ID;
  name: string;
  email: string;
  initials: string;
  color: string;
  kind: "platform";
  role: "saas_super_admin";
}

export type CompanyUserAccountStatus =
  | "not_invited"
  | "invitation_pending"
  | "invite_expired"
  | "active"
  | "suspended"
  | "deactivated";

export type SystemRole =
  | "company_super_admin"
  | "hr_admin"
  | "department_head"
  | "team_lead"
  | "project_manager"
  | "employee"
  | "auditor";

/** A company-scoped login identity, distinct from the employee record it may be linked to. */
export interface CompanyUser extends TenantOwned, AuditMetadata {
  id: ID;
  tenantId: ID;
  name: string;
  email: string;
  kind: "company";
  roles: SystemRole[];
  accountStatus: CompanyUserAccountStatus;
  teamMemberships?: {
    team: Pick<Team, "id" | "name" | "status">;
  }[];
}

export interface AuditLogEntry {
  id: ID;
  tenantId?: ID | null;
  company?: { name: string; code: string } | null;
  actorId: ID;
  actorKind: "platform" | "company";
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface Department {
  id: ID;
  tenantId: ID;
  name: string;
  isActive: boolean;
  parentId?: ID | null;
  headUserId?: ID | null;
  headUser?: { id: ID; name: string; email: string } | null;
  costCenter?: string | null;
  budget?: number | string | null;
  _count?: { children: number };
  createdAt: string;
}

export interface Designation {
  id: ID;
  tenantId: ID;
  title: string;
  isActive: boolean;
  createdAt: string;
}

export type HolidayType = "national" | "regional" | "company";

export interface Holiday {
  id: ID;
  tenantId: ID;
  name: string;
  date: string;
  type: HolidayType;
  optional: boolean;
}

export interface LeaveType {
  id: ID;
  tenantId: ID;
  name: string;
  annualQuota: number;
  paid: boolean;
  carryForward: boolean;
  isActive: boolean;
}

export interface WorkingSchedule {
  id: ID;
  tenantId: ID;
  name: string;
  workingDays: number[];
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breakStartTime: string;
  breakEndTime: string;
}

export interface TeamProductivityMetrics {
  allocatedTasks: number;
  newTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  overdueTasks: number;
  projectsCount: number;
  plannedMinutes: number;
  trackedSeconds: number;
  completionRate: number;
  productivityPercent: number;
}

export interface TeamProductivityReport {
  range: { start: string; end: string; timezone: string };
  overall: TeamProductivityMetrics & { teamsCount: number };
  teams: Array<TeamProductivityMetrics & {
    id: ID;
    name: string;
    lead?: { id: ID; name: string } | null;
    memberCount: number;
    members: Array<{ id: ID; name: string }>;
    billableSeconds: number;
  }>;
  daily: Array<{
    date: string;
    allocatedTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    trackedSeconds: number;
    productivityPercent: number;
  }>;
  filterOptions: { teams: Array<{ id: ID; name: string }> };
  methodology: string;
}
export interface TeamMemberProductivityRow {
  id: ID;
  name: string;
  joinedAt: string;
  isLead: boolean;
  rank: number;
  projectsCount: number;
  assignedTasks: number;
  newTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  overdueTasks: number;
  plannedMinutes: number;
  trackedSeconds: number;
  billableSeconds: number;
  capacityMinutes: number;
  utilizationPercent: number;
  completionRate: number;
  productivityPercent: number;
}

export interface TeamMemberProductivityReport {
  range: { start: string; end: string; timezone: string };
  schedule: { name: string; workingDays: number[]; startTime: string; endTime: string; breakMinutes: number; dailyMinutes: number };
  team: { id: ID; name: string; purpose?: string | null; lead?: { id: ID; name: string } | null; memberCount: number; visibleMemberCount: number };
  summary: {
    membersCount: number;
    projectsCount: number;
    assignedTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    overdueTasks: number;
    plannedMinutes: number;
    trackedSeconds: number;
    capacityMinutes: number;
    productivityPercent: number;
    utilizationPercent: number;
  };
  ranking: TeamMemberProductivityRow[];
  members: TeamMemberProductivityRow[];
  methodology: string;
}

export interface ProjectPerformanceRow {
  id: ID;
  name: string;
  key: string;
  clientName?: string | null;
  status: RealProjectStatus;
  priority: ProjectPriority;
  manager?: { id: ID; name: string } | null;
  owner?: { id: ID; name: string } | null;
  startDate?: string | null;
  dueDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  completionPercent: number;
  healthScore?: number | null;
  healthStatus: ProjectHealthStatus;
  budget?: number | null;
  budgetSpent: number;
  budgetStatus: ProjectBudgetStatus;
  budgetUtilizationPercent?: number | null;
  estimatedHours?: number | null;
  trackedSeconds: number;
  totalTasks: number;
  completedTasks: number;
  milestonesCount: number;
  milestoneProgress?: number | null;
  isOverdue: boolean;
  daysRemaining?: number | null;
}

export interface ProjectPerformanceReport {
  range: { start: string; end: string };
  overall: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    onHoldProjects: number;
    overdueProjects: number;
    atRiskProjects: number;
    avgCompletionPercent: number;
    avgHealthScore?: number | null;
    totalBudget: number;
    totalBudgetSpent: number;
    totalTrackedSeconds: number;
  };
  statusBreakdown: Array<{ status: RealProjectStatus; count: number }>;
  completionTrend: Array<{ date: string; completed: number }>;
  projects: ProjectPerformanceRow[];
  methodology: string;
}

export interface TimeUtilisationMemberRow {
  id: ID;
  name: string;
  email: string;
  teams: Array<{ id: ID; name: string }>;
  capacityMinutes: number;
  workingDayCount: number;
  activeDays: number;
  idleDays: number;
  trackedSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  billablePercent: number;
  utilizationPercent: number;
  overtimeMinutes: number;
}

export interface TimeUtilisationReport {
  range: { start: string; end: string; timezone: string };
  schedule: { name: string; workingDays: number[]; startTime: string; endTime: string; breakMinutes: number; dailyMinutes: number };
  overall: {
    employeesCount: number;
    workingDayCount: number;
    totalCapacityMinutes: number;
    totalTrackedSeconds: number;
    totalBillableSeconds: number;
    totalNonBillableSeconds: number;
    billablePercent: number;
    utilizationPercent: number;
  };
  daily: Array<{ date: string; trackedSeconds: number; billableSeconds: number; utilizationPercent: number }>;
  members: TimeUtilisationMemberRow[];
  filterOptions: { teams: Array<{ id: ID; name: string }> };
  methodology: string;
}

export interface ResourcePlannerDay {
  date: string;
  label: string;
  isWorkingDay: boolean;
  isWeekend: boolean;
  holidayName?: string | null;
  capacityMinutes: number;
}

export interface ResourcePlannerDayValue {
  date: string;
  taskCount: number;
  completedTaskCount: number;
  plannedMinutes: number;
  trackedSeconds: number;
  plannedTrackedSeconds: number;
  extraPlannedSeconds: number;
  unplannedTrackedSeconds: number;
  remainingPlannedMinutes: number;
}

export interface ResourcePlannerEmployee {
  id: ID;
  name: string;
  email: string;
  employeeCode: string;
  teams: { id: ID; name: string }[];
  projectsCount: number;
  taskCount: number;
  incompleteTaskCount: number;
  hasTasks: boolean;
  totalCapacityMinutes: number;
  totalPlannedMinutes: number;
  totalTrackedSeconds: number;
  utilisationPercent: number;
  days: ResourcePlannerDayValue[];
}

export interface ResourcePlannerResponse {
  range: { start: string; end: string; timezone: string };
  schedule: { id?: ID | null; name: string; workingDays: number[]; startTime: string; endTime: string; breakMinutes: number; dailyMinutes: number };
  days: ResourcePlannerDay[];
  employees: ResourcePlannerEmployee[];
  filterOptions: { teams: { id: ID; name: string }[]; employees: { id: ID; name: string; email: string }[] };
}

export interface ResourcePlannerDayDetail {
  employee: { id: ID; name: string; email: string };
  date: string;
  holiday?: { name: string; optional: boolean } | null;
  capacityMinutes: number;
  plannedMinutes: number;
  trackedSeconds: number;
  plannedTrackedSeconds: number;
  extraPlannedSeconds: number;
  unplannedTrackedSeconds: number;
  remainingPlannedMinutes: number;
  tasks: Array<{
    id: ID; code: number; name: string; status: ProjectTaskStatus; progress: number; estimatedMinutes: number; trackedSeconds: number;
    remainingMinutes: number; overdueReviewStatus: "pending_review" | null;
    plannedMinutes: number; todayTrackedSeconds: number; extraTrackedSeconds: number; startDate?: string | null; dueDate?: string | null; completedAt?: string | null;
    hasExplicitAllocation: boolean; allocationNote?: string | null;
    project: { id: ID; name: string; key: string };
  }>;
  logs: Array<{
    id: ID; taskId: ID; projectId: ID; activityType: string; billable: boolean; startedAt: string; endedAt?: string | null;
    durationSeconds: number; effectiveDurationSeconds: number; note?: string | null;
    task: { id: ID; code: number; name: string; status: ProjectTaskStatus; progress: number };
    project: { id: ID; name: string; key: string };
  }>;
}

export interface TaskDailyAllocationEntry {
  taskId: ID;
  date: string;
  plannedMinutes: number;
  note?: string | null;
}

export interface TaskOverdueReview {
  id: ID;
  taskId: ID;
  triggeredAt: string;
  originalDueDate: string;
  reason?: string | null;
  reasonSubmittedAt?: string | null;
  reasonSubmittedBy?: ID | null;
  approverId: ID;
  status: "pending_review" | "resolved";
  resolvedAt?: string | null;
  resolvedBy?: ID | null;
  resolutionAction?: string | null;
  newEstimatedMinutes?: number | null;
  newDueDate?: string | null;
  createdAt: string;
  task: {
    id: ID; code: number; name: string; estimatedMinutes: number; trackedSeconds: number; dueDate?: string | null;
    assignee?: { id: ID; name: string; email: string } | null;
    project: { id: ID; name: string; key: string };
  };
}
export interface OnboardingState {
  tenantId: ID;
  steps: Record<string, boolean>;
  completedAt?: string | null;
}

export type TeamStatus = "active" | "inactive";

export interface TeamMemberSummary {
  id: ID;
  name: string;
  email: string;
  accountStatus: CompanyUserAccountStatus;
}

export interface Team {
  id: ID;
  tenantId: ID;
  name: string;
  purpose?: string | null;
  status: TeamStatus;
  leadUserId?: ID | null;
  leadUser?: TeamMemberSummary | null;
  _count?: { members: number };
  createdAt: string;
}

export interface TeamMember {
  id: ID;
  teamId: ID;
  userId: ID;
  user: TeamMemberSummary;
  joinedAt: string;
}

export interface TeamDetail extends Team {
  members: TeamMember[];
}

export type RealProjectStatus = "new" | "planning" | "in_progress" | "on_hold" | "completed" | "cancelled";
export type ProjectPriority = "low" | "medium" | "high" | "critical";
export type ProjectMethodology = "agile" | "waterfall" | "kanban";
export type ProjectType = "internal" | "client" | "product" | "support" | "maintenance";
export type ProjectVisibility = "public" | "private" | "restricted";
export type ProjectHealthStatus = "healthy" | "at_risk" | "critical" | "unavailable";
export type ProjectBudgetStatus = "not_set" | "on_track" | "warning" | "over_budget" | "closed";
export type ProjectTaskStatus = "new_request" | "in_progress" | "done";

/** A tenant-scoped project backed by the real API — distinct from the mock-data `Project` in types/index.ts
 *  used by the (still-mock) project detail/task views. */
export interface RealProject {
  id: ID;
  tenantId: ID;
  name: string;
  key: string;
  logoUrl?: string | null;
  clientName?: string | null;
  description?: string | null;
  status: RealProjectStatus;
  priority: ProjectPriority;
  methodology: ProjectMethodology;
  type: ProjectType;
  visibility: ProjectVisibility;
  category?: string | null;
  tags: string[];
  startDate?: string | null;
  dueDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  estimatedHours?: number | null;
  budget?: number | string | null;
  budgetSpent: number | string;
  budgetStatus: ProjectBudgetStatus;
  completionPercent: number;
  healthScore?: number | null;
  healthStatus: ProjectHealthStatus;
  remindersEnabled: boolean;
  trackedSeconds: number;
  managerId?: ID | null;
  manager?: TeamMemberSummary | null;
  ownerId?: ID | null;
  owner?: TeamMemberSummary | null;
  departmentId?: ID | null;
  department?: { id: ID; name: string } | null;
  favourite: boolean;
  currentUserAccess?: "view" | "edit" | "manage" | null;
  isArchived: boolean;
  createdAt: string;
  taskCount: number;
  completedTaskCount: number;
}

export interface ProjectMember {
  id: ID;
  userId: ID;
  access: "view" | "edit" | "manage";
  isFollower: boolean;
  allocationPercent: number;
  user: TeamMemberSummary;
}

export interface TaskFollower {
  id: ID;
  userId: ID;
  user: TeamMemberSummary;
  createdAt: string;
}

export interface TaskComment {
  id: ID;
  authorId: ID;
  author: TeamMemberSummary;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskChecklistItem {
  id: ID;
  text: string;
  completed: boolean;
  position: number;
  createdAt: string;
}

export interface TaskAttachment {
  id: ID;
  name: string;
  url: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uploadedBy?: ID | null;
  createdAt: string;
}

export interface TaskDependency {
  id: ID;
  dependsOnTaskId: ID;
  type: string;
  dependsOnTask: Pick<WorkspaceTask, "id" | "code" | "name" | "status">;
}
export interface WorkspaceTask {
  id: ID;
  code: number;
  name: string;
  description?: string | null;
  sectionId: ID;
  status: ProjectTaskStatus;
  progress: number;
  completedAt?: string | null;
  priority: ProjectPriority;
  taskType?: string | null;
  billingType: string;
  tags: string[];
  startDate?: string | null;
  dueDate?: string | null;
  estimatedMinutes: number;
  trackedMinutes: number;
  trackedSeconds: number;
  assigneeId?: ID | null;
  assignee?: TeamMemberSummary | null;
  milestoneId?: ID | null;
  position: number;
  parentTaskId?: ID | null;
  followers: TaskFollower[];
  comments: TaskComment[];
  checklistItems: TaskChecklistItem[];
  attachments: TaskAttachment[];
  dependencies: TaskDependency[];
  timeEntries: TaskTimeEntry[];
  createdAt: string;
  overdueReviewStatus?: "pending_review" | null;
}

export type ProjectTaskDueFilter = "overdue" | "today" | "this_week" | "no_date";

export interface ProjectTaskFilters {
  search?: string;
  incomplete?: boolean;
  assigneeId?: ID | "unassigned";
  tag?: string;
  priority?: ProjectPriority;
  status?: ProjectTaskStatus;
  taskType?: string;
  milestoneId?: ID | "none";
  due?: ProjectTaskDueFilter;
}

export interface ProjectTaskFilterOptions {
  tags: string[];
  taskTypes: string[];
}
export interface AssignedTask extends WorkspaceTask {
  project: Pick<RealProject, "id" | "name" | "key" | "status" | "priority">;
  section: { id: ID; name: string };
  createdBy?: ID | null;
  assigner?: TeamMemberSummary | null;
}

export interface TaskBreakdownRow {
  user: { id: ID; name: string; email: string };
  totalAssigned: number;
  pending: number;
  overdue: number;
  created: number;
  completed: number;
}
export interface TaskTimeEntry {
  id: ID;
  taskId: ID;
  projectId: ID;
  userId: ID;
  user: TeamMemberSummary;
  activityType: string;
  billable: boolean;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds: number;
  note?: string | null;
}

export interface ProjectSection {
  id: ID;
  name: string;
  status: ProjectTaskStatus;
  position: number;
  owner?: TeamMemberSummary | null;
  tasks: WorkspaceTask[];
}

export interface ProjectMilestone {
  id: ID;
  name: string;
  description?: string | null;
  owner?: TeamMemberSummary | null;
  startDate?: string | null;
  releaseDate?: string | null;
  progress: number;
  tags: string[];
  _count?: { tasks: number };
}

export interface AllMilestone {
  id: ID;
  name: string;
  description?: string | null;
  owner?: TeamMemberSummary | null;
  startDate?: string | null;
  releaseDate?: string | null;
  progress: number;
  tags: string[];
  project: { id: ID; name: string; key: string };
  taskCount: number;
  completedTaskCount: number;
  estimatedMinutes: number;
  trackedSeconds: number;
}

export interface ProjectWorkspace {
  project: RealProject;
  sections: ProjectSection[];
  members: ProjectMember[];
  milestones: ProjectMilestone[];
  activities: AuditLogEntry[];
}

export type PlatformOrCompanyUser = PlatformUser | CompanyUser;

export function isPlatformUser(user: PlatformOrCompanyUser): user is PlatformUser {
  return user.kind === "platform";
}

export function isCompanyUser(user: PlatformOrCompanyUser): user is CompanyUser {
  return user.kind === "company";
}

export type ChatChannelType = "project" | "group" | "dm" | "announcement";
export type ChatAttachmentType = "file" | "voice_note";
export type NotificationType = "mention" | "announcement" | "channel_invite" | "message";

export interface ChatUser {
  id: ID;
  name: string;
  email: string;
  accountStatus: CompanyUserAccountStatus;
  roles: SystemRole[];
}

export interface ChatChannelMember {
  id: ID;
  channelId: ID;
  userId: ID;
  user: TeamMemberSummary;
  isMuted: boolean;
  isFavorite?: boolean;
  lastReadAt?: string | null;
  joinedAt: string;
}

export interface ChatReaction {
  id: ID;
  messageId: ID;
  userId: ID;
  user: TeamMemberSummary;
  emoji: string;
  createdAt: string;
}

export interface ChatMessage {
  id: ID;
  tenantId: ID;
  channelId: ID;
  authorId: ID;
  author: TeamMemberSummary;
  parentMessageId?: ID | null;
  body?: string | null;
  attachmentType?: ChatAttachmentType | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  durationSeconds?: number | null;
  isAnnouncement: boolean;
  isSystem: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  editedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  reactions: ChatReaction[];
  mentions: { userId: ID }[];
  _count: { replies: number };
}

export interface ChatChannel {
  id: ID;
  tenantId: ID;
  type: ChatChannelType;
  name?: string | null;
  description?: string | null;
  projectId?: ID | null;
  project?: { id: ID; name: string; key: string } | null;
  createdBy?: ID | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  members: ChatChannelMember[];
  messages?: ChatMessage[];
  lastReadAt?: string | null;
  isFavorite?: boolean;
  unreadCount: number;
}

export interface Notification {
  id: ID;
  tenantId: ID;
  userId: ID;
  type: NotificationType;
  title: string;
  body?: string | null;
  channelId?: ID | null;
  messageId?: ID | null;
  actorId?: ID | null;
  readAt?: string | null;
  createdAt: string;
}
