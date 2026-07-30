import type { User } from "@/types";

const palette = [
  "bg-brand-600",
  "bg-sky-500",
  "bg-amber-500",
  "bg-navy-700",
  "bg-pink-500",
  "bg-violet-500",
  "bg-orange-500",
  "bg-teal-600",
];

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const TENANT_ID = "co-1"; // Sourcecube India — see src/mock/tenant.ts

function makeUser(id: string, name: string, role: string, email: string, colorIdx: number): User {
  return {
    id,
    tenantId: TENANT_ID,
    name,
    role,
    email,
    initials: initialsOf(name),
    color: palette[colorIdx % palette.length],
  };
}

export const currentUser = makeUser("u-1", "Vinayak Pawar", "Sales and Marketing Head", "vinayak@sourcecube.com", 0);

export const users: User[] = [
  currentUser,
  makeUser("u-2", "Brijesh Rudani", "Project Manager", "brijesh@sourcecube.com", 1),
  makeUser("u-3", "Rahul Bhatt", "Sales Executive", "rahul@sourcecube.com", 2),
  makeUser("u-4", "Dineshsingh Rajput", "QA", "dinesh@sourcecube.com", 3),
  makeUser("u-5", "Chiron Modi", "Project Manager", "chiron@sourcecube.com", 4),
  makeUser("u-6", "Aanchal Gupta", "Frontend Developer", "aanchal@sourcecube.com", 5),
  makeUser("u-7", "Hiren Mehta", "Backend Developer", "hiren@sourcecube.com", 6),
  makeUser("u-8", "Anup Charan", "Project Manager", "anup@sourcecube.com", 7),
  makeUser("u-9", "Archana Mishra", "UI/UX Designer", "archana@sourcecube.com", 1),
  makeUser("u-10", "Sanjay Sharma", "Backend Developer", "sanjay@sourcecube.com", 2),
  makeUser("u-11", "Ankit Joshi", "Full Stack Developer", "ankit@sourcecube.com", 3),
  makeUser("u-12", "Anoop Kumar", "QA Engineer", "anoop@sourcecube.com", 4),
  makeUser("u-13", "Ajay Bhatt", "DevOps Engineer", "ajay@sourcecube.com", 5),
  makeUser("u-14", "Ajaysinh Chavda", "Product Manager", "ajaysinh@sourcecube.com", 6),
  makeUser("u-15", "Mohit Adlakha", "Team Lead", "mohit@sourcecube.com", 7),
];

export function userById(id?: string) {
  return users.find((u) => u.id === id);
}
