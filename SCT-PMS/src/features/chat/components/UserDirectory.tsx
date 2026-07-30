import { useMemo, useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import { Badge, MemberAvatar } from "@/components/common";
import type { ChatUser } from "@/types/tenant";


const roleLabels: Record<string, string> = {
  company_super_admin: "Super Admin",
  hr_admin: "HR Admin",
  department_head: "Department Head",
  team_lead: "Team Lead",
  project_manager: "Project Manager",
  employee: "Employee",
  auditor: "Auditor",
};

export function UserDirectory({
  users,
  currentUserId,
  onlineUserIds,
  onStartDirectMessage,
}: {
  users: ChatUser[];
  currentUserId: string;
  onlineUserIds: Set<string>;
  onStartDirectMessage: (userId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () => users.filter((user) => user.name.toLowerCase().includes(search.toLowerCase()) || user.email.toLowerCase().includes(search.toLowerCase())),
    [users, search],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="border-b border-ink-200 px-4 py-3">
        <p className="font-semibold text-ink-900">All Users</p>
        <div className="relative mt-2 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people..." className="h-9 w-full rounded-lg border border-ink-200 pl-8 pr-3 text-sm outline-none focus:border-brand-500" />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((user) => (
            <div key={user.id} className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-3">
              <MemberAvatar id={user.id} name={user.name} size="md" status={onlineUserIds.has(user.id) ? "online" : "offline"} className="ring-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
                <p className="truncate text-xs text-ink-400">{onlineUserIds.has(user.id) ? "Online" : "Offline"}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {user.roles.map((role) => <Badge key={role} tone="blue" className="text-[10px]">{roleLabels[role] ?? role}</Badge>)}
                </div>
              </div>
              {user.id !== currentUserId && (
                <button onClick={() => onStartDirectMessage(user.id)} title="Message" className="shrink-0 rounded-lg p-2 text-ink-400 hover:bg-brand-50 hover:text-brand-600">
                  <MessageCircle size={17} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
