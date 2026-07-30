import { Fragment, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  GitBranch,
  GripVertical,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Repeat,
  Zap,
} from "lucide-react";
import { Avatar, PriorityBadge, TaskStatusBadge } from "@/components/common";
import { cn } from "@/lib/cn";
import type { Task, TaskSection } from "@/types";

const columnHeaders = ["Task Name", "Assignee", "Created Date", "Due Date", "Status", "Priority"];

export function TaskListView({
  sections,
  search,
  onTaskClick,
}: {
  sections: TaskSection[];
  search: string;
  onTaskClick: (task: Task) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const term = search.trim().toLowerCase();
  const visibleSections = sections.map((section) => ({
    ...section,
    tasks: term ? section.tasks.filter((t) => t.name.toLowerCase().includes(term)) : section.tasks,
  }));

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-ink-200 bg-surface-subtle">
            {columnHeaders.map((header, i) => (
              <th
                key={header}
                className={cn(
                  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 whitespace-nowrap",
                  i === 0 && "min-w-72",
                )}
              >
                {header}
              </th>
            ))}
            <th className="w-12" />
          </tr>
        </thead>

        <tbody>
          {visibleSections.map((section) => {
            const isCollapsed = collapsed[section.id];
            return (
              <Fragment key={section.id}>
                <tr className="border-b border-ink-200 bg-surface-subtle/70">
                  <td colSpan={columnHeaders.length + 1} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <GripVertical size={15} className="cursor-grab text-ink-300" />
                      <button
                        onClick={() =>
                          setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))
                        }
                        className="rounded p-0.5 text-ink-500 hover:bg-ink-200/60"
                      >
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <span className="font-semibold text-ink-900">{section.name}</span>
                      <span className="text-xs font-medium text-ink-400">({section.tasks.length})</span>
                      <button className="rounded p-0.5 text-success-600 hover:bg-success-50">
                        <Plus size={15} />
                      </button>
                      <button className="rounded p-0.5 text-ink-400 hover:bg-ink-200/60">
                        <MoreHorizontal size={15} />
                      </button>

                      <div className="ml-auto flex items-center gap-2 text-xs text-ink-500">
                        <span>Section Owner:</span>
                        {section.owner ? (
                          <Avatar
                            initials={section.owner.initials}
                            color={section.owner.color}
                            size="xs"
                            title={section.owner.name}
                          />
                        ) : (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-100 text-ink-400">
                            <Plus size={12} />
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>

                {!isCollapsed &&
                  section.tasks.map((task) => (
                    <tr
                      key={task.id}
                      onClick={() => onTaskClick(task)}
                      className="group cursor-pointer border-b border-ink-100 transition-colors hover:bg-brand-50/40"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 shrink-0 text-xs font-medium text-ink-400">{task.code}</span>
                          <CircleDot
                            size={15}
                            className={cn(
                              "shrink-0",
                              task.status === "Done" ? "text-success-500" : "text-ink-300",
                            )}
                          />
                          <span className="truncate font-medium text-ink-900">{task.name}</span>

                          <span className="flex shrink-0 items-center gap-1.5 text-ink-400">
                            {task.commentCount ? <Chip icon={<MessageSquare size={11} />} value={task.commentCount} /> : null}
                            {task.attachmentCount ? <Chip icon={<Paperclip size={11} />} value={task.attachmentCount} /> : null}
                            {task.hasSubtasks ? <Chip icon={<GitBranch size={11} />} value={task.subtaskCount ?? 0} /> : null}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-2.5">
                        {task.assignee ? (
                          <div className="flex items-center gap-2">
                            <Avatar initials={task.assignee.initials} color={task.assignee.color} size="xs" />
                            <span className="truncate text-xs text-ink-700">{task.assignee.name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-400">Unassigned</span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-ink-600">{task.createdDate}</td>

                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 font-medium",
                            !task.dueDate
                              ? "text-ink-400"
                              : task.dueDate === "Today" || task.dueDate === "Tomorrow"
                                ? "text-success-600"
                                : "text-danger-600",
                          )}
                        >
                          {task.dueDate ?? "—"}
                          {task.isRecurring && <Repeat size={12} />}
                        </span>
                      </td>

                      <td className="px-4 py-2.5">
                        <TaskStatusBadge status={task.status} />
                      </td>

                      <td className="px-4 py-2.5">
                        <PriorityBadge priority={task.priority} />
                      </td>

                      <td className="px-2 py-2.5">
                        <button className="rounded p-1 text-ink-400 opacity-0 transition-opacity hover:bg-ink-100 group-hover:opacity-100">
                          <MoreHorizontal size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}

                {!isCollapsed && (
                  <tr className="border-b border-ink-100">
                    <td colSpan={columnHeaders.length + 1} className="px-4 py-2">
                      <button className="flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-brand-600">
                        <Plus size={14} />
                        <Zap size={13} className="text-warning-500" />
                        Add Task
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Chip({ icon, value }: { icon: React.ReactNode; value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
      {icon}
      {value}
    </span>
  );
}
