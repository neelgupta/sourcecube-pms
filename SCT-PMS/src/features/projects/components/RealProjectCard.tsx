import { CalendarDays, CheckSquare, MoreHorizontal, Star } from "lucide-react";
import { Avatar, DropdownMenu, ProgressBar, memberColor } from "@/components/common";
import { cn } from "@/lib/cn";
import { formatDateOnly } from "@/lib/formatDate";
import { useCompanyTimezone } from "@/lib/session";
import type { RealProject, RealProjectStatus } from "@/types/tenant";

const statusLabel: Record<RealProjectStatus, string> = {
  new: "New",
  planning: "Planning",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

const statusTone: Record<RealProjectStatus, string> = {
  new: "bg-info-50 text-info-600",
  planning: "bg-purple-50 text-purple-600",
  in_progress: "bg-warning-50 text-warning-600",
  on_hold: "bg-ink-100 text-ink-700",
  completed: "bg-success-50 text-success-600",
  cancelled: "bg-danger-50 text-danger-600",
};

function initialsOf(name: string) {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

interface Props {
  project: RealProject;
  onOpen: (project: RealProject) => void;
  onToggleFavourite: (id: string) => void;
  onDetails: (project: RealProject) => void;
  onEdit: (project: RealProject) => void;
  onArchiveToggle: (project: RealProject) => void;
  onDelete: (project: RealProject) => void;
  canEdit: boolean;
  canArchiveOrDelete: boolean;
}

export function RealProjectCard({
  project,
  onOpen,
  onToggleFavourite,
  onDetails,
  onEdit,
  onArchiveToggle,
  onDelete,
  canEdit,
  canArchiveOrDelete,
}: Props) {
  const progress = project.completionPercent;
  const timezone = useCompanyTimezone();
  const openProject = () => onOpen(project);


  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openProject}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProject();
        }
      }}
      className="group relative cursor-pointer rounded-card border border-ink-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover focus:outline-none focus:ring-2 focus:ring-brand-500/30"
    >
      <span className="absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-brand-500" />

      <div className="flex items-start gap-3">
        <Avatar initials={initialsOf(project.name)} color={memberColor(project.id)} size="lg" className="ring-0" />
        <div className="min-w-0 flex-1">
          <span className="block w-full truncate text-left text-sm font-semibold text-ink-900 transition-colors group-hover:text-brand-600">
            {project.name}
          </span>
          <p className="mt-0.5 truncate text-xs text-ink-500">{project.clientName || "No client set"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavourite(project.id);
            }}
            className="rounded p-1 text-ink-400 transition-colors hover:bg-ink-100"
          >
            <Star size={16} className={cn(project.favourite && "fill-warning-500 text-warning-500")} />
          </button>
          <DropdownMenu
            trigger={
              <button
                onClick={(event) => event.stopPropagation()}
                className="rounded p-1 text-ink-400 transition-colors hover:bg-ink-100"
              >
                <MoreHorizontal size={16} />
              </button>
            }
            items={[
              { id: "open", label: "Open Project", onSelect: () => onOpen(project) },
              { id: "details", label: "Project Details", onSelect: () => onDetails(project) },
              ...(canEdit ? [{ id: "edit", label: "Edit Project", onSelect: () => onEdit(project) }] : []),
              { id: "clone", label: "Clone as Project", disabled: true },
              ...(canArchiveOrDelete
                ? [
                    {
                      id: "archive",
                      label: project.isArchived ? "Unarchive Project" : "Archive Project",
                      onSelect: () => onArchiveToggle(project),
                    },
                    { id: "delete", label: "Delete Project", danger: true, onSelect: () => onDelete(project) },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="font-semibold text-success-600">{progress.toFixed(2)}%</span>
        <span className="flex items-center gap-1 font-medium text-ink-500">
          <CheckSquare size={12} />
          {project.completedTaskCount}/{project.taskCount}
        </span>
        <span className="font-medium capitalize text-ink-500">{project.healthStatus.replace("_", " ")}</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <ProgressBar value={progress} className="flex-1" />
        <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", statusTone[project.status])}>
          {statusLabel[project.status]}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
            project.dueDate && new Date(project.dueDate) < new Date() && project.status !== "completed"
              ? "bg-danger-50 text-danger-600"
              : "bg-ink-100 text-ink-600",
          )}
        >
          <CalendarDays size={13} />
          {project.dueDate ? `Due: ${formatDateOnly(project.dueDate, timezone)}` : "No due date"}
        </span>
        {project.manager ? (
          <span className="flex items-center gap-1.5 rounded-full border border-success-500/30 bg-success-50 py-0.5 pl-2.5 pr-0.5 text-xs font-semibold text-success-600">
            PM
            <Avatar initials={initialsOf(project.manager.name)} color="bg-success-600" size="xs" />
          </span>
        ) : (
          <span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-400">No PM</span>
        )}
      </div>
    </div>
  );
}
