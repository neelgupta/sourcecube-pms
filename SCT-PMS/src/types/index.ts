export type ID = string;

export interface User {
  id: ID;
  /** Owning company/tenant. All PMS records (Project, Task, Resource) inherit this via their User/assignee references. */
  tenantId: ID;
  name: string;
  role: string;
  email: string;
  avatarUrl?: string;
  initials: string;
  color: string;
}

export type ProjectStatus = "In Progress" | "Completed" | "On Hold" | "Not Started" | "Overdue";
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface Project {
  id: ID;
  name: string;
  clientName: string;
  progress: number;
  tasksDone: number;
  tasksTotal: number;
  status: ProjectStatus;
  dueDate: string;
  manager: User;
  favourite: boolean;
  color: string;
  initials: string;
}

export type TaskStatus = "To Do" | "In Progress" | "In Review" | "Done";

export interface Task {
  id: ID;
  code: string;
  name: string;
  section: string;
  projectId: ID;
  projectName: string;
  assignee?: User;
  createdDate: string;
  startDate?: string;
  dueDate?: string;
  completedDate?: string;
  status: TaskStatus;
  priority: Priority;
  tags: string[];
  billable: boolean;
  commentCount?: number;
  attachmentCount?: number;
  hasSubtasks?: boolean;
  subtaskCount?: number;
  isRecurring?: boolean;
}

export interface TaskSection {
  id: ID;
  name: string;
  taskCount: number;
  owner?: User;
  tasks: Task[];
}

export interface LeaderboardEntry {
  user: User;
  points: number;
  rank: number;
}

export interface TaskActivityPoint {
  day: string;
  value: number;
}

export interface StatCard {
  id: string;
  label: string;
  value: string | number;
  icon: string;
  accent: "blue" | "amber" | "green" | "purple" | "red";
}

export interface WidgetMetric {
  id: string;
  label: string;
  value: string | number;
}

export interface AssigneeTaskCount {
  name: string;
  count: number;
}

export interface PriorityTaskCount {
  priority: Priority;
  count: number;
}

export interface Resource {
  id: ID;
  name: string;
  employeeId: string;
  initials: string;
  color: string;
  projectsCount: number;
  allocated: number;
  capacity: number;
  dailyAllocation: Record<string, { allocated: number; capacity: number; note?: string }>;
}
