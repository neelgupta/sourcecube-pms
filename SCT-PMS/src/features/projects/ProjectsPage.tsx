import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Download,
  Folder,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  DropdownMenu,
  FilterSelect,
  memberColor,
  Modal,
  SearchBar,
  type Column,
} from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { usePermission } from "@/lib/session";
import type { CompanyUser, Department, RealProject, RealProjectStatus } from "@/types/tenant";
import { RealProjectCard } from "./components/RealProjectCard";
import { AddProjectDrawer } from "./components/AddProjectDrawer";

const statusOptions: { value: string; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "new", label: "New" },
  { value: "planning", label: "Planning" },
  { value: "in_progress", label: "In Progress" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const statusLabel: Record<RealProjectStatus, string> = {
  new: "New",
  planning: "Planning",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

const statusBadgeTone: Record<RealProjectStatus, "neutral" | "blue" | "green" | "amber" | "red"> = {
  new: "blue",
  planning: "blue",
  in_progress: "amber",
  on_hold: "neutral",
  completed: "green",
  cancelled: "red",
};

function initialsOf(name: string) {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<RealProject[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailsProject, setDetailsProject] = useState<RealProject | null>(null);
  const [editingProject, setEditingProject] = useState<RealProject | null>(null);
  const [deletingProject, setDeletingProject] = useState<RealProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = usePermission("projects", "create");
  const canEdit = usePermission("projects", "edit");
  const canExport = usePermission("projects", "export");
  const canArchiveOrDelete = usePermission("projects", "deactivate");
  const canViewCompanyUsers = usePermission("company_users", "view");
  const canViewDepartments = usePermission("company_settings", "view");

  function load() {
    Promise.all([
      api.listProjects(),
      canViewCompanyUsers ? api.listCompanyUsers() : Promise.resolve({ users: [] as CompanyUser[] }),
      canViewDepartments ? api.listDepartmentsFull() : Promise.resolve({ departments: [] as Department[] }),
    ])
      .then(([projectRes, userRes, departmentRes]) => {
        setProjects(projectRes.projects);
        setCompanyUsers(userRes.users);
        setDepartments(departmentRes.departments);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load projects"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        const matchesSearch =
          !search ||
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.clientName ?? "").toLowerCase().includes(search.toLowerCase());
        const matchesStatus = status === "all" || p.status === (status as RealProjectStatus);
        return matchesSearch && matchesStatus;
      }),
    [projects, search, status],
  );

  const favourites = filtered.filter((p) => p.favourite);
  const others = filtered.filter((p) => !p.favourite);

  async function toggleFavourite(id: string) {
    const previous = projects;
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, favourite: !p.favourite } : p)));
    try {
      await api.toggleProjectFavourite(id);
    } catch (err) {
      setProjects(previous);
      setError(err instanceof ApiError ? err.message : "Failed to update favourite");
    }
  }

  async function handleArchiveToggle(project: RealProject) {
    try {
      await api.setProjectArchived(project.id, !project.isArchived);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update project");
    }
  }

  async function confirmDelete() {
    if (!deletingProject) return;
    setDeleting(true);
    try {
      await api.deleteProject(deletingProject.id);
      setDeletingProject(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete project");
    } finally {
      setDeleting(false);
    }
  }

  function openEdit(project: RealProject) {
    setEditingProject(project);
    setDrawerOpen(true);
  }

  const columns: Column<RealProject>[] = [
    {
      key: "name",
      header: "Project Name",
      render: (p) => (
        <div className="flex items-center gap-3">
          <Avatar initials={initialsOf(p.name)} color={memberColor(p.id)} size="sm" className="ring-0" />
          <div className="min-w-0">
            <button
              onClick={() => navigate(`/projects/${p.id}`)}
              className="block truncate text-left font-medium text-ink-900 hover:text-brand-600"
            >
              {p.name}
            </button>
            <p className="truncate text-xs text-ink-500">{p.clientName || "No client set"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge tone={statusBadgeTone[p.status]}>{statusLabel[p.status]}</Badge>,
    },
    {
      key: "priority",
      header: "Priority",
      render: (p) => <span className="text-xs capitalize">{p.priority}</span>,
    },
    {
      key: "due",
      header: "Due Date",
      render: (p) => <span className="text-xs">{p.dueDate ? new Date(p.dueDate).toLocaleDateString() : "—"}</span>,
    },
    {
      key: "manager",
      header: "Manager",
      render: (p) =>
        p.manager ? (
          <div className="flex items-center gap-2">
            <Avatar initials={initialsOf(p.manager.name)} color="bg-success-600" size="xs" />
            <span className="truncate text-xs">{p.manager.name}</span>
          </div>
        ) : (
          <span className="text-xs text-ink-400">Unassigned</span>
        ),
    },
    {
      key: "tasks",
      header: "Tasks",
      render: (p) => <span className="text-xs text-ink-600">{p.completedTaskCount}/{p.taskCount}</span>,
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      render: (p) => {
        const rowCanEdit = canEdit && (p.currentUserAccess === "edit" || p.currentUserAccess === "manage");
        const rowCanArchiveOrDelete = canArchiveOrDelete && p.currentUserAccess === "manage";
        return (
          <div className="flex items-center justify-end gap-0.5">
            <button onClick={() => toggleFavourite(p.id)} className="rounded p-1 text-ink-400 transition-colors hover:bg-ink-100">
              <Star size={15} className={p.favourite ? "fill-warning-500 text-warning-500" : ""} />
            </button>
            <DropdownMenu
              trigger={
                <button className="rounded p-1 text-ink-400 transition-colors hover:bg-ink-100">
                  <MoreHorizontal size={15} />
                </button>
              }
              items={[
                { id: "open", label: "Open Project", onSelect: () => navigate(`/projects/${p.id}`) },
                { id: "details", label: "Project Details", onSelect: () => setDetailsProject(p) },
                ...(rowCanEdit ? [{ id: "edit", label: "Edit Project", onSelect: () => openEdit(p) }] : []),
                { id: "clone", label: "Clone as Project", disabled: true },
                ...(rowCanArchiveOrDelete
                  ? [
                      { id: "archive", label: p.isArchived ? "Unarchive Project" : "Archive Project", onSelect: () => handleArchiveToggle(p) },
                      { id: "delete", label: "Delete Project", danger: true, onSelect: () => setDeletingProject(p) },
                    ]
                  : []),
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <p className="text-sm font-medium text-ink-700">
          <span className="text-lg font-bold text-ink-900">{filtered.length}</span> Projects
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search" className="w-48 sm:w-56" />

          <div className="flex items-center rounded-lg border border-ink-200 bg-white p-0.5">
            <ViewToggle active={view === "list"} onClick={() => setView("list")}>
              <List size={16} />
            </ViewToggle>
            <ViewToggle active={view === "grid"} onClick={() => setView("grid")}>
              <LayoutGrid size={16} />
            </ViewToggle>
          </div>

          <FilterSelect
            value={status}
            options={statusOptions}
            onChange={setStatus}
            icon={<SlidersHorizontal size={14} />}
            className="w-40"
          />

          {canExport && (
            <Button variant="outline" size="icon" title="Export">
              <Download size={16} />
            </Button>
          )}

          {canCreate && (
            <DropdownMenu
              trigger={
                <Button size="icon" title="Create">
                  <Plus size={18} />
                </Button>
              }
              items={[
                {
                  id: "project",
                  label: "Create Project",
                  onSelect: () => {
                    setEditingProject(null);
                    setDrawerOpen(true);
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      <div className="flex-1 p-4 lg:p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : view === "grid" ? (
          <div className="space-y-6">
            {favourites.length > 0 && (
              <section>
                <SectionHeading icon={<Star size={16} className="fill-warning-500 text-warning-500" />}>
                  Favourite Projects
                </SectionHeading>
                <ProjectGrid
                  projects={favourites}
                  onToggleFavourite={toggleFavourite}
                  onDetails={setDetailsProject}
                  onOpen={(project) => navigate(`/projects/${project.id}`)}
                  onEdit={openEdit}
                  onArchiveToggle={handleArchiveToggle}
                  onDelete={setDeletingProject}
                  canEdit={canEdit}
                  canArchiveOrDelete={canArchiveOrDelete}
                />
              </section>
            )}

            <section>
              <SectionHeading icon={<Folder size={16} className="text-brand-500" />}>All Projects</SectionHeading>
              <ProjectGrid
                projects={others}
                onToggleFavourite={toggleFavourite}
                onDetails={setDetailsProject}
                onOpen={(project) => navigate(`/projects/${project.id}`)}
                onEdit={openEdit}
                onArchiveToggle={handleArchiveToggle}
                onDelete={setDeletingProject}
                  canEdit={canEdit}
                  canArchiveOrDelete={canArchiveOrDelete}
                />
            </section>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <DataTable columns={columns} rows={filtered} rowKey={(p) => p.id} emptyMessage="No projects match your filters" />
          </Card>
        )}
      </div>

      <AddProjectDrawer
        open={drawerOpen}
        companyUsers={companyUsers}
        departments={departments}
        editingProject={editingProject}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />

      <Modal
        open={!!detailsProject}
        onClose={() => setDetailsProject(null)}
        title={detailsProject?.name ?? "Project Details"}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetailsProject(null)}>
              Close
            </Button>
            {canEdit && detailsProject && (detailsProject.currentUserAccess === "edit" || detailsProject.currentUserAccess === "manage") && (
              <Button
                onClick={() => {
                  setDetailsProject(null);
                  openEdit(detailsProject);
                }}
              >
                Edit Project
              </Button>
            )}
          </>
        }
      >
        {detailsProject && <ProjectDetails project={detailsProject} />}
      </Modal>

      <Modal
        open={!!deletingProject}
        onClose={() => setDeletingProject(null)}
        title={`Delete ${deletingProject?.name}?`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingProject(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Project"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This permanently deletes <strong>{deletingProject?.name}</strong> and cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function ProjectGrid({
  projects,
  onToggleFavourite,
  onDetails,
  onOpen,
  onEdit,
  onArchiveToggle,
  onDelete,
  canEdit,
  canArchiveOrDelete,
}: {
  projects: RealProject[];
  onToggleFavourite: (id: string) => void;
  onDetails: (project: RealProject) => void;
  onOpen: (project: RealProject) => void;
  onEdit: (project: RealProject) => void;
  onArchiveToggle: (project: RealProject) => void;
  onDelete: (project: RealProject) => void;
  canEdit: boolean;
  canArchiveOrDelete: boolean;
}) {
  if (projects.length === 0) {
    return <Card className="px-6 py-10 text-center text-sm text-ink-500">No projects match your filters</Card>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {projects.map((p) => (
        <RealProjectCard
          key={p.id}
          project={p}
          onToggleFavourite={onToggleFavourite}
          onDetails={onDetails}
          onOpen={onOpen}
          onEdit={onEdit}
          onArchiveToggle={onArchiveToggle}
          onDelete={onDelete}
          canEdit={canEdit && (p.currentUserAccess === "edit" || p.currentUserAccess === "manage")}
          canArchiveOrDelete={canArchiveOrDelete && p.currentUserAccess === "manage"}
        />
      ))}
    </div>
  );
}

function ProjectDetails({ project }: { project: RealProject }) {
  const fields = [
    ["Client", project.clientName || "Not set"],
    ["Status", statusLabel[project.status]],
    ["Priority", project.priority[0].toUpperCase() + project.priority.slice(1)],
    ["Project Manager", project.manager?.name || "Unassigned"],
    ["Start Date", project.startDate ? new Date(project.startDate).toLocaleDateString() : "Not set"],
    ["Due Date", project.dueDate ? new Date(project.dueDate).toLocaleDateString() : "Not set"],
    ["Estimated Hours", project.estimatedHours != null ? String(project.estimatedHours) : "Not set"],
  ];

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
            <dd className="mt-1 text-sm text-ink-800">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Description</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{project.description || "No description provided."}</p>
      </div>
    </div>
  );
}

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900">
      {icon}
      {children}
    </h2>
  );
}

function ViewToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={active ? "rounded-md bg-brand-600 p-1.5 text-white" : "rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-100"}
    >
      {children}
    </button>
  );
}
