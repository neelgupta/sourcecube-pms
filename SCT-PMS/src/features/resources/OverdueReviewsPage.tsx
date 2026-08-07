import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Clock } from "lucide-react";
import { Badge, Button, Card, DatePicker, EmployeePicker, Field, Input } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { projectWorkspacePath } from "@/features/projects/projectRoutes";
import { formatDateOnly, formatDateTime } from "@/lib/formatDate";
import { useCompanyTimezone } from "@/lib/session";
import type { CompanyUser, TaskOverdueReview, TaskReestimateRequest, TaskTimeEntryChangeRequest } from "@/types/tenant";

function hoursFromMinutes(minutes: number) {
  return (minutes / 60).toFixed(1).replace(/\.0$/, "");
}

function ReviewRow({ review, employees, onResolved }: { review: TaskOverdueReview; employees: CompanyUser[]; onResolved: (review: TaskOverdueReview) => void }) {
  const navigate = useNavigate();
  const timezone = useCompanyTimezone();
  const [resolving, setResolving] = useState(false);
  const [estimateHours, setEstimateHours] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [newAssigneeId, setNewAssigneeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackedMinutes = Math.round(review.task.trackedSeconds / 60);

  async function resolve() {
    const newEstimatedMinutes = estimateHours.trim() ? Math.round(Number(estimateHours) * 60) : undefined;
    if (!newEstimatedMinutes && !dueDate && !newAssigneeId) {
      setError("Provide a new estimate, a new due date, or a new assignee");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { review: updated } = await api.resolveOverdueReview(review.id, { newEstimatedMinutes, newDueDate: dueDate ?? undefined, newAssigneeId: newAssigneeId ?? undefined });
      onResolved(updated);
      setResolving(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve this review");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => navigate(projectWorkspacePath(review.task.project))} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-ink-900">#{review.task.code} {review.task.name}</p>
          <p className="text-xs text-ink-500">{review.task.project.key} · {review.task.project.name}</p>
        </button>
        <Badge tone="red">Overdue</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-ink-600 sm:grid-cols-4">
        <div><p className="text-ink-400">Assignee</p><p className="font-medium text-ink-800">{review.task.assignee?.name ?? "Unassigned"}</p></div>
        <div><p className="text-ink-400">Original due date</p><p className="font-medium text-ink-800">{formatDateOnly(review.originalDueDate, timezone)}</p></div>
        <div><p className="text-ink-400">Estimate</p><p className="font-medium text-ink-800">{hoursFromMinutes(review.task.estimatedMinutes)}h</p></div>
        <div><p className="text-ink-400">Logged</p><p className="font-medium text-ink-800">{hoursFromMinutes(trackedMinutes)}h</p></div>
      </div>
      <div className="mt-3 rounded-lg bg-surface-muted p-3">
        <p className="text-xs font-semibold text-ink-500">Assignee's reason</p>
        <p className="mt-1 text-sm text-ink-800">{review.reason ?? <span className="italic text-ink-400">Not submitted yet</span>}</p>
      </div>
      {resolving ? (
        <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
          <div className="flex gap-3">
            <Field label="New estimate (hours)" className="flex-1">
              <Input type="number" min="0" step="0.5" value={estimateHours} onChange={(event) => setEstimateHours(event.target.value)} placeholder={hoursFromMinutes(review.task.estimatedMinutes)} />
            </Field>
            <Field label="New due date" className="flex-1">
              <DatePicker value={dueDate} onChange={setDueDate} />
            </Field>
          </div>
          <Field label="Reassign to (optional)" hint="Leave unset to keep the current assignee">
            <EmployeePicker
              employees={employees}
              value={newAssigneeId}
              onChange={setNewAssigneeId}
              excludeIds={review.task.assignee ? [review.task.assignee.id] : []}
              allowClear
              clearLabel="Keep current assignee"
              placeholder="Keep current assignee"
            />
          </Field>
          {error && <p className="text-xs text-danger-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setResolving(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={resolve} disabled={saving}>{saving ? "Saving…" : "Resolve"}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex justify-end border-t border-ink-100 pt-3">
          <Button size="sm" onClick={() => setResolving(true)}>Re-estimate, reschedule, or reassign</Button>
        </div>
      )}
    </Card>
  );
}

function ReestimateRequestRow({ request, onResolved }: { request: TaskReestimateRequest; onResolved: (requestId: string) => void }) {
  const navigate = useNavigate();
  const [approvedHours, setApprovedHours] = useState(() => (request.requestedEstimatedMinutes / 60).toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const task = request.task;

  async function resolve(action: "approve" | "reject") {
    setSaving(true);
    setError(null);
    try {
      const approvedMinutes = action === "approve" && approvedHours.trim() ? Math.round(Number(approvedHours) * 60) : undefined;
      await api.resolveReestimateRequest(request.id, { action, approvedMinutes });
      onResolved(request.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve this request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => task && navigate(projectWorkspacePath(task.project))} className="min-w-0 flex-1 text-left" disabled={!task}>
          <p className="truncate text-sm font-semibold text-ink-900">#{task?.code} {task?.name}</p>
          <p className="text-xs text-ink-500">{task?.project.name} · {task?.assignee?.name ?? "Unassigned"}</p>
        </button>
        <Badge tone="amber">Re-estimate</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-ink-600">
        <div><p className="text-ink-400">Current estimate</p><p className="font-medium text-ink-800">{hoursFromMinutes(request.previousEstimatedMinutes)}h</p></div>
        <div><p className="text-ink-400">Requested</p><p className="font-medium text-ink-800">{hoursFromMinutes(request.requestedEstimatedMinutes)}h</p></div>
      </div>
      <div className="mt-3 rounded-lg bg-surface-muted p-3">
        <p className="text-xs font-semibold text-ink-500">Reason</p>
        <p className="mt-1 text-sm text-ink-800">{request.reason}</p>
      </div>
      <div className="mt-3 flex items-end gap-3 border-t border-ink-100 pt-3">
        <Field label="Approve at (hours)" className="flex-1">
          <Input type="number" min="0" step="0.5" value={approvedHours} onChange={(event) => setApprovedHours(event.target.value)} />
        </Field>
        {error && <p className="text-xs text-danger-600">{error}</p>}
        <Button size="sm" variant="outline" onClick={() => resolve("reject")} disabled={saving}>Reject</Button>
        <Button size="sm" onClick={() => resolve("approve")} disabled={saving}>{saving ? "Saving…" : "Approve"}</Button>
      </div>
    </Card>
  );
}

function TimelogChangeRequestRow({ request, onResolved }: { request: TaskTimeEntryChangeRequest; onResolved: (requestId: string) => void }) {
  const navigate = useNavigate();
  const timezone = useCompanyTimezone();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entry = request.entry;

  async function resolve(action: "approve" | "reject") {
    setSaving(true);
    setError(null);
    try {
      await api.resolveTimelogChangeRequest(request.id, action);
      onResolved(request.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve this request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => entry && navigate(projectWorkspacePath(entry.project))} className="min-w-0 flex-1 text-left" disabled={!entry}>
          <p className="truncate text-sm font-semibold text-ink-900">#{entry?.task.code} {entry?.task.name}</p>
          <p className="text-xs text-ink-500">{entry?.user.name} · {entry ? formatDateTime(entry.startedAt, timezone) : ""}</p>
        </button>
        <Badge tone="amber">Work log change</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-ink-600">
        <div><p className="text-ink-400">Current</p><p className="font-medium text-ink-800">{hoursFromMinutes(Math.round(request.previousDurationSeconds / 60))}h · {request.previousActivityType}</p></div>
        <div><p className="text-ink-400">Requested</p><p className="font-medium text-ink-800">{hoursFromMinutes(Math.round(request.requestedDurationSeconds / 60))}h · {request.requestedActivityType}</p></div>
      </div>
      <div className="mt-3 rounded-lg bg-surface-muted p-3">
        <p className="text-xs font-semibold text-ink-500">Reason</p>
        <p className="mt-1 text-sm text-ink-800">{request.reason}</p>
      </div>
      {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}
      <div className="mt-3 flex justify-end gap-2 border-t border-ink-100 pt-3">
        <Button size="sm" variant="outline" onClick={() => resolve("reject")} disabled={saving}>Reject</Button>
        <Button size="sm" onClick={() => resolve("approve")} disabled={saving}>{saving ? "Saving…" : "Approve"}</Button>
      </div>
    </Card>
  );
}

export function OverdueReviewsPage() {
  const [reviews, setReviews] = useState<TaskOverdueReview[]>([]);
  const [reestimateRequests, setReestimateRequests] = useState<TaskReestimateRequest[]>([]);
  const [timelogRequests, setTimelogRequests] = useState<TaskTimeEntryChangeRequest[]>([]);
  const [employees, setEmployees] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([api.listOverdueReviews(), api.listCompanyUsers(), api.listReestimateRequests(), api.listTimelogChangeRequests()])
      .then(([{ reviews: rows }, { users }, { requests: reestimates }, { requests: timelogs }]) => {
        setReviews(rows);
        setEmployees(users);
        setReestimateRequests(reestimates);
        setTimelogRequests(timelogs);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Approvals could not be loaded"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function onResolved(review: TaskOverdueReview) {
    setReviews((current) => current.filter((row) => row.id !== review.id));
  }
  function onReestimateResolved(requestId: string) {
    setReestimateRequests((current) => current.filter((row) => row.id !== requestId));
  }
  function onTimelogResolved(requestId: string) {
    setTimelogRequests((current) => current.filter((row) => row.id !== requestId));
  }

  const totalPending = reviews.length + reestimateRequests.length + timelogRequests.length;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle size={20} className="text-warning-600" />
        <h1 className="text-lg font-semibold text-ink-900">Approvals</h1>
      </div>
      {loading ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-danger-600">{error}</p>
      ) : totalPending === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">Nothing is awaiting your approval.</p>
      ) : (
        <div className="space-y-6">
          {reviews.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-700"><AlertTriangle size={15} className="text-warning-600" />Overdue task reviews</h2>
              <div className="space-y-3">
                {reviews.map((review) => <ReviewRow key={review.id} review={review} employees={employees} onResolved={onResolved} />)}
              </div>
            </section>
          )}
          {reestimateRequests.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-700"><Clock size={15} className="text-warning-600" />Re-estimate requests</h2>
              <div className="space-y-3">
                {reestimateRequests.map((request) => <ReestimateRequestRow key={request.id} request={request} onResolved={onReestimateResolved} />)}
              </div>
            </section>
          )}
          {timelogRequests.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-700"><Clock size={15} className="text-warning-600" />Work log change requests</h2>
              <div className="space-y-3">
                {timelogRequests.map((request) => <TimelogChangeRequestRow key={request.id} request={request} onResolved={onTimelogResolved} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
