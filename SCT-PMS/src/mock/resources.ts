import type { Resource } from "@/types";

const names = [
  "Abhishek Kumar",
  "Ajay Bhatt",
  "Ajaysinh Chavda",
  "Ankit Joshi",
  "Anoop Kumar",
  "Aanchal Gupta",
  "Anup Charan",
  "Archana Mishra",
  "Brijesh Rudani",
  "Chiron Modi",
  "Dineshsingh Rajput",
  "Hiren Mehta",
  "Mohit Adlakha",
  "Rahul Bhatt",
  "Sanjay Sharma",
  "Vinayak Pawar",
  "Neha Verma",
  "Devika Iyer",
  "Manish Rao",
  "Ritu Kapoor",
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

export const planningDays = Array.from({ length: 14 }, (_, i) => {
  const date = new Date(2026, 6, i + 1);
  return {
    key: `2026-07-${String(i + 1).padStart(2, "0")}`,
    label: `${String(i + 1).padStart(2, "0")} Jul`,
    isWeekend: date.getDay() === 0 || date.getDay() === 6,
  };
});

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export const resources: Resource[] = names.map((name, i) => {
  const projectsCount = i % 4 === 0 ? 0 : (i % 5) + 1;
  const capacity = 8;

  const dailyAllocation: Resource["dailyAllocation"] = {};
  let allocated = 0;
  planningDays.forEach((day, d) => {
    if (day.isWeekend) {
      dailyAllocation[day.key] = { allocated: 0, capacity: 0, note: "WK" };
      return;
    }
    const hours = projectsCount === 0 ? 0 : ((i + d) % 9);
    allocated += hours;
    dailyAllocation[day.key] = { allocated: hours, capacity };
  });

  return {
    id: `r-${i + 1}`,
    name,
    employeeId: `SCT${100 + i}`,
    initials: initialsOf(name),
    color: colorClasses[i % colorClasses.length],
    projectsCount,
    allocated,
    capacity: capacity * planningDays.filter((d) => !d.isWeekend).length,
    dailyAllocation,
  };
});
