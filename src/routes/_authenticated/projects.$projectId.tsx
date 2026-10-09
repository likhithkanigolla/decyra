import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getProject,
  listProfiles,
  addProjectMember,
  removeProjectMember,
  generateDemoAdrFn,
  deleteProject,
  migrateAdrsFromRepository,
  exportProjectArchive,
  importProjectArchive,
  configureGitHubSync,
} from "@/lib/api/decyra.functions";
import { getErrorMessage } from "@/lib/utils";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import {
  Plus,
  Users,
  GitBranch,
  FolderOpen,
  Trash2,
  Pencil,
  FileText,
  Download,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project — Decyra" }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const fn = useServerFn(getProject);
  const { data, refetch } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fn({ data: { id: projectId } }),
  });
  const navigate = useNavigate();
  const generateDemoFn = useServerFn(generateDemoAdrFn);
  const deleteProjectFn = useServerFn(deleteProject);
  const migrateAdrsFn = useServerFn(migrateAdrsFromRepository);
  const exportArchiveFn = useServerFn(exportProjectArchive);
  const importArchiveFn = useServerFn(importProjectArchive);
  const configureGitHubSyncFn = useServerFn(configureGitHubSync);
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [generatingDemo, setGeneratingDemo] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [migratingRepo, setMigratingRepo] = useState(false);
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  const [migrationSourceRepo, setMigrationSourceRepo] = useState("");
  const [migrationSourceBranch, setMigrationSourceBranch] = useState("main");
  const [migrationSourcePath, setMigrationSourcePath] = useState("docs/adr");
  const [migrationSourceInitialized, setMigrationSourceInitialized] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);

  useEffect(() => {
    if (!migrationSourceInitialized && data?.project) {
      setMigrationSourceRepo(data.project.repo_url ?? "");
      setMigrationSourceBranch(data.project.branch ?? "main");
      setMigrationSourcePath(data.project.adr_path ?? "docs/adr");
      setMigrationSourceInitialized(true);
    }
  }, [data?.project, migrationSourceInitialized]);

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { project, members, adrs, myRole, isAdmin } = data;
  const canManage = isAdmin || myRole === "project_admin";
  const filteredAdrs = filter ? adrs.filter((a: any) => a.status === filter) : adrs;

  async function generateDemoAdr() {
    setGeneratingDemo(true);
    try {
      await generateDemoFn({ data: { project_id: projectId } });
      toast.success("Demo ADR generated");
      refetch();
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to generate demo ADR"));
    } finally {
      setGeneratingDemo(false);
    }
  }

  async function handleDeleteProject() {
    setDeletingProject(true);
    try {
      await deleteProjectFn({ data: { id: projectId } });
      toast.success("Project deleted");
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate({ to: "/projects" });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to delete project"));
      setDeletingProject(false);
    }
  }

  async function importAdrsFromRepository() {
    if (!migrationSourceRepo.trim()) {
      toast.error("Enter the source repository URL before importing ADRs.");
      return;
    }

    const confirmed = window.confirm(
      `Import ADR markdown files from ${migrationSourcePath || "the repository root"} in ${migrationSourceRepo} into this project? Existing ADR titles will be skipped.`,
    );
    if (!confirmed) return;

    setMigratingRepo(true);
    try {
      const result = await migrateAdrsFn({
        data: {
          project_id: projectId,
          repo_url: migrationSourceRepo,
          branch: migrationSourceBranch,
          adr_path: migrationSourcePath,
        },
      });
      toast.success(
        `Imported ${result.imported} ADR${result.imported === 1 ? "" : "s"}; skipped ${result.skipped}.`,
      );
      refetch();
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to migrate ADRs from repository"));
    } finally {
      setMigratingRepo(false);
    }
  }

  async function exportProjectData() {
    setArchiveBusy(true);
    try {
      const archive = await exportArchiveFn({ data: { project_id: projectId } });
      const blob = new Blob([JSON.stringify(archive, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `decyra-${project.code.toLowerCase()}-archive.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success(`Exported ${archive.adrs.length} visible ADRs and their relationships.`);
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to export project data"));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function toggleGitHubSync(enabled: boolean) {
    setSyncBusy(true);
    try {
      const result = await configureGitHubSyncFn({
        data: { project_id: projectId, enabled },
      });
      setWebhookSecret(result.webhook_secret);
      toast.success(enabled ? "GitHub repository sync enabled." : "GitHub repository sync disabled.");
      await refetch();
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to configure GitHub repository sync"));
    } finally {
      setSyncBusy(false);
    }
  }

  async function importProjectData(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 10_000_000) {
      toast.error("Project archive exceeds the 10 MB import limit.");
      return;
    }

    setArchiveBusy(true);
    try {
      const archive = JSON.parse(await file.text()) as unknown;
      const confirmed = window.confirm(
        "Import this archive into the current project? Imported ADRs will be created as drafts, existing titles will be skipped, and the source archive will not be changed.",
      );
      if (!confirmed) return;

      const result = await importArchiveFn({
        data: { project_id: projectId, archive },
      });
      toast.success(
        `Imported ${result.imported} ADRs and ${result.relationshipsImported} relationships; skipped ${result.skipped}.`,
      );
      await refetch();
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to import project archive"));
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent px-2 py-0.5 text-xs font-mono font-semibold">
              {project.code}
            </span>
            {myRole && (
              <span className="text-xs text-muted-foreground">
                Your role: {myRole.replace("_", " ")}
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.description || "No description."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/projects/$projectId/graph"
            params={{ projectId }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            <GitBranch className="h-4 w-4" /> Graph
          </Link>
          {canManage && (
            <button
              onClick={() => navigate({ to: "/projects/$projectId/edit", params: { projectId } })}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
            >
              <Pencil className="h-4 w-4" /> Edit
            </button>
          )}
          {canManage && (
            <button
              onClick={importAdrsFromRepository}
              disabled={migratingRepo || !migrationSourceRepo}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" /> {migratingRepo ? "Importing…" : "Import ADRs"}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowDeleteProject(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          <button
            onClick={() => navigate({ to: "/projects/$projectId/adrs/new", params: { projectId } })}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New ADR
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <InfoCard icon={GitBranch} label="Repository">
          {project.repo_url ? (
            <a
              href={project.repo_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline truncate block"
            >
              {project.repo_url}
            </a>
          ) : (
            <span className="text-muted-foreground">Not configured</span>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            Branch: <span className="font-mono">{project.branch}</span>
          </div>
        </InfoCard>
        <InfoCard icon={FolderOpen} label="ADR path">
          <span className="font-mono text-xs">
            {project.adr_path || <span className="text-muted-foreground">(root)</span>}
          </span>
        </InfoCard>
        <InfoCard icon={Users} label="Members">
          <span className="text-2xl font-semibold">{members.length}</span>
        </InfoCard>
      </div>

      {canManage && (
        <section className="mt-6 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">GitHub two-way sync</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                When enabled, GitHub push webhooks update ADR content, send published changes to
                review, and archive ADRs removed from the configured branch.
              </p>
            </div>
            <div className="flex gap-2">
              {project.github_sync_enabled && (
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={() => void toggleGitHubSync(true)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
                >
                  Rotate secret
                </button>
              )}
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => void toggleGitHubSync(!project.github_sync_enabled)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
              >
                {syncBusy
                  ? "Saving…"
                  : project.github_sync_enabled
                    ? "Disable sync"
                    : "Enable sync"}
              </button>
            </div>
          </div>
          {project.github_sync_enabled && (
            <p className="mt-2 text-xs text-muted-foreground">
              Listening for pushes to <code>{project.branch || "main"}</code>. Incoming ADRs are
              created in Under Review. GitHub API endpoints are not used; sync clones the selected
              branch.
            </p>
          )}
          {webhookSecret && (
            <div className="mt-3 grid gap-2 rounded-md border border-border bg-background p-3 text-xs">
              <p>
                Add a GitHub webhook for <code>push</code> events, using content type{" "}
                <code>application/json</code> and this URL:
              </p>
              <code className="break-all">
                {window.location.origin}
                {import.meta.env.BASE_URL}api/github-sync
              </code>
              <p>Paste this secret into GitHub now. It is shown only once.</p>
              <code className="break-all">{webhookSecret}</code>
              <p className="text-muted-foreground">
                Rotate the secret to replace it. Disabling sync removes the stored secret.
              </p>
            </div>
          )}
        </section>
      )}

      {canManage && (
        <section className="mt-6 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Migrate ADRs from a Git repository</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Import Markdown ADRs into this project. They remain drafts until reviewed and published
            to this project&apos;s configured repository.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium">
              Source repository URL
              <input
                value={migrationSourceRepo}
                onChange={(event) => setMigrationSourceRepo(event.target.value)}
                placeholder="https://github.com/org/repo"
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-medium">
              Source branch
              <input
                value={migrationSourceBranch}
                onChange={(event) => setMigrationSourceBranch(event.target.value)}
                placeholder="main"
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-medium">
              Source ADR directory
              <input
                value={migrationSourcePath}
                onChange={(event) => setMigrationSourcePath(event.target.value)}
                placeholder="docs/adr"
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono font-normal"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportProjectData}
              disabled={archiveBusy}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {archiveBusy ? "Working…" : "Export project archive"}
            </button>
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm hover:bg-accent has-[:disabled]:opacity-50">
              <Upload className="h-4 w-4" />
              Import project archive
              <input
                type="file"
                accept="application/json,.json"
                disabled={archiveBusy}
                onChange={importProjectData}
                className="sr-only"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Archives include visible ADR content and relationships only; imports create drafts and
            do not restore approvals, comments, or published-version history. Use a database backup
            for a complete restore.
          </p>
        </section>
      )}

      <section className="mt-10">
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            ADRs
          </h2>
          {adrs.length > 0 && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-xs"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="under_review">Under Review</option>
              <option value="approved">Approved</option>
              <option value="published">Published</option>
              <option value="superseded">Superseded</option>
            </select>
          )}
        </div>

        {adrs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-border rounded-lg bg-card mt-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
              <FileText className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-medium text-foreground">No Architecture Decisions</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-sm">
              Get started by documenting your first architectural decision, or generate an example
              to see how it works.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() =>
                  navigate({ to: "/projects/$projectId/adrs/new", params: { projectId } })
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> Create ADR
              </button>
              <button
                onClick={generateDemoAdr}
                disabled={generatingDemo}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {generatingDemo ? "Generating..." : "Generate Example ADR"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-border bg-card divide-y divide-border">
            {filteredAdrs.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">
                No ADRs match the selected filter.
              </div>
            )}
            {filteredAdrs.map((a: any) => (
              <Link
                key={a.id}
                to="/adrs/$adrId"
                params={{ adrId: a.id }}
                className="flex items-center justify-between px-4 py-3 hover:bg-accent/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{a.full_id}</span>
                    <StatusBadge status={a.status} />
                    {a.repository_deleted_at && (
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Archived from repository
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-medium">{a.title}</div>
                </div>
                <span className="text-xs text-muted-foreground ml-4 shrink-0">
                  {new Date(a.updated_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Members
          </h2>
        </div>
        <MembersPanel
          projectId={projectId}
          members={members}
          canManage={canManage}
          onChange={refetch}
        />
      </section>

      {/* Delete Project Confirmation */}
      {showDeleteProject && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Delete project</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-foreground">{project.name}</span>? All ADRs,
              members and data will be lost. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowDeleteProject(false)}
                className="h-10 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                disabled={deletingProject}
                onClick={handleDeleteProject}
                className="h-10 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
              >
                {deletingProject ? "Deleting…" : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ icon: Icon, label, children }: any) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function MembersPanel({
  projectId,
  members,
  canManage,
  onChange,
}: {
  projectId: string;
  members: any[];
  canManage: boolean;
  onChange: () => void;
}) {
  const profilesFn = useServerFn(listProfiles);
  const addFn = useServerFn(addProjectMember);
  const removeFn = useServerFn(removeProjectMember);
  const qc = useQueryClient();
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => profilesFn(),
    enabled: canManage,
  });
  const [pick, setPick] = useState({
    user_id: "",
    role: "engineer" as "project_admin" | "engineer" | "intern",
  });

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
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to add project member"));
    }
  }

  async function remove(id: string) {
    try {
      await removeFn({ data: { id } });
      onChange();
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to remove project member"));
    }
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
                <div className="text-sm font-medium">
                  {m.profiles?.full_name ?? m.profiles?.email}
                </div>
                <div className="text-xs text-muted-foreground">{m.profiles?.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                {m.role.replace("_", " ")}
              </span>
              {canManage && (
                <button
                  onClick={() => remove(m.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Remove from project"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
