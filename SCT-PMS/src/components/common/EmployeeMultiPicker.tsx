import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "./Input";
import { MemberAvatar } from "./Avatar";
import type { EmployeePickerOption } from "./EmployeePicker";

/** Multi-select sibling of EmployeePicker — same searchable, portaled dropdown, but
 *  toggles a set of employee ids instead of picking one. Trigger shows avatars for the
 *  first couple of selections plus a "+N" overflow badge, matching the single picker's
 *  visual language so both feel like one design-system component. */
export function EmployeeMultiPicker({
  employees,
  value,
  onChange,
  disabled,
  placeholder = "All employees",
  className,
}: {
  employees: EmployeePickerOption[];
  value: string[];
  onChange: (employeeIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = employees.filter((employee) => value.includes(employee.id));
  const available = employees.filter((employee) => `${employee.name} ${employee.email ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  function toggle(employeeId: string) {
    onChange(value.includes(employeeId) ? value.filter((id) => id !== employeeId) : [...value, employeeId]);
  }

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 280) });
    }
    updatePosition();
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)}>
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => setOpen((current) => !current)} className="flex h-10 w-full items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-left text-sm transition hover:border-brand-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-100">
        {selected.length === 0 ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-100 text-[10px] font-semibold text-ink-500"><Users size={13} /></span>
        ) : (
          <span className="flex shrink-0 -space-x-1.5">
            {selected.slice(0, 3).map((employee) => (
              <MemberAvatar key={employee.id} id={employee.id} name={employee.name} size="xs" className="ring-2 ring-white" />
            ))}
          </span>
        )}
        <span className={cn("min-w-0 flex-1 truncate", selected.length ? "font-medium text-ink-800" : "text-ink-400")}>
          {selected.length === 0 ? placeholder : selected.length === 1 ? selected[0].name : `${selected.length} employees selected`}
        </span>
        <ChevronDown size={15} className={cn("shrink-0 text-ink-400 transition", open && "rotate-180")} />
      </button>
      {open && !disabled && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
          className="z-[80] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-popover"
        >
          <div className="border-b border-ink-100 p-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employee..." leftIcon={<Search size={14} />} autoFocus /></div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {available.map((employee) => {
              const isSelected = value.includes(employee.id);
              return (
                <button key={employee.id} type="button" onClick={() => toggle(employee.id)} className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-brand-50", isSelected && "bg-brand-50")}>
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", isSelected ? "border-brand-600 bg-brand-600" : "border-ink-300")}>
                    {isSelected && <Check size={11} className="text-white" />}
                  </span>
                  <MemberAvatar id={employee.id} name={employee.name} size="sm" status={employee.accountStatus === "active" ? "active" : "inactive"} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">{employee.name}</span>
                </button>
              );
            })}
            {available.length === 0 && <p className="px-3 py-5 text-center text-xs text-ink-400">No employees found</p>}
          </div>
          {value.length > 0 && (
            <div className="border-t border-ink-100 p-2">
              <button type="button" onClick={() => onChange([])} className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-ink-500 hover:bg-ink-50">Clear selection</button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
