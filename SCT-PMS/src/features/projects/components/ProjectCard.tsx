import { Link } from "react-router-dom";
import { CalendarDays, MoreHorizontal, Star } from "lucide-react";
import { Avatar, DropdownMenu, ProgressBar, ProjectStatusBadge } from "@/components/common";
import { cn } from "@/lib/cn";
import type { Project } from "@/types";
import { projectWorkspacePath } from "../projectRoutes";

export function ProjectCard({
  project,
  onToggleFavourite,
}: {
  project: Project;
  onToggleFavourite: (id: string) => void;
}) {
  return (
    <div className="group relative rounded-card border border-ink-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover">
      <span className="absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-brand-500" />

      <div className="flex items-start gap-3">
        <Avatar initials={project.initials} color={project.color} size="lg" className="ring-0" />
        <div className="min-w-0 flex-1">
          <Link
            to={projectWorkspacePath(project)}
            className="block truncate text-sm font-semibold text-ink-900 hover:text-brand-600"
          >
            {project.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-ink-500">{project.clientName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => onToggleFavourite(project.id)}
            className="rounded p-1 text-ink-400 transition-colors hover:bg-ink-100"
          >
            <Star size={16} className={cn(project.favourite && "fill-warning-500 text-warning-500")} />
          </button>
          <DropdownMenu
            trigger={
              <button className="rounded p-1 text-ink-400 transition-colors hover:bg-ink-100">
                <MoreHorizontal size={16} />
              </button>
            }
            items={[
              { id: "details", label: "Project Details" },
              { id: "edit", label: "Edit Project" },
              { id: "clone", label: "Clone as Project" },
              { id: "archive", label: "Archive Project" },
              { id: "delete", label: "Delete Project", danger: true },
            ]}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="font-semibold text-success-600">{project.progress.toFixed(2)}%</span>
        <span className="font-medium text-ink-500">
          {project.tasksDone} / {project.tasksTotal}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <ProgressBar value={project.progress} className="flex-1" />
        <ProjectStatusBadge status={project.status} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
            project.status === "Overdue" ? "bg-danger-50 text-danger-600" : "bg-ink-100 text-ink-600",
          )}
        >
          <CalendarDays size={13} />
          Due: {project.dueDate}
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-success-500/30 bg-success-50 py-0.5 pl-2.5 pr-0.5 text-xs font-semibold text-success-600">
          PM
          <Avatar initials={project.manager.initials} color={project.manager.color} size="xs" />
        </span>
      </div>
    </div>
  );
}
