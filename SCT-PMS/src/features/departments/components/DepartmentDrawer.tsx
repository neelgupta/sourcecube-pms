import { useEffect, useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { Button, Drawer, Field, FilterSelect, Input } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { CompanyUser, Department } from "@/types/tenant";

interface Props {
  open: boolean;
  department: Department | null;
  departments: Department[];
  companyUsers: CompanyUser[];
  onClose: () => void;
  onSaved: () => void;
}

export function DepartmentDrawer({ open, department, departments, companyUsers, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [headUserId, setHeadUserId] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(department?.name ?? "");
    setParentId(department?.parentId ?? "");
    setHeadUserId(department?.headUserId ?? "");
    setCostCenter(department?.costCenter ?? "");
    setBudget(department?.budget != null ? String(department.budget) : "");
    setError(null);
  }, [open, department]);

  // A department can't be parented to itself or any of its own descendants.
  const eligibleParents = departments.filter((d) => {
    if (!department) return true;
    if (d.id === department.id) return false;
    let current: Department | undefined = d;
    const visited = new Set<string>();
    while (current?.parentId) {
      if (current.parentId === department.id) return false;
      if (visited.has(current.parentId)) break;
      visited.add(current.parentId);
      current = departments.find((x) => x.id === current!.parentId);
    }
    return true;
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name,
        parentId: parentId || null,
        headUserId: headUserId || null,
        costCenter: costCenter || null,
        budget: budget ? Number(budget) : null,
      };
      if (department) {
        await api.updateDepartment(department.id, payload);
      } else {
        await api.createDepartmentFull(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save department");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Building2 size={18} className="text-brand-600" />
          {department ? "Edit department" : "Create department"}
        </span>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : department ? "Save changes" : "Create department"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}

        <Field label="Department name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Parent department" hint="Leave unset for a top-level department">
          <FilterSelect
            value={parentId}
            onChange={setParentId}
            options={[
              { value: "", label: "None (top-level)" },
              ...eligibleParents.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </Field>

        <Field label="Department head">
          <FilterSelect
            value={headUserId}
            onChange={setHeadUserId}
            options={[
              { value: "", label: "Unassigned" },
              ...companyUsers.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
            ]}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cost center">
            <Input value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder="e.g. CC-101" />
          </Field>
          <Field label="Budget">
            <Input type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}
