import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Building2, Mail, Save, Send, Settings2 } from "lucide-react";
import { Badge, Button, Card, CompanyStatusBadge, Field, Input, Select, Tabs } from "@/components/common";
import { api, ApiError, type SmtpEmailSettings, type SmtpEmailSettingsInput, type SmtpSecurity } from "@/lib/api";
import { usePermission } from "@/lib/session";
import type { Company, DateFormat } from "@/types/tenant";

const TABS = [
  { id: "branding", label: "Branding & regional" },
  { id: "legal", label: "Legal & contact" },
  { id: "localization", label: "Localization" },
  { id: "smtp", label: "SMTP email" },
  { id: "status", label: "Plan & status" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULT_SMTP: SmtpEmailSettings = {
  tenantId: "",
  enabled: false,
  host: "",
  port: 587,
  security: "TLS",
  username: "",
  senderEmail: "",
  senderName: "",
  defaultRecipients: [],
  passwordSet: false,
  lastTestedAt: null,
  lastTestStatus: null,
  lastError: null,
};

export function SettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("branding");
  const [smtp, setSmtp] = useState<SmtpEmailSettings>(DEFAULT_SMTP);
  const [smtpRecipients, setSmtpRecipients] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpTestRecipient, setSmtpTestRecipient] = useState("");
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpMessage, setSmtpMessage] = useState<string | null>(null);
  const canEdit = usePermission("company_settings", "manage");

  useEffect(() => {
    api
      .getSettings()
      .then((res) => {
        setCompany(res.company);
        const nextSmtp = res.smtpSettings ?? DEFAULT_SMTP;
        setSmtp(nextSmtp);
        setSmtpRecipients(nextSmtp.defaultRecipients.join(", "));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof Company>(key: K, value: Company[K]) {
    setCompany((c) => (c ? { ...c, [key]: value } : c));
    setSaved(false);
  }

  function smtpSet<K extends keyof SmtpEmailSettings>(key: K, value: SmtpEmailSettings[K]) {
    setSmtp((current) => ({ ...current, [key]: value }));
    setSmtpMessage(null);
    setSaved(false);
  }

  function parseRecipients(value: string) {
    return value.split(/[;,\n]/).map((email) => email.trim()).filter(Boolean);
  }

  async function saveSmtpSettings() {
    if (!canEdit) return;
    setError(null);
    setSmtpMessage(null);
    setSmtpSaving(true);
    try {
      const input: SmtpEmailSettingsInput = {
        enabled: smtp.enabled,
        host: smtp.host?.trim() || null,
        port: smtp.port ? Number(smtp.port) : null,
        security: smtp.security,
        username: smtp.username?.trim() || null,
        senderEmail: smtp.senderEmail?.trim() || null,
        senderName: smtp.senderName?.trim() || null,
        defaultRecipients: parseRecipients(smtpRecipients),
      };
      if (smtpPassword.trim()) input.password = smtpPassword;
      const res = await api.updateSmtpSettings(input);
      const nextSmtp = res.smtpSettings ?? DEFAULT_SMTP;
      setSmtp(nextSmtp);
      setSmtpRecipients(nextSmtp.defaultRecipients.join(", "));
      setSmtpPassword("");
      setSmtpMessage("SMTP settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save SMTP settings");
    } finally {
      setSmtpSaving(false);
    }
  }

  async function testSmtpSettings() {
    if (!canEdit) return;
    setError(null);
    setSmtpMessage(null);
    setSmtpTesting(true);
    try {
      const res = await api.testSmtpSettings(smtpTestRecipient.trim() || undefined);
      const nextSmtp = res.smtpSettings ?? smtp;
      setSmtp(nextSmtp);
      setSmtpMessage("Test email sent successfully.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "SMTP test failed");
    } finally {
      setSmtpTesting(false);
    }
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
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Building2 size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-ink-900">Company setup & settings</h1>
            <p className="text-xs text-ink-500">{company.name} · {company.code}</p>
          </div>
        </div>
        <Link
          to="/onboarding"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 shadow-sm transition hover:bg-ink-50"
        >
          <Settings2 size={15} className="mr-1.5" />
          Setup checklist
        </Link>
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

          {activeTab === "smtp" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-ink-200 bg-surface-subtle p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Mail size={18} />
                  </div>
                  <div>
                    <p className="font-semibold text-ink-900">SMTP Email Settings</p>
                    <p className="mt-1 text-xs text-ink-500">Used to send employee invite links automatically when a new member is created or invited again.</p>
                  </div>
                </div>
              </div>

              {smtpMessage && <div className="rounded-lg border border-success-200 bg-success-50 px-3.5 py-2.5 text-sm text-success-700">{smtpMessage}</div>}

              <label className="flex items-center gap-3 text-sm font-medium text-ink-800">
                <input type="checkbox" checked={smtp.enabled} onChange={(e) => smtpSet("enabled", e.target.checked)} disabled={!canEdit} className="h-5 w-5 rounded border-ink-300 text-brand-600" />
                Enable SMTP notifications
              </label>

              <div className="grid gap-4 lg:grid-cols-3">
                <Field label="SMTP Host">
                  <Input value={smtp.host ?? ""} onChange={(e) => smtpSet("host", e.target.value)} disabled={!canEdit} placeholder="mail.sourcecubeindia.in" />
                </Field>
                <Field label="Port" hint="TLS: 587/2525, SSL: 465, NONE: 25">
                  <Input type="number" min="1" max="65535" value={smtp.port ?? ""} onChange={(e) => smtpSet("port", e.target.value ? Number(e.target.value) : null)} disabled={!canEdit} placeholder="587" />
                </Field>
                <Field label="Security Type">
                  <Select value={smtp.security} onChange={(e) => smtpSet("security", e.target.value as SmtpSecurity)} disabled={!canEdit}>
                    <option value="TLS">TLS / STARTTLS</option>
                    <option value="SSL">SSL</option>
                    <option value="NONE">None</option>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Field label="Username">
                  <Input value={smtp.username ?? ""} onChange={(e) => smtpSet("username", e.target.value)} disabled={!canEdit} placeholder="name@sourcecubeindia.in" />
                </Field>
                <Field label="Password" hint={smtp.passwordSet && !smtpPassword ? "Password saved. Leave blank to keep existing password." : undefined}>
                  <Input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} disabled={!canEdit} placeholder={smtp.passwordSet ? "Saved password" : "SMTP password"} autoComplete="new-password" />
                </Field>
                <Field label="Sender Email">
                  <Input type="email" value={smtp.senderEmail ?? ""} onChange={(e) => smtpSet("senderEmail", e.target.value)} disabled={!canEdit} placeholder="noreply@sourcecubeindia.in" />
                </Field>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Sender Name (Optional)">
                  <Input value={smtp.senderName ?? ""} onChange={(e) => smtpSet("senderName", e.target.value)} disabled={!canEdit} placeholder="Sourcecube PMS" />
                </Field>
                <Field label="Default Recipient Emails (Optional)" hint="Comma separated, used for SMTP test fallback.">
                  <Input value={smtpRecipients} onChange={(e) => { setSmtpRecipients(e.target.value); setSmtpMessage(null); }} disabled={!canEdit} placeholder="ops@sourcecubeindia.in, admin@sourcecube.in" />
                </Field>
              </div>

              <div className="rounded-xl border border-ink-200 p-4">
                <p className="text-sm font-semibold text-ink-900">Test SMTP</p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <Input type="email" value={smtpTestRecipient} onChange={(e) => setSmtpTestRecipient(e.target.value)} disabled={!canEdit || smtpTesting} placeholder="Send test to email" />
                  <Button type="button" variant="outline" onClick={testSmtpSettings} disabled={!canEdit || smtpTesting || smtpSaving}>
                    <Send size={15} className="mr-1.5" />
                    {smtpTesting ? "Sending..." : "Send test"}
                  </Button>
                </div>
                {smtp.lastTestStatus && <p className="mt-2 text-xs text-ink-500">Last test: {smtp.lastTestStatus}{smtp.lastTestedAt ? ` · ${new Date(smtp.lastTestedAt).toLocaleString()}` : ""}{smtp.lastError ? ` · ${smtp.lastError}` : ""}</p>}
              </div>

              {canEdit && (
                <div className="mt-6 flex justify-end border-t border-ink-200 pt-5">
                  <Button type="button" onClick={saveSmtpSettings} disabled={smtpSaving || smtpTesting}>
                    <Save size={15} className="mr-1.5" />
                    {smtpSaving ? "Saving..." : "Save SMTP settings"}
                  </Button>
                </div>
              )}
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

          {canEdit && activeTab !== "status" && activeTab !== "smtp" && (
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
