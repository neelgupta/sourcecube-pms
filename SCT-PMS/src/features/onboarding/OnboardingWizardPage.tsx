import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Calendar, CheckCircle2, Circle, Clock, Layers, PartyPopper, Users2 } from "lucide-react";
import { Button, Card } from "@/components/common";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Company, OnboardingState } from "@/types/tenant";
import { ProfileStep } from "./steps/ProfileStep";
import { ScheduleStep } from "./steps/ScheduleStep";
import { SimpleListStep } from "./steps/SimpleListStep";
import { HolidaysStep } from "./steps/HolidaysStep";
import { LeaveTypesStep } from "./steps/LeaveTypesStep";

const STEPS = [
  { key: "profile", label: "Company profile", icon: Building2 },
  { key: "schedule", label: "Working hours", icon: Clock },
  { key: "departments", label: "Departments", icon: Layers },
  { key: "designations", label: "Designations", icon: Users2 },
  { key: "holidays", label: "Holidays", icon: Calendar },
  { key: "leaveTypes", label: "Leave types", icon: PartyPopper },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const COMMON_DEPARTMENTS = ["Engineering", "Sales", "Marketing", "Human Resources", "Finance", "Operations"];
const COMMON_DESIGNATIONS = ["Software Engineer", "Project Manager", "Team Lead", "HR Executive", "Business Analyst"];

export function OnboardingWizardPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [activeStep, setActiveStep] = useState<StepKey>("profile");
  const [progress, setProgress] = useState<OnboardingState | null>(null);
  const [company, setCompany] = useState<Company | null>(session?.company ?? null);
  const [loading, setLoading] = useState(true);

  function loadProgress() {
    api
      .getOnboardingProgress()
      .then((res) => setProgress(res.state))
      .catch(() => {});
  }

  useEffect(() => {
    loadProgress();
    setLoading(false);
  }, []);

  const completedSteps = progress?.steps ?? {};
  const doneCount = STEPS.filter((s) => completedSteps[s.key]).length;
  const allDone = doneCount === STEPS.length;

  if (loading) return null;

  return (
    <div className="mx-auto flex h-full max-w-6xl gap-6 p-4 lg:p-6">
      <aside className="w-64 shrink-0">
        <Card className="p-4">
          <h1 className="mb-1 text-sm font-semibold text-ink-900">Company setup</h1>
          <p className="mb-4 text-xs text-ink-500">
            {doneCount} of {STEPS.length} steps complete
          </p>
          <nav className="space-y-1">
            {STEPS.map((step) => {
              const done = !!completedSteps[step.key];
              const active = activeStep === step.key;
              return (
                <button
                  key={step.key}
                  onClick={() => setActiveStep(step.key)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
                    active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100",
                  )}
                >
                  {done ? (
                    <CheckCircle2 size={16} className="shrink-0 text-success-600" />
                  ) : (
                    <Circle size={16} className="shrink-0 text-ink-300" />
                  )}
                  {step.label}
                </button>
              );
            })}
          </nav>

          {allDone && (
            <Button className="mt-4 w-full justify-center" onClick={() => navigate("/dashboard")}>
              Go to dashboard
            </Button>
          )}
        </Card>
      </aside>

      <div className="min-w-0 flex-1">
        <Card className="p-6">
          {activeStep === "profile" && company && (
            <ProfileStep
              company={company}
              onSaved={(c) => {
                setCompany(c);
                loadProgress();
                setActiveStep("schedule");
              }}
            />
          )}
          {activeStep === "schedule" && (
            <ScheduleStep
              onSaved={() => {
                loadProgress();
                setActiveStep("departments");
              }}
            />
          )}
          {activeStep === "departments" && (
            <SimpleListStep
              title="Initial departments"
              description="Create the departments employees will belong to. You can add more later."
              placeholder="e.g. Engineering"
              suggestions={COMMON_DEPARTMENTS}
              list={() => api.listDepartments().then((r) => r.departments.map((d) => ({ id: d.id, label: d.name })))}
              create={(name) => api.createDepartment(name).then(() => undefined)}
              remove={(id) => api.deleteDepartment(id)}
              onSaved={loadProgress}
            />
          )}
          {activeStep === "designations" && (
            <SimpleListStep
              title="Initial designations"
              description="Create job titles employees will be assigned. You can add more later."
              placeholder="e.g. Software Engineer"
              suggestions={COMMON_DESIGNATIONS}
              list={() => api.listDesignations().then((r) => r.designations.map((d) => ({ id: d.id, label: d.title })))}
              create={(title) => api.createDesignation(title).then(() => undefined)}
              remove={(id) => api.deleteDesignation(id)}
              onSaved={loadProgress}
            />
          )}
          {activeStep === "holidays" && <HolidaysStep onSaved={loadProgress} />}
          {activeStep === "leaveTypes" && <LeaveTypesStep onSaved={loadProgress} />}
        </Card>
      </div>
    </div>
  );
}
