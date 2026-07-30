import { ChevronRight, Users } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/common";
import { cn } from "@/lib/cn";
import type { Department } from "@/types/tenant";

interface Props {
  departments: Department[];
  onSelect: (department: Department) => void;
}

export function DepartmentTree({ departments, onSelect }: Props) {
  const roots = departments.filter((d) => !d.parentId || !departments.some((p) => p.id === d.parentId));

  if (roots.length === 0) {
    return <p className="px-2 py-8 text-center text-sm text-ink-500">No departments yet.</p>;
  }

  return (
    <div className="space-y-1">
      {roots.map((d) => (
        <TreeNode key={d.id} department={d} departments={departments} depth={0} onSelect={onSelect} />
      ))}
    </div>
  );
}

function TreeNode({
  department,
  departments,
  depth,
  onSelect,
}: {
  department: Department;
  departments: Department[];
  depth: number;
  onSelect: (department: Department) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = departments.filter((d) => d.parentId === department.id);

  return (
    <div>
      <button
        onClick={() => onSelect(department)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-ink-100"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {children.length > 0 ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-400"
          >
            <ChevronRight size={14} className={cn("transition-transform", expanded && "rotate-90")} />
          </span>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <span className={cn("flex-1 font-medium", department.isActive ? "text-ink-900" : "text-ink-400 line-through")}>
          {department.name}
        </span>
        {department.headUser && (
          <span className="text-xs text-ink-500">{department.headUser.name}</span>
        )}
        <span className="flex items-center gap-1 text-xs text-ink-400">
          <Users size={12} />
          {department._count?.children ?? 0}
        </span>
        {!department.isActive && <Badge tone="neutral">Inactive</Badge>}
      </button>
      {expanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode key={child.id} department={child} departments={departments} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
