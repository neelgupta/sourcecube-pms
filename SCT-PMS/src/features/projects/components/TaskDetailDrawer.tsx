import { useState } from "react";
import {
  Activity,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Flag,
  Hourglass,
  Link2,
  Navigation,
  Play,
  Receipt,
  Tag,
  User as UserIcon,
  Users,
} from "lucide-react";
import { Avatar, Badge, Button, Drawer, Tabs, type TabItem } from "@/components/common";
import { users } from "@/mock/users";
import type { Task } from "@/types";

const panelTabs: TabItem[] = [
  { id: "activities", label: "Activities", icon: <Activity size={15} /> },
  { id: "worklog", label: "Work Log", icon: <Clock size={15} /> },
  { id: "approval", label: "Approval", icon: <ClipboardCheck size={15} /> },
];

export function TaskDetailDrawer({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [panel, setPanel] = useState("activities");

  if (!task) return null;

  const activities = [
    `${users[0].name} created task.`,
    `${users[0].name} added task to ${task.projectName} project.`,
    `${users[0].name} added task to ${task.section} section.`,
    task.assignee ? `${users[0].name} assigned this task to ${task.assignee.name}.` : null,
    `${users[0].name} set billing type ${task.billable ? "Billable" : "Non-Billable"} to this task.`,
    `${users[0].name} added follower ${users[0].name}.`,
  ].filter(Boolean) as string[];

  return (
    <Drawer open={!!task} onClose={onClose} title={task.name} width="max-w-5xl">
      <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-surface-subtle px-4 py-3">
            <Badge tone="blue">{task.section}</Badge>
            <span className="text-xs text-ink-500">
              Task Progress <span className="ml-1 font-semibold text-ink-900">0%</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span className="rounded-md bg-white px-2.5 py-1 font-mono text-xs font-semibold text-ink-700 ring-1 ring-ink-200">
                00H:00M
              </span>
              <Button size="sm" className="bg-success-500 px-2.5 hover:bg-success-600">
                <Play size={14} className="fill-white" />
              </Button>
            </div>
          </div>

          <dl className="divide-y divide-ink-100 rounded-lg border border-ink-200">
            <Row icon={<Briefcase size={15} />} label="Project Name">
              <span className="font-medium text-ink-900">{task.projectName}</span>
            </Row>
            <Row icon={<UserIcon size={15} />} label="Assignee">
              {task.assignee ? (
                <span className="flex items-center gap-2">
                  <Avatar initials={task.assignee.initials} color={task.assignee.color} size="xs" />
                  {task.assignee.name}
                </span>
              ) : (
                <Muted>Unassigned</Muted>
              )}
            </Row>
            <Row icon={<CalendarDays size={15} />} label="Start Date">
              {task.startDate ?? <Muted>No Start Date</Muted>}
            </Row>
            <Row icon={<CalendarDays size={15} />} label="Due Date">
              {task.dueDate ?? <Muted>No Due Date</Muted>}
            </Row>
            <Row icon={<Hourglass size={15} />} label="Estimation Hours">
              <Muted>No hours</Muted>
            </Row>
            <Row icon={<Users size={15} />} label="Task Followers">
              <span className="flex items-center -space-x-2">
                {users.slice(0, 4).map((u) => (
                  <Avatar key={u.id} initials={u.initials} color={u.color} size="xs" title={u.name} />
                ))}
              </span>
            </Row>
            <Row icon={<Receipt size={15} />} label="Billing Type">
              <Badge tone={task.billable ? "green" : "neutral"}>
                {task.billable ? "Billable" : "Non-Billable"}
              </Badge>
            </Row>
            <Row icon={<Flag size={15} />} label="Milestone">
              <Muted>Select Milestone</Muted>
            </Row>
            <Row icon={<Navigation size={15} />} label="Task Status">
              <Badge tone="blue">{task.status}</Badge>
            </Row>
            <Row icon={<Tag size={15} />} label="Tags">
              {task.tags.length ? task.tags.join(", ") : <Muted>No Tags</Muted>}
            </Row>
            <Row icon={<Link2 size={15} />} label="Dependencies">
              <Muted>Select</Muted>
            </Row>
          </dl>

          <div>
            <p className="mb-2 text-sm font-medium text-ink-700">Description</p>
            <textarea
              placeholder="Please enter task description..."
              className="min-h-28 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        <div className="flex flex-col rounded-lg border border-ink-200">
          <Tabs tabs={panelTabs} activeId={panel} onChange={setPanel} className="border-b border-ink-200 px-2" />

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {panel === "activities" &&
              activities.map((line, i) => (
                <div key={i} className="flex gap-2.5">
                  <Avatar initials={users[0].initials} color={users[0].color} size="xs" />
                  <p className="text-xs leading-relaxed text-ink-700">
                    {line} <span className="text-ink-400">Just now</span>
                  </p>
                </div>
              ))}

            {panel === "worklog" && (
              <div className="rounded-lg border border-ink-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-900">{users[0].name}</span>
                  <span className="font-mono text-xs text-ink-500">00H:00M</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">Jul 28, 2026 11:17 AM — 11:17 AM · Coding</p>
              </div>
            )}

            {panel === "approval" && <p className="text-xs text-ink-500">No approvals requested yet.</p>}
          </div>

          <div className="border-t border-ink-200 p-3">
            <textarea
              placeholder="Please enter your Comment..."
              className="min-h-16 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm">
                Cancel
              </Button>
              <Button size="sm">Send</Button>
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-4 px-4 py-2.5 text-sm">
      <dt className="flex items-center gap-2.5 text-ink-500">
        {icon}
        {label}
      </dt>
      <dd className="text-ink-700">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-400">{children}</span>;
}
