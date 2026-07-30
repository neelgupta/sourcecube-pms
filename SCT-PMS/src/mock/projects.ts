import type { Project, ProjectStatus } from "@/types";
import { users } from "./users";

const projectSeed: Array<[string, string, number, number, number, ProjectStatus, string, number, boolean]> = [
  ["TATA Group", "John AB", 25, 27, 110, "In Progress", "28 Feb, 2026", 1, true],
  ["Krisna HVAC LLP", "Meera Shah", 0, 0, 0, "In Progress", "31 Jul, 2026", 2, false],
  ["Hiren Venture", "Hiren Patel", 0, 0, 4, "In Progress", "31 Aug, 2025", 3, false],
  ["TS04FJ3045", "Tarun Soni", 0, 0, 2, "In Progress", "23 Jul, 2026", 4, false],
  ["Sourcecube Test", "Priya Tiwari", 0, 0, 1, "In Progress", "15 Jun, 2026", 5, false],
  ["Move Ahead Advisory", "Karan Mehta", 40, 8, 20, "In Progress", "12 Sep, 2026", 6, false],
  ["Kp Group", "Kalpesh Patel", 62, 31, 50, "In Progress", "02 Oct, 2026", 7, false],
  ["German Steel", "Klaus Weber", 18, 9, 50, "On Hold", "19 Nov, 2026", 8, false],
  ["Goldi Solar", "Ramesh Goldi", 74, 37, 50, "In Progress", "05 Dec, 2026", 9, false],
  ["Creation Data", "Vinayak Pawar", 0, 0, 0, "Not Started", "30 Jul, 2026", 1, false],
  ["Cognitive Clouds", "Neha Verma", 88, 44, 50, "In Progress", "14 Jan, 2027", 2, false],
  ["Chirag Enterprises", "Chirag Doshi", 33, 10, 30, "In Progress", "22 Aug, 2026", 3, false],
  ["Blue Ocean Retail", "Sameer Nair", 55, 22, 40, "In Progress", "09 Sep, 2026", 4, false],
  ["Nova Textiles", "Ritu Kapoor", 12, 3, 25, "Overdue", "01 Jul, 2026", 5, false],
  ["Orbit Logistics", "Manish Rao", 100, 60, 60, "Completed", "18 May, 2026", 6, false],
  ["Pinnacle Finance", "Devika Iyer", 46, 23, 50, "In Progress", "27 Oct, 2026", 7, false],
];

const colorClasses = [
  "bg-brand-600",
  "bg-navy-700",
  "bg-amber-500",
  "bg-pink-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-orange-500",
  "bg-teal-600",
];

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export const projects: Project[] = projectSeed.map(
  ([name, clientName, progress, done, total, status, dueDate, mgrIdx, favourite], i) => ({
    id: `p-${i + 1}`,
    name,
    clientName,
    progress,
    tasksDone: done,
    tasksTotal: total,
    status,
    dueDate,
    manager: users[mgrIdx % users.length],
    favourite,
    color: colorClasses[i % colorClasses.length],
    initials: initialsOf(name),
  }),
);

export function projectById(id?: string) {
  return projects.find((p) => p.id === id);
}
