import { useEffect, useState, type FormEvent } from "react";
import { Building2, Save } from "lucide-react";
import { Badge, Button, Card, CompanyStatusBadge, Field, Input, Select, Tabs } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { usePermission } from "@/lib/session";
import type { Company, DateFormat } from "@/types/tenant";

const TABS = [
  { id: "branding", label: "Branding & regional" },
  { id: "legal", label: "Legal & contact" },
  { id: "localization", label: "Localization" },
  { id: "status", label: "Plan & status" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("branding");
  const canEdit = usePermission("company_settings", "manage");

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setCompany(res.company))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof Company>(key: K, value: Company[K]) {
    setCompany((c) => (c ? { ...c, [key]: value } : c));
    setSaved(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setError(null);
    setSaving(true);
    try {
      const res = await api.updateSettings({
        name: company.name,
        domain: company.domain ?? undefined,
        country: company.country,
        timezone: company.timezone,
        currency: company.currency,
        fiscalYearStart: company.fiscalYearStart,
        legalName: company.legalName ?? undefined,
        taxId: company.taxId ?? undefined,
        addressLine1: company.addressLine1 ?? undefined,
        addressLine2: company.addressLine2 ?? undefined,
        city: company.city ?? undefined,
        state: company.state ?? undefined,
        postalCode: company.postalCode ?? undefined,
        contactEmail: company.contactEmail ?? undefined,
        contactPhone: company.contactPhone ?? undefined,
        dateFormat: company.dateFormat,
        weekStart: company.weekStart,
      });
      setCompany(res.company);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (!company) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {error ?? "Failed to load company settings"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <Building2 size={20} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-ink-900">Company settings</h1>
          <p className="text-xs text-ink-500">{company.name} · {company.code}</p>
        </div>
      </div>

      <Card>
        <div className="border-b border-ink-200 px-2">
          <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-5 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
              {error}
            </div>
          )}
          {saved && !error && (
            <div className="mb-5 rounded-lg border border-success-200 bg-success-50 px-3.5 py-2.5 text-sm text-success-700">
              Settings saved.
            </div>
          )}

          {!canEdit && (
            <p className="mb-5 rounded-lg border border-ink-200 bg-surface-subtle px-3.5 py-2.5 text-xs text-ink-500">
              You have view-only access to company settings.
            </p>
          )}

          {activeTab === "branding" && (
            <div className="space-y-5">
              <Field label="Company name" required>
                <Input value={company.name} onChange={(e) => set("name", e.target.value)} disabled={!canEdit} required />
              </Field>
              <Field label="Domain">
                <Input value={company.domain ?? ""} onChange={(e) => set("domain", e.target.value)} disabled={!canEdit} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Country" required>
                  <Input value={company.country} onChange={(e) => set("country", e.target.value)} disabled={!canEdit} required />
                </Field>
                <Field label="Timezone" required>
                  <Input value={company.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={!canEdit} required />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Currency" required>
                  <Input
                    value={company.currency}
                    onChange={(e) => set("currency", e.target.value.toUpperCase())}
                    disabled={!canEdit}
                    required
                  />
                </Field>
                <Field label="Fiscal year start" hint="MM-DD" required>
                  <Input value={company.fiscalYearStart} onChange={(e) => set("fiscalYearStart", e.target.value)} disabled={!canEdit} required />
                </Field>
              </div>
            </div>
          )}

          {activeTab === "legal" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Legal / registered name">
                  <Input value={company.legalName ?? ""} onChange={(e) => set("legalName", e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="Tax ID">
                  <Input value={company.taxId ?? ""} onChange={(e) => set("taxId", e.target.value)} disabled={!canEdit} />
                </Field>
              </div>
              <Field label="Address line 1">
                <Input value={company.addressLine1 ?? ""} onChange={(e) => set("addressLine1", e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Address line 2">
                <Input value={company.addressLine2 ?? ""} onChange={(e) => set("addressLine2", e.target.value)} disabled={!canEdit} />
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="City">
                  <Input value={company.city ?? ""} onChange={(e) => set("city", e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="State / province">
                  <Input value={company.state ?? ""} onChange={(e) => set("state", e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="Postal code">
                  <Input value={company.postalCode ?? ""} onChange={(e) => set("postalCode", e.target.value)} disabled={!canEdit} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Contact email">
                  <Input
                    type="email"
                    value={company.contactEmail ?? ""}
                    onChange={(e) => set("contactEmail", e.target.value)}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Contact phone">
                  <Input value={company.contactPhone ?? ""} onChange={(e) => set("contactPhone", e.target.value)} disabled={!canEdit} />
                </Field>
              </div>
            </div>
          )}

          {activeTab === "localization" && (
            <div className="space-y-5">
              <Field label="Date format" required>
                <Select
                  value={company.dateFormat}
                  onChange={(e) => set("dateFormat", e.target.value as DateFormat)}
                  disabled={!canEdit}
                >
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </Select>
              </Field>
              <Field label="Week starts on" required>
                <Select value={String(company.weekStart)} onChange={(e) => set("weekStart", Number(e.target.value))} disabled={!canEdit}>
                  {WEEKDAYS.map((day, idx) => (
                    <option key={day} value={idx}>
                      {day}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          {activeTab === "status" && (
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-ink-200 p-4 text-sm">
              <StatusDetail label="Status" value={<CompanyStatusBadge status={company.status} />} />
              <StatusDetail label="Plan" value={<Badge tone="purple">{company.plan}</Badge>} />
              <StatusDetail
                label="Employee seats"
                value={`${company._count?.companyUsers ?? 0} / ${company.employeeSeatLimit}`}
              />
              <StatusDetail label="Enabled modules" value={company.enabledModules.join(", ") || "—"} />
              <p className="col-span-2 text-xs text-ink-500">
                Plan, seat limits and status are managed by the SaaS Super Admin and cannot be changed here.
              </p>
            </div>
          )}

          {canEdit && activeTab !== "status" && (
            <div className="mt-6 flex justify-end border-t border-ink-200 pt-5">
              <Button type="submit" disabled={saving}>
                <Save size={15} className="mr-1.5" />
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}

function StatusDetail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-0.5 font-medium text-ink-900">{value}</p>
    </div>
  );
}
