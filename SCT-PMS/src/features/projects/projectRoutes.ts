import type { RealProject } from "@/types/tenant";

export function projectSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

export function projectWorkspacePath(project: Pick<RealProject, "id" | "name">) {
  const slug = projectSlug(project.name);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(`project-route:${slug}`, project.id);
  }
  return `/projects/${slug}/workspace`;
}
