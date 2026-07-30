import { cn } from "@/lib/cn";
import type { User } from "@/types";

type Size = "xs" | "sm" | "md" | "lg";

const sizes: Record<Size, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
};

const memberColors = [
  "bg-emerald-500",
  "bg-indigo-500",
  "bg-rose-600",
  "bg-teal-500",
  "bg-violet-500",
  "bg-blue-500",
  "bg-red-500",
  "bg-orange-500",
  "bg-cyan-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-sky-500",
];

const statusColors = {
  online: "bg-emerald-500",
  active: "bg-emerald-500",
  offline: "bg-slate-300",
  inactive: "bg-slate-300",
  pending: "bg-amber-400",
};

interface AvatarProps {
  initials: string;
  color?: string;
  size?: Size;
  title?: string;
  className?: string;
  status?: keyof typeof statusColors;
}

export function initialsOf(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function memberColor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % memberColors.length;
  }
  return memberColors[Math.abs(hash) % memberColors.length];
}

export function Avatar({ initials, color = "bg-brand-500", size = "md", title, className, status }: AvatarProps) {
  return (
    <span
      title={title}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white",
        color,
        sizes[size],
        className,
      )}
    >
      {initials}
      {status && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white",
            statusColors[status],
          )}
        />
      )}
    </span>
  );
}

export function MemberAvatar({
  id,
  name,
  size = "md",
  status,
  className,
}: {
  id?: string;
  name: string;
  size?: Size;
  status?: AvatarProps["status"];
  className?: string;
}) {
  return (
    <Avatar
      initials={initialsOf(name)}
      color={memberColor(id || name)}
      size={size}
      title={name}
      status={status}
      className={className}
    />
  );
}

export function AvatarGroup({ users, max = 4, size = "sm" }: { users: User[]; max?: number; size?: Size }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;

  return (
    <div className="flex items-center -space-x-2">
      {shown.map((u) => (
        <Avatar key={u.id} initials={u.initials} color={u.color} size={size} title={u.name} />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-ink-200 font-semibold text-ink-700 ring-2 ring-white",
            sizes[size],
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
