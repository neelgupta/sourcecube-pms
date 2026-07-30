import { useState } from "react";
import { Button, Field, Input, MemberAvatar, Modal } from "@/components/common";
import { ApiError } from "@/lib/api";
import type { ChatChannel, ChatUser } from "@/types/tenant";


export function AddMembersModal({
  open,
  onClose,
  channel,
  users,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  channel: ChatChannel;
  users: ChatUser[];
  onAdd: (memberIds: string[]) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingIds = new Set(channel.members.map((member) => member.userId));
  const candidates = users.filter((user) => !existingIds.has(user.id));
  const filtered = candidates.filter((user) => user.name.toLowerCase().includes(search.toLowerCase()));

  function toggle(userId: string) {
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  function close() {
    setSelected([]);
    setSearch("");
    setError(null);
    onClose();
  }

  async function submit() {
    if (selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(selected);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Members could not be added");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Add members to ${channel.name ?? "group"}`}
      footer={
        <>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={submit} disabled={saving || selected.length === 0}>{saving ? "Adding..." : "Add"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Add people">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people..." />
        </Field>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-ink-200 p-1.5">
          {filtered.length === 0 ? (
            <p className="p-3 text-center text-sm text-ink-400">{candidates.length === 0 ? "Everyone is already in this group" : "No matching people"}</p>
          ) : (
            filtered.map((user) => (
              <button key={user.id} onClick={() => toggle(user.id)} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${selected.includes(user.id) ? "bg-brand-50" : "hover:bg-ink-100/60"}`}>
                <MemberAvatar id={user.id} name={user.name} size="sm" status={user.accountStatus === "active" ? "active" : "inactive"} className="ring-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{user.name}</p>
                  <p className="truncate text-xs text-ink-400">{user.email}</p>
                </div>
                {selected.includes(user.id) && <span className="text-xs font-semibold text-brand-600">Selected</span>}
              </button>
            ))
          )}
        </div>
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>
    </Modal>
  );
}
