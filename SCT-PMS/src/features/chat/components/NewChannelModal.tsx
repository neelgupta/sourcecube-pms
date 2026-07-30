import { useState } from "react";
import { Button, Field, Input, MemberAvatar, Modal } from "@/components/common";
import { ApiError } from "@/lib/api";
import type { ChatUser } from "@/types/tenant";


export function NewChannelModal({
  open,
  onClose,
  users,
  currentUserId,
  canCreateGroup,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  users: ChatUser[];
  currentUserId: string;
  canCreateGroup: boolean;
  onCreate: (input: { type: "group" | "dm"; name?: string; memberIds: string[] }) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherUsers = users.filter((user) => user.id !== currentUserId);
  const filtered = otherUsers.filter((user) => user.name.toLowerCase().includes(search.toLowerCase()));

  function toggle(userId: string) {
    if (mode === "dm") {
      setSelected([userId]);
      return;
    }
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  async function submit() {
    if (selected.length === 0) return;
    if (mode === "group" && !groupName.trim()) { setError("Give the group a name"); return; }
    setSaving(true);
    setError(null);
    try {
      await onCreate({ type: mode, name: mode === "group" ? groupName.trim() : undefined, memberIds: selected });
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the conversation");
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setSelected([]);
    setGroupName("");
    setSearch("");
    setError(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="New conversation" footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button onClick={submit} disabled={saving || selected.length === 0}>{saving ? "Creating..." : "Start"}</Button></>}>
      <div className="space-y-4">
        {canCreateGroup && (
          <div className="flex gap-2 rounded-lg bg-surface-subtle p-1">
            <button onClick={() => { setMode("dm"); setSelected([]); }} className={`flex-1 rounded-md py-1.5 text-sm font-medium ${mode === "dm" ? "bg-white shadow-sm" : "text-ink-500"}`}>Direct message</button>
            <button onClick={() => { setMode("group"); setSelected([]); }} className={`flex-1 rounded-md py-1.5 text-sm font-medium ${mode === "group" ? "bg-white shadow-sm" : "text-ink-500"}`}>Group</button>
          </div>
        )}
        {mode === "group" && <Field label="Group name" required><Input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Design Team" /></Field>}
        <Field label={mode === "dm" ? "Choose a person" : "Add members"}>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people..." />
        </Field>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-ink-200 p-1.5">
          {filtered.length === 0 ? (
            <p className="p-3 text-center text-sm text-ink-400">No matching people</p>
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
