import { useNavigate } from "react-router-dom";
// import { Plus, Search, Star, Timer } from "lucide-react";
import { LogOut, Menu, Settings, User as UserIcon } from "lucide-react";
import { DropdownMenu, MemberAvatar } from "@/components/common";
import { useSession } from "@/lib/session";
import { NotificationBell } from "@/features/chat/components/NotificationBell";

export function Topbar({ title, onMenuClick }: { title: string; onMenuClick: () => void }) {
  const navigate = useNavigate();
  const { session, logout } = useSession();
  const currentUser = session?.user;

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-4 lg:px-6">
      <button onClick={onMenuClick} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 lg:hidden">
        <Menu size={18} />
      </button>

      <h1 className="shrink-0 text-lg font-semibold tracking-tight text-ink-900">{title}</h1>

      {/* <div className="relative mx-auto hidden w-full max-w-xl md:block">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          placeholder="Search for Tasks, Menu, Client Name & Project Name..."
          className="h-10 w-full rounded-full border border-ink-200 bg-surface-subtle pl-10 pr-4 text-sm text-ink-900 placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </div> */}

      <div className="ml-auto flex items-center gap-1">
        {/* <IconButton label="Timer"><Timer size={18} className="text-danger-500" /></IconButton>
        <IconButton label="Create"><Plus size={19} /></IconButton>
        <IconButton label="Favourites"><Star size={18} className="fill-warning-500 text-warning-500" /></IconButton> */}
        <NotificationBell />

        <div className="ml-2">
          <DropdownMenu
            trigger={
              <button className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-ink-100">
                <MemberAvatar id={currentUser?.id} name={currentUser?.name ?? "?"} size="md" />
              </button>
            }
            items={[
              { id: "profile", label: currentUser?.name ?? "Account", icon: <UserIcon size={15} /> },
              { id: "settings", label: "Settings", icon: <Settings size={15} /> },
              {
                id: "logout",
                label: "Log out",
                icon: <LogOut size={15} />,
                danger: true,
                onSelect: async () => {
                  await logout();
                  navigate("/login", { replace: true });
                },
              },
            ]}
          />
        </div>
      </div>
    </header>
  );
}

// function IconButton({ children, label }: { children: React.ReactNode; label: string }) {
//   return (
//     <button
//       title={label}
//       className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
//     >
//       {children}
//     </button>
//   );
// }
