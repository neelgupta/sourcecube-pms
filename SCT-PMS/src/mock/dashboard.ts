import type {
  AssigneeTaskCount,
  LeaderboardEntry,
  PriorityTaskCount,
  StatCard,
  TaskActivityPoint,
  WidgetMetric,
} from "@/types";
import { users } from "./users";

export const overviewStats: StatCard[] = [
  { id: "s1", label: "Total Projects", value: 89, icon: "folder", accent: "blue" },
  { id: "s2", label: "Total Tasks", value: 397, icon: "list", accent: "amber" },
  { id: "s3", label: "Completed Tasks", value: 185, icon: "check", accent: "green" },
  { id: "s4", label: "Pending Tasks", value: 60, icon: "clock", accent: "purple" },
  { id: "s5", label: "Overdue Tasks", value: 21, icon: "alert", accent: "red" },
];

export const leaderboard: LeaderboardEntry[] = users.slice(0, 5).map((user, i) => ({
  user,
  points: [128, 96, 74, 51, 30][i],
  rank: i + 1,
}));

export const taskActivity: TaskActivityPoint[] = [
  { day: "01", value: 3 },
  { day: "05", value: 6 },
  { day: "09", value: 4 },
  { day: "13", value: 9 },
  { day: "17", value: 7 },
  { day: "21", value: 12 },
  { day: "25", value: 8 },
  { day: "29", value: 14 },
];

export const globalWidgets: WidgetMetric[] = [
  { id: "w1", label: "MCG Widget", value: 10 },
  { id: "w2", label: "Total Tasks", value: 1382 },
  { id: "w3", label: "Completed Tasks", value: 408 },
  { id: "w4", label: "Debt", value: 974 },
  { id: "w5", label: "Overdue Tasks", value: 440 },
  { id: "w6", label: "Open Tasks Due Today", value: 2 },
  { id: "w7", label: "Total Estimation Hours", value: "3399h 40m" },
  { id: "w8", label: "My Tasks", value: 229 },
  { id: "w9", label: "My Open Tasks", value: 60 },
  { id: "w10", label: "My Overdue Tasks", value: 21 },
  { id: "w11", label: "My Open Tasks Due Today", value: 0 },
  { id: "w12", label: "Total My Estimation Hours", value: "768h 35m" },
  { id: "w13", label: "Total My Work Log Hours", value: "165h 44m" },
];

export const tasksByAssignee: AssigneeTaskCount[] = [
  { name: "Unassigned", count: 384 },
  { name: "V. Pawar", count: 229 },
  { name: "M. Adlakha", count: 173 },
  { name: "Vinayak", count: 138 },
  { name: "A. Sinha", count: 68 },
  { name: "D. Rajput", count: 61 },
];

export const tasksByPriority: PriorityTaskCount[] = [
  { priority: "Low", count: 1286 },
  { priority: "Medium", count: 412 },
  { priority: "High", count: 188 },
  { priority: "Urgent", count: 64 },
];

export const myDashboardMetrics: WidgetMetric[] = [
  { id: "m1", label: "My Tasks", value: 229 },
  { id: "m2", label: "My Open Tasks", value: 60 },
  { id: "m3", label: "My Overdue Tasks", value: 21 },
  { id: "m4", label: "Due Today", value: 0 },
  { id: "m5", label: "My Estimation Hours", value: "768h 35m" },
  { id: "m6", label: "My Work Log Hours", value: "165h 44m" },
];
