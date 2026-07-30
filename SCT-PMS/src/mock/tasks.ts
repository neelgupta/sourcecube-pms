import type { Priority, Task, TaskSection, TaskStatus } from "@/types";
import { users } from "./users";
import { projects } from "./projects";

let seq = 1;
function nextId() {
  return `t-${seq++}`;
}

function makeTask(
  name: string,
  section: string,
  projectId: string,
  projectName: string,
  assigneeIdx: number,
  createdDate: string,
  dueDate: string | undefined,
  status: TaskStatus,
  priority: Priority,
  opts: Partial<Task> = {},
): Task {
  const id = nextId();
  return {
    id,
    code: String(50 + seq),
    name,
    section,
    projectId,
    projectName,
    assignee: users[assigneeIdx % users.length],
    createdDate,
    dueDate,
    status,
    priority,
    tags: [],
    billable: true,
    ...opts,
  };
}

const tataId = projects[0].id;
const tataName = projects[0].name;

export const tataTaskSections: TaskSection[] = [
  {
    id: "sec-1",
    name: "Profile Submission",
    taskCount: 8,
    owner: users[5],
    tasks: [
      makeTask("Brochure Design Review", "Profile Submission", tataId, tataName, 5, "12/06/2026", "14/07/2026", "In Review", "Medium", { commentCount: 2 }),
      makeTask("New Order Management Setup", "Profile Submission", tataId, tataName, 6, "16/06/2026", "30/06/2026", "Done", "High"),
      makeTask("Client Feedback Collation", "Profile Submission", tataId, tataName, 7, "16/06/2026", "07/07/2026", "In Progress", "Medium"),
      makeTask("TEST", "Profile Submission", tataId, tataName, 5, "22/06/2026", undefined, "To Do", "Low"),
      makeTask("xyz", "Profile Submission", tataId, tataName, 5, "30/06/2026", "30/06/2026", "Done", "Low", { commentCount: 1, attachmentCount: 1 }),
      makeTask("Torrent Power Documentation", "Profile Submission", tataId, tataName, 5, "16/07/2026", "26/07/2026", "In Progress", "High"),
      makeTask("Client Feedback Round 2", "Profile Submission", tataId, tataName, 5, "17/07/2026", "11/08/2026", "To Do", "Medium", { isRecurring: true }),
      makeTask("Daily Profile Sync", "Profile Submission", tataId, tataName, 7, "24/07/2026", undefined, "To Do", "Low"),
    ],
  },
  {
    id: "sec-2",
    name: "New Request",
    taskCount: 3,
    owner: users[8],
    tasks: [
      makeTask("New Task", "New Request", tataId, tataName, 9, "Yesterday 04:08 PM", "31/07/2026", "To Do", "Medium", { hasSubtasks: true, subtaskCount: 2 }),
      makeTask("Torrent Power - Mumbai", "New Request", tataId, tataName, 5, "Yesterday 04:15 PM", "Tomorrow", "To Do", "High", { attachmentCount: 1 }),
      makeTask("Task 01", "New Request", tataId, tataName, 5, "Yesterday 04:32 PM", undefined, "To Do", "Low", { commentCount: 1 }),
    ],
  },
];

export const creationDataSections: TaskSection[] = [
  { id: "cd-1", name: "New Request", taskCount: 1, tasks: [makeTask("Task 001", "New Request", "p-10", "Creation Data", 8, "Just now", "30/07/2026", "To Do", "Medium", { billable: false })] },
  { id: "cd-2", name: "In Progress", taskCount: 0, tasks: [] },
  { id: "cd-3", name: "Content", taskCount: 0, tasks: [] },
  { id: "cd-4", name: "QA", taskCount: 0, tasks: [] },
  { id: "cd-5", name: "Done", taskCount: 0, tasks: [] },
];

export const allTasks: Task[] = [...tataTaskSections, ...creationDataSections].flatMap((s) => s.tasks);

export const overallDueTasks: Array<{ code: string; name: string; project: string }> = [
  { code: "16", name: "10 New Retailer Onboarding", project: "Cognitive Clouds" },
  { code: "60", name: "Client Demo", project: "Chirag Enterprises" },
  { code: "44", name: "Vendor Contract Renewal", project: "Goldi Solar" },
  { code: "31", name: "Quarterly Report Draft", project: "Kp Group" },
  { code: "22", name: "Warehouse Audit", project: "Orbit Logistics" },
];
