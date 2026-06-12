import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProject, listProfiles, addProjectMember, removeProjectMember } from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { Plus, Users, GitBranch, FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project — Decyra" }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const fn = useServerFn(getProject);
  const { data, refetch } = useQuery({ queryKey: ["project", projectId], queryFn: () => fn({ data: { id: projectId } }) });
  const navigate = useNavigate();

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { project, members, adrs, myRole, isAdmin } = data;
  const canManage = isAdmin || myRole === "project_admin";

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent px-2 py-0.5 text-xs font-mono font-semibold">{project.code}</span>
            {myRole && <span className="text-xs text-muted-foreground">Your role: {myRole.replace("_", " ")}</span>}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{project.description || "No description."}</p>
        </div>
        <button onClick={() => navigate({ to: "/app/projects/$projectId/adrs/new", params: { projectId } })}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New ADR
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <InfoCard icon={GitBranch} label="Repository">
          {project.repo_url ? <a href={project.repo_url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate block">{project.repo_url}</a> : <span className="text-muted-foreground">Not configured</span>}
          <div className="text-xs text-muted-foreground mt-1">Branch: <span className="font-mono">{project.branch}</span></div>
        </InfoCard>
        <InfoCard icon={FolderOpen} label="ADR path">
          <span className="font-mono text-xs">{project.adr_path}</span>
        </InfoCard>
        <InfoCard icon={Users} label="Members">
          <span className="text-2xl font-semibold">{members.length}</span>
        </InfoCard>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">ADRs</h2>
        <div className="mt-3 rounded-lg border border-border bg-card divide-y divide-border">
          {adrs.length === 0 && <div className="p-6 text-sm text-muted-foreground">No ADRs yet.</div>}
          {adrs.map((a: any) => (
            <Link key={a.id} to="/app/adrs/$adrId" params={{ adrId: a.id }}
              className="flex items-center justify-between px-4 py-3 hover:bg-accent/40">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{a.full_id}</span>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mt-0.5 truncate font-medium">{a.title}</div>
              </div>
              <span className="text-xs text-muted-foreground ml-4 shrink-0">{new Date(a.updated_at).toLocaleDateString()}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Members</h2>
        </div>
        <MembersPanel projectId={projectId} members={members} canManage={canManage} onChange={refetch} />
      </section>
    </div>
  );
}

function InfoCard({ icon: Icon, label, children }: any) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function MembersPanel({ projectId, members, canManage, onChange }: { projectId: string; members: any[]; canManage: boolean; onChange: () => void }) {
  const profilesFn = useServerFn(listProfiles);
  const addFn = useServerFn(addProjectMember);
  const removeFn = useServerFn(removeProjectMember);
  const qc = useQueryClient();
  const { data: profiles } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesFn(), enabled: canManage });
  const [pick, setPick] = useState({ user_id: "", role: "engineer" as "project_admin" | "engineer" | "intern" });

  const memberIds = new Set(members.map((m) => m.user_id));
  const available = (profiles ?? []).filter((p: any) => !memberIds.has(p.id));

  async function add() {
    if (!pick.user_id) return;
    try {
      await addFn({ data: { project_id: projectId, ...pick } });
      toast.success("Member added");
      setPick({ user_id: "", role: "engineer" });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      onChange();
    } catch (err: any) { toast.error(err.message); }
  }

  async function remove(id: string) {
    try { await removeFn({ data: { id } }); onChange(); }
    catch (err: any) { toast.error(err.message); }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-card">
      <div className="divide-y divide-border">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-semibold">
                {(m.profiles?.full_name ?? m.profiles?.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-medium">{m.profiles?.full_name ?? m.profiles?.email}</div>
                <div className="text-xs text-muted-foreground">{m.profiles?.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">{m.role.replace("_", " ")}</span>
              {canManage && (
                <button onClick={() => remove(m.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive" title="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {canManage && (
        <div className="border-t border-border p-3 flex items-center gap-2">
          <select value={pick.user_id} onChange={(e) => setPick({ ...pick, user_id: e.target.value })}
            className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Select a user…</option>
            {available.map((p: any) => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
          </select>
          <select value={pick.role} onChange={(e) => setPick({ ...pick, role: e.target.value as any })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="project_admin">Project admin</option>
            <option value="engineer">Engineer</option>
            <option value="intern">Intern</option>
          </select>
          <button onClick={add} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">Add</button>
        </div>
      )}
    </div>
  );
}
