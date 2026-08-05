/** Date/time formatting anchored to the company's configured timezone, not the browser's local
 *  one. Without this, a value stored/bucketed server-side by company timezone (e.g. the resource
 *  planner's day grid) can display a different date/time than what a plain `toLocaleString()`
 *  shows on a viewer's machine in a different timezone — the same instant reads as two different
 *  "days" depending on which timezone is doing the formatting. Every screen should format dates
 *  through here (with the signed-in company's timezone) instead of calling toLocaleString directly. */

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateInZone(value: string | Date, timezone: string | undefined, options?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }
}

export function formatDateOnly(value: string | Date, timezone?: string): string {
  return formatDateInZone(value, timezone, { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatDateTime(value: string | Date, timezone?: string): string {
  return formatDateInZone(value, timezone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit" });
}

export function formatTimeOnly(value: string | Date, timezone?: string): string {
  return formatDateInZone(value, timezone, { hour: "numeric", minute: "2-digit" });
}
