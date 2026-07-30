import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import type { Priority, ProjectStatus, TaskStatus } from "@/types";
import type { CompanyStatus } from "@/types/tenant";

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "purple";

const tones: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  blue: "bg-info-50 text-info-600",
  green: "bg-success-50 text-success-600",
  amber: "bg-warning-50 text-warning-600",
  red: "bg-danger-50 text-danger-600",
  purple: "bg-purple-50 text-purple-600",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

const projectStatusTone: Record<ProjectStatus, Tone> = {
  "In Progress": "amber",
  Completed: "green",
  "On Hold": "neutral",
  "Not Started": "blue",
  Overdue: "red",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={projectStatusTone[status]}>{status}</Badge>;
}

const taskStatusTone: Record<TaskStatus, Tone> = {
  "To Do": "neutral",
  "In Progress": "blue",
  "In Review": "purple",
  Done: "green",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={taskStatusTone[status]}>{status}</Badge>;
}

const priorityTone: Record<Priority, Tone> = {
  Low: "neutral",
  Medium: "blue",
  High: "amber",
  Urgent: "red",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={priorityTone[priority]}>{priority}</Badge>;
}

const companyStatusTone: Record<CompanyStatus, Tone> = {
  provisioning: "neutral",
  invitation_pending: "amber",
  trial: "blue",
  active: "green",
  suspended: "red",
  deactivated: "neutral",
};

const companyStatusLabel: Record<CompanyStatus, string> = {
  provisioning: "Provisioning",
  invitation_pending: "Invitation pending",
  trial: "Trial",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  return <Badge tone={companyStatusTone[status]}>{companyStatusLabel[status]}</Badge>;
}
