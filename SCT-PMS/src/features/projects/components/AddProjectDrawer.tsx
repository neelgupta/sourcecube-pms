import { useEffect, useState, type FormEvent } from "react";
import { ImagePlus } from "lucide-react";
import { Button, Drawer, Field, Input, Select, Textarea } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type {
  CompanyUser,
  Department,
  ProjectMethodology,
  ProjectPriority,
  ProjectType,
  ProjectVisibility,
  RealProject,
  RealProjectStatus,
} from "@/types/tenant";

interface Props {
  open: boolean;
  companyUsers: CompanyUser[];
  departments: Department[];
  /** When set, the drawer edits this project instead of creating a new one. */
  editingProject?: RealProject | null;
  onClose: () => void;
  onSaved: () => void;
}

const emptyForm = {
  name: "",
  key: "",
  clientName: "",
  managerId: "",
  ownerId: "",
  departmentId: "",
  priority: "medium" as ProjectPriority,
  methodology: "kanban" as ProjectMethodology,
  type: "internal" as ProjectType,
  visibility: "private" as ProjectVisibility,
  startDate: "",
  dueDate: "",
  status: "new" as RealProjectStatus,
  estimatedHours: "",
  budget: "",
  category: "",
  tags: "",
  remindersEnabled: true,
  description: "",
};

function toDateInput(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

export function AddProjectDrawer({ open, companyUsers, departments, editingProject, onClose, onSaved }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = !!editingProject;

  useEffect(() => {
    if (!open) return;
    if (editingProject) {
      setForm({
        name: editingProject.name,
        key: editingProject.key,
        clientName: editingProject.clientName ?? "",
        managerId: editingProject.managerId ?? "",
        ownerId: editingProject.ownerId ?? "",
        departmentId: editingProject.departmentId ?? "",
        priority: editingProject.priority,
        methodology: editingProject.methodology,
        type: editingProject.type,
        visibility: editingProject.visibility,
        startDate: toDateInput(editingProject.startDate),
        dueDate: toDateInput(editingProject.dueDate),
        status: editingProject.status,
        estimatedHours: editingProject.estimatedHours != null ? String(editingProject.estimatedHours) : "",
        budget: editingProject.budget != null ? String(editingProject.budget) : "",
        category: editingProject.category ?? "",
        tags: editingProject.tags.join(", "),
        remindersEnabled: editingProject.remindersEnabled,
        description: editingProject.description ?? "",
      });
    } else {
      setForm(emptyForm);
    }
    setError(null);
  }, [open, editingProject]);

  function set<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        key: form.key || undefined,
        clientName: form.clientName || null,
        managerId: form.managerId || null,
        ownerId: form.ownerId || null,
        departmentId: form.departmentId || null,
        priority: form.priority,
        methodology: form.methodology,
        type: form.type,
        visibility: form.visibility,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        status: form.status,
        estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : null,
        budget: form.budget ? Number(form.budget) : null,
        category: form.category || null,
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        remindersEnabled: form.remindersEnabled,
        description: form.description || null,
      };
      if (isEditing) {
        await api.updateProject(editingProject.id, payload);
      } else {
        await api.createProject(payload);
      }
      setForm(emptyForm);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${isEditing ? "save" : "create"} project`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Project" : "Add Project"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !form.name.trim()}>
            {saving ? "Saving…" : isEditing ? "Save Changes" : "Create Project"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}

        <div className="flex items-start gap-4">
          <button
            type="button"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-ink-200 bg-surface-subtle text-ink-400 transition-colors hover:border-brand-400 hover:text-brand-500"
          >
            <ImagePlus size={22} />
          </button>
          <Field label="Project Name" required className="flex-1">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Enter project name"
              maxLength={150}
              required
            />
            <p className="text-right text-xs text-ink-400">{form.name.length} / 150</p>
          </Field>
        </div>

        <Field label="Client name">
          <Input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Enter client name" />
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Project Key" hint="Maximum 10 letters, numbers, - or _">
            <Input
              value={form.key}
              onChange={(e) => set("key", e.target.value.toUpperCase())}
              placeholder="Auto-generated"
              maxLength={10}
            />
          </Field>

          <Field label="Project Manager">
            <Select value={form.managerId} onChange={(e) => set("managerId", e.target.value)}>
              <option value="">Select Manager</option>
              {companyUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Project Owner">
            <Select value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
              <option value="">Current user</option>
              {companyUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Department">
            <Select value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
              <option value="">No department</option>
              {departments.filter((d) => d.isActive).map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Project Priority">
            <Select value={form.priority} onChange={(e) => set("priority", e.target.value as ProjectPriority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </Field>

          <Field label="Methodology">
            <Select value={form.methodology} onChange={(e) => set("methodology", e.target.value as ProjectMethodology)}>
              <option value="agile">Agile</option>
              <option value="kanban">Kanban</option>
              <option value="waterfall">Waterfall</option>
            </Select>
          </Field>

          <Field label="Project Type">
            <Select value={form.type} onChange={(e) => set("type", e.target.value as ProjectType)}>
              <option value="internal">Internal</option>
              <option value="client">Client</option>
              <option value="product">Product</option>
              <option value="support">Support</option>
              <option value="maintenance">Maintenance</option>
            </Select>
          </Field>

          <Field label="Visibility">
            <Select value={form.visibility} onChange={(e) => set("visibility", e.target.value as ProjectVisibility)}>
              <option value="private">Private</option>
              <option value="public">Public</option>
              <option value="restricted">Restricted</option>
            </Select>
          </Field>

          <Field label="Start Date">
            <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>

          <Field label="End Date">
            <Input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          </Field>

          <Field label="Project Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as RealProjectStatus)}>
              <option value="new">New</option>
              <option value="planning">Planning</option>
              <option value="in_progress">In Progress</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>

          <Field label="Estimated Hours">
            <Input
              type="number"
              min={0}
              value={form.estimatedHours}
              onChange={(e) => set("estimatedHours", e.target.value)}
              placeholder="No hours"
            />
          </Field>

          <Field label="Budget">
            <Input type="number" min={0} value={form.budget} onChange={(e) => set("budget", e.target.value)} placeholder="0.00" />
          </Field>

          <Field label="Category">
            <Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Client Delivery" />
          </Field>
        </div>

        <Field label="Tags" hint="Separate tags with commas">
          <Input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="design, priority-client" />
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={form.remindersEnabled}
            onChange={(e) => set("remindersEnabled", e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-brand-600"
          />
          Enable project and task reminders
        </label>

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Enter descriptions"
            maxLength={24000}
          />
          <p className="text-right text-xs text-ink-400">{form.description.length} / 24000</p>
        </Field>
      </form>
    </Drawer>
  );
}
