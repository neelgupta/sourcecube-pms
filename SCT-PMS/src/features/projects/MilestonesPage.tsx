import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, DatePicker, Field, Input, MemberAvatar, Modal, Select, Textarea } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { usePermission, useCompanyTimezone } from "@/lib/session";
import { formatDateOnly } from "@/lib/formatDate";
import type { AllMilestone, CompanyUser } from "@/types/tenant";
import { projectWorkspacePath } from "./projectRoutes";

function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}H:${String(mins).padStart(2, "0")}M`;
}

function formatTracked(seconds: number) {
  return formatHours(Math.round(seconds / 60));
}

export function MilestonesPage() {
  const navigate = useNavigate();
  const timezone = useCompanyTimezone();
  const canEdit = usePermission("projects", "edit");
  const [milestones, setMilestones] = useState<AllMilestone[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingMilestone, setEditingMilestone] = useState<AllMilestone | null>(null);
  const [deletingMilestone, setDeletingMilestone] = useState<AllMilestone | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([api.listAllMilestones(), canEdit ? api.listCompanyUsers() : Promise.resolve({ users: [] as CompanyUser[] })])
      .then(([milestoneRes, userRes]) => {
        setMilestones(milestoneRes.milestones);
        setCompanyUsers(userRes.users);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Milestones could not be loaded"))
      .finally(() => setLoading(false));
  }
  useEffect(load, [canEdit]);

  const filtered = useMemo(
    () => milestones.filter((m) => !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.project.name.toLowerCase().includes(search.toLowerCase())),
    [milestones, search],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { project: AllMilestone["project"]; rows: AllMilestone[] }>();
    for (const milestone of filtered) {
      const entry = map.get(milestone.project.id) ?? { project: milestone.project, rows: [] };
      entry.rows.push(milestone);
      map.set(milestone.project.id, entry);
    }
    return [...map.values()];
  }, [filtered]);

  async function confirmDelete() {
    if (!deletingMilestone) return;
    setDeleting(true);
    try {
      await api.deleteProjectMilestone(deletingMilestone.project.id, deletingMilestone.id);
      setDeletingMilestone(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Milestone could not be deleted");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <p className="text-sm font-medium text-ink-700">
          <span className="text-lg font-bold text-ink-900">{filtered.length}</span> Milestones
        </p>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search milestones or projects" className="w-64" />
      </div>

      <div className="flex-1 overflow-auto p-4 lg:p-6">
        {error && <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : grouped.length === 0 ? (
          <Card className="px-6 py-10 text-center text-sm text-ink-500">No milestones found</Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-surface-subtle">
                  {["Milestone Name", "Owner", "Start Date", "Release Date", "Progress", "Total Task", "Tracked / Estimation Hours", "Tags", "Description", ""].map((header) => (
                    <th key={header} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-ink-600">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ project, rows }) => (
                  <Fragment key={project.id}>
                    <tr className="border-b border-ink-200 bg-surface-muted">
                      <td colSpan={10} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                        <Flag size={12} className="mr-1.5 inline text-brand-500" />
                        {project.name} <span className="ml-1 font-normal normal-case text-ink-400">({rows.length})</span>
                      </td>
                    </tr>
                    {rows.map((milestone) => (
                      <tr
                        key={milestone.id}
                        className="cursor-pointer border-b border-ink-100 hover:bg-brand-50/30"
                        onClick={() => navigate(`${projectWorkspacePath(project)}?view=milestones`)}
                      >
                        <td className="px-4 py-3 font-medium text-ink-900">{milestone.name}</td>
                        <td className="px-4 py-3">
                          {milestone.owner ? (
                            <span className="flex items-center gap-2"><MemberAvatar id={milestone.owner.id} name={milestone.owner.name} size="xs" />{milestone.owner.name}</span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 text-ink-600">{milestone.startDate ? formatDateOnly(milestone.startDate, timezone) : "—"}</td>
                        <td className="px-4 py-3 text-ink-600">{milestone.releaseDate ? formatDateOnly(milestone.releaseDate, timezone) : "—"}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-brand-500 text-[10px] font-semibold">{milestone.progress}%</span>
                        </td>
                        <td className="px-4 py-3 text-ink-600">{milestone.completedTaskCount}/{milestone.taskCount}</td>
                        <td className="px-4 py-3 text-ink-600">{formatTracked(milestone.trackedSeconds)} / {formatHours(milestone.estimatedMinutes)}</td>
                        <td className="px-4 py-3">
                          {milestone.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">{milestone.tags.map((tag) => <Badge key={tag} tone="blue">{tag}</Badge>)}</div>
                          ) : "—"}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-ink-500">{milestone.description || "—"}</td>
                        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                          {canEdit && (
                            <div className="flex items-center gap-0.5">
                              <button onClick={() => setEditingMilestone(milestone)} title="Edit milestone" className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900">
                                <Pencil size={14} />
                              </button>
                              <button onClick={() => setDeletingMilestone(milestone)} title="Delete milestone" className="rounded p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <MilestoneEditModal
        milestone={editingMilestone}
        companyUsers={companyUsers}
        onClose={() => setEditingMilestone(null)}
        onSaved={() => { setEditingMilestone(null); load(); }}
      />

      <Modal
        open={!!deletingMilestone}
        onClose={() => setDeletingMilestone(null)}
        title={`Delete ${deletingMilestone?.name}?`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingMilestone(null)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete Milestone"}</Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This permanently deletes <strong>{deletingMilestone?.name}</strong>. Tasks linked to it will keep their history but lose this milestone reference.
        </p>
      </Modal>
    </div>
  );
}

function MilestoneEditModal({
  milestone,
  companyUsers,
  onClose,
  onSaved,
}: {
  milestone: AllMilestone | null;
  companyUsers: CompanyUser[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!milestone) return;
    setName(milestone.name);
    setOwnerId(milestone.owner?.id ?? "");
    setStartDate(milestone.startDate ? milestone.startDate.slice(0, 10) : "");
    setReleaseDate(milestone.releaseDate ? milestone.releaseDate.slice(0, 10) : "");
    setDescription(milestone.description ?? "");
    setTags(milestone.tags.join(", "));
    setError(null);
  }, [milestone]);

  async function save() {
    if (!milestone || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateProjectMilestone(milestone.project.id, milestone.id, {
        name: name.trim(),
        ownerId: ownerId || null,
        startDate: startDate || null,
        releaseDate: releaseDate || null,
        description: description.trim() || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Milestone could not be updated");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!milestone}
      onClose={onClose}
      title="Edit milestone"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Milestone name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Owner">
          <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">No owner</option>
            {companyUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><DatePicker value={startDate} onChange={(value) => setStartDate(value ?? "")} max={releaseDate || null} /></Field>
          <Field label="Release date"><DatePicker value={releaseDate} onChange={(value) => setReleaseDate(value ?? "")} min={startDate || null} /></Field>
        </div>
        <Field label="Tags (comma separated)"><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Design, Paid" /></Field>
        <Field label="Description"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></Field>
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>
    </Modal>
  );
}
