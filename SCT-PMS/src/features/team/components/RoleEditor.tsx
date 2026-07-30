import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button, Checkbox, Modal } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { CompanyUser, SystemRole } from "@/types/tenant";

const ALL_ROLES: { value: SystemRole; label: string }[] = [
  { value: "company_super_admin", label: "Company Super Admin" },
  { value: "hr_admin", label: "HR Admin" },
  { value: "department_head", label: "Department Head" },
  { value: "team_lead", label: "Team Lead" },
  { value: "project_manager", label: "Project Manager" },
  { value: "employee", label: "Employee" },
  { value: "auditor", label: "Auditor" },
];

export function RoleEditor({ user, onChanged }: { user: CompanyUser; onChanged: (user: CompanyUser) => void }) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<SystemRole[]>(user.roles);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(role: SystemRole) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const res = await api.updateCompanyUserRoles(user.id, roles);
      onChanged(res.user);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update roles");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setRoles(user.roles);
          setError(null);
          setOpen(true);
        }}
      >
        <Pencil size={13} className="mr-1.5" />
        Edit roles
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit roles — ${user.name}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || roles.length === 0}>
              {saving ? "Saving…" : "Save roles"}
            </Button>
          </>
        }
      >
        {error && (
          <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}
        <div className="space-y-2.5">
          {ALL_ROLES.map((r) => (
            <Checkbox key={r.value} label={r.label} checked={roles.includes(r.value)} onChange={() => toggle(r.value)} />
          ))}
        </div>
      </Modal>
    </>
  );
}
