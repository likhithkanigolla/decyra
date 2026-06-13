import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProjects, getMyContext } from "@/lib/api/decyra.functions";
import { Plus, FolderKanban } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — Decyra" }] }),
  component: ProjectsList,
});

function ProjectsList() {
  const fn = useServerFn(listProjects);
  const meFn = useServerFn(getMyContext);
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => fn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">All projects you have access to.</p>
        </div>
        {me?.isAdmin && (
          <Link to="/projects/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> New project
          </Link>
        )}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(projects ?? []).length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            <FolderKanban className="mx-auto h-8 w-8 opacity-50" />
            <p className="mt-3">No projects yet.</p>
            {me?.isAdmin && <p className="mt-1">Create your first project to get started.</p>}
          </div>
        )}
        {(projects ?? []).map((p: any) => (
          <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }}
            className="rounded-lg border border-border bg-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2">
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-mono font-semibold">{p.code}</span>
              <span className="text-xs text-muted-foreground">{p.branch}</span>
            </div>
            <h3 className="mt-3 font-semibold">{p.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{p.description || "No description"}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
