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
  approveProjectDeletion,
  revokeProjectDeletionApproval,
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
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FolderArchive,
  Info,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  XCircle,
  X,
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
  const approveDeletionFn = useServerFn(approveProjectDeletion);
  const revokeApprovalFn = useServerFn(revokeProjectDeletionApproval);
  const migrateAdrsFn = useServerFn(migrateAdrsFromRepository);
  const exportArchiveFn = useServerFn(exportProjectArchive);
  const importArchiveFn = useServerFn(importProjectArchive);
  const configureGitHubSyncFn = useServerFn(configureGitHubSync);
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [generatingDemo, setGeneratingDemo] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [migratingRepo, setMigratingRepo] = useState(false);
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  const [migrationSourceRepo, setMigrationSourceRepo] = useState("");
  const [migrationSourceBranch, setMigrationSourceBranch] = useState("main");
  const [migrationSourcePath, setMigrationSourcePath] = useState("docs/adr");
  const [migrationSourceInitialized, setMigrationSourceInitialized] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [showMigration, setShowMigration] = useState(false);
  const [updateExistingAdrs, setUpdateExistingAdrs] = useState(false);
  const [importResultModal, setImportResultModal] = useState<{
    imported: number;
    updated: number;
    skipped: number;
    files: string[];
    updatedFiles: string[];
    skippedDetails: Array<{ file: string; reason: string }>;
  } | null>(null);
  const [showSyncGuide, setShowSyncGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  function copyToClipboard(text: string, type: "url" | "secret") {
    navigator.clipboard.writeText(text);
    if (type === "url") {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
      toast.success("Webhook URL copied to clipboard");
    } else {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
      toast.success("Webhook secret copied to clipboard");
    }
  }

  useEffect(() => {
    if (!migrationSourceInitialized && data?.project) {
      setMigrationSourceRepo(data.project.repo_url ?? "");
      setMigrationSourceBranch(data.project.branch ?? "main");
      setMigrationSourcePath(
        data.project.adr_path !== undefined && data.project.adr_path !== null
          ? data.project.adr_path
          : "docs/adr",
      );
      setMigrationSourceInitialized(true);
    }
  }, [data?.project, migrationSourceInitialized]);

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { project, members, adrs, myRole, isAdmin } = data;
  const canManage = isAdmin || myRole === "project_admin";
  const canApproveDeletion = isAdmin || (myRole && myRole !== "intern");
  const deletionApprovalCount = data.deletionApprovalCount ?? 0;
  const deletionApprovals = data.deletionApprovals ?? [];
  const hasUserApprovedDeletion = data.hasUserApprovedDeletion ?? false;
  const canDeleteProject = data.canDeleteProject ?? false;
  const filteredAdrs = filter ? adrs.filter((a: any) => a.status === filter) : adrs;

  async function generateDemoAdr() {
    setGeneratingDemo(true);
    try {
      await generateDemoFn({ data: { project_id: projectId } });
      toast.success("Demo ADR generated");
      refetch();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to generate demo ADR"));
    } finally {
      setGeneratingDemo(false);
    }
  }

  async function handleApproveDeletion() {
    setApprovalBusy(true);
    try {
      await approveDeletionFn({ data: { project_id: projectId } });
      toast.success("Project deletion approved");
      refetch();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to approve project deletion"));
    } finally {
      setApprovalBusy(false);
    }
  }

  async function handleRevokeApproval() {
    setApprovalBusy(true);
    try {
      await revokeApprovalFn({ data: { project_id: projectId } });
      toast.success("Project deletion approval revoked");
      refetch();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to revoke approval"));
    } finally {
      setApprovalBusy(false);
    }
  }

  async function handleDeleteProject() {
    setDeletingProject(true);
    try {
      await deleteProjectFn({ data: { id: projectId } });
      toast.success("Project deleted");
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate({ to: "/projects" });
    } catch (err: unknown) {
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
      `Import ADR markdown files from ${migrationSourcePath || "the repository root"} in ${migrationSourceRepo} into this project?` +
        (updateExistingAdrs
          ? " Existing ADRs will be updated with repository content."
          : " Existing ADRs will be skipped."),
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
          update_existing: updateExistingAdrs,
        },
      });
      setImportResultModal({
        imported: result.imported,
        updated: result.updated ?? 0,
        skipped: result.skipped,
        files: result.files,
        updatedFiles: result.updatedFiles ?? [],
        skippedDetails: result.skippedDetails ?? [],
      });
      toast.success(
        `Import completed: ${result.imported} imported, ${result.updated ?? 0} updated, ${result.skipped} skipped.`,
      );
      refetch();
    } catch (err: unknown) {
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
    } catch (err: unknown) {
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
      toast.success(
        enabled ? "GitHub repository sync enabled." : "GitHub repository sync disabled.",
      );
      await refetch();
    } catch (err: unknown) {
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
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to import project archive"));
    } finally {
      setArchiveBusy(false);
    }
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${import.meta.env.BASE_URL}api/github-sync`
      : "";
  const githubRepoClean = project?.repo_url?.replace(/\.git$/i, "").trim();
  const githubWebhookSettingsUrl =
    githubRepoClean && githubRepoClean.startsWith("https://github.com/")
      ? `${githubRepoClean}/settings/hooks/new`
      : null;

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
          {(canManage || canApproveDeletion || deletionApprovalCount > 0) && (
            <button
              onClick={() => setShowDeleteProject(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" /> Delete
              {deletionApprovalCount > 0 && (
                <span className="ml-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                  {deletionApprovalCount}/3
                </span>
              )}
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

      {/* Active Deletion Approvals Banner */}
      {deletionApprovalCount > 0 && (
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Project Deletion Approvals in Progress
                </span>
                <span className="rounded-full bg-destructive/15 text-destructive px-2 py-0.5 text-xs font-semibold">
                  {deletionApprovalCount} / 3 Approvals
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {deletionApprovalCount >= 3
                  ? "Required 3 approvals reached. The project can now be permanently deleted by an authorized administrator."
                  : `At least 3 approvals are required before this project can be deleted. ${3 - deletionApprovalCount} more approval${3 - deletionApprovalCount === 1 ? "" : "s"} needed.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canApproveDeletion &&
              (hasUserApprovedDeletion ? (
                <button
                  type="button"
                  disabled={approvalBusy}
                  onClick={handleRevokeApproval}
                  className="rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {approvalBusy ? "Revoking…" : "Revoke Approval"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={approvalBusy}
                  onClick={handleApproveDeletion}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {approvalBusy ? "Approving…" : "Approve Deletion"}
                </button>
              ))}
            <button
              type="button"
              onClick={() => setShowDeleteProject(true)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Review & Details
            </button>
          </div>
        </div>
      )}

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
              <option value="rejected">Rejected</option>
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

      {canManage && (
        <section className="mt-6 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-semibold">GitHub Two-Way Sync</h2>
                {project.github_sync_enabled ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Active (Monitoring: {project.branch || "main"})
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Disabled
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
                Automatically keep your Decyra architecture records in sync with your GitHub
                repository. When enabled, pushing ADR markdown files to your Git branch creates
                drafts or updates existing records in Decyra.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSyncGuide(!showSyncGuide)}
                className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent flex items-center gap-1.5"
              >
                <Info className="h-3.5 w-3.5 text-primary" />
                {showSyncGuide ? "Hide Setup Guide" : "Setup Instructions"}
              </button>
              {project.github_sync_enabled && (
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={() => void toggleGitHubSync(true)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncBusy ? "animate-spin" : ""}`} />
                  Rotate secret
                </button>
              )}
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => void toggleGitHubSync(!project.github_sync_enabled)}
                className={`h-9 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                  project.github_sync_enabled
                    ? "border border-border bg-background hover:bg-destructive/10 hover:text-destructive"
                    : "bg-primary text-primary-foreground hover:opacity-90"
                }`}
              >
                {syncBusy
                  ? "Saving…"
                  : project.github_sync_enabled
                    ? "Disable sync"
                    : "Enable sync"}
              </button>
            </div>
          </div>

          {/* Newly Generated Secret Banner */}
          {webhookSecret && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  GitHub Webhook Secret Generated
                </span>
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                  Shown only once — copy now
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Copy this secret now and paste it into your GitHub webhook settings. Decyra does not
                show it again once navigated away.
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={webhookSecret}
                  className="h-8 flex-1 rounded border border-input bg-background px-2.5 font-mono text-xs text-foreground select-all"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(webhookSecret, "secret")}
                  className="h-8 inline-flex items-center gap-1 rounded border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
                >
                  {copiedSecret ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedSecret ? "Copied" : "Copy Secret"}
                </button>
              </div>
            </div>
          )}

          {/* Clear, Step-by-Step Setup Guide */}
          {(showSyncGuide || webhookSecret) && (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-primary" />
                  How to Configure the GitHub Webhook (Step-by-Step)
                </h3>
                {githubWebhookSettingsUrl && (
                  <a
                    href={githubWebhookSettingsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
                  >
                    Open Webhook Settings in GitHub
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <ol className="space-y-3.5 mt-2">
                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    1
                  </span>
                  <div>
                    <span className="font-semibold text-foreground">
                      Open your GitHub Webhook settings:
                    </span>
                    <p className="text-muted-foreground mt-0.5">
                      Go to your GitHub repository &rarr; click{" "}
                      <strong className="text-foreground font-medium">Settings</strong> tab &rarr;
                      select <strong className="text-foreground font-medium">Webhooks</strong> in
                      the left sidebar &rarr; click the{" "}
                      <strong className="text-foreground font-medium">Add webhook</strong> button.
                      {githubWebhookSettingsUrl && (
                        <span>
                          {" "}
                          (Or click the &ldquo;Open Webhook Settings in GitHub&rdquo; link above).
                        </span>
                      )}
                    </p>
                  </div>
                </li>

                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    2
                  </span>
                  <div className="flex-1">
                    <span className="font-semibold text-foreground">Paste Payload URL:</span>
                    <p className="text-muted-foreground mt-0.5">
                      Paste this URL into the{" "}
                      <strong className="text-foreground font-medium">Payload URL</strong> field in
                      GitHub:
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <input
                        readOnly
                        value={webhookUrl}
                        className="h-8 flex-1 rounded border border-input bg-background px-2.5 font-mono text-xs text-foreground select-all"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(webhookUrl, "url")}
                        className="h-8 inline-flex items-center gap-1 rounded border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
                      >
                        {copiedUrl ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedUrl ? "Copied" : "Copy URL"}
                      </button>
                    </div>
                  </div>
                </li>

                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    3
                  </span>
                  <div>
                    <span className="font-semibold text-foreground">
                      Set Content type to application/json:
                    </span>
                    <p className="text-muted-foreground mt-0.5">
                      In the <strong className="text-foreground font-medium">Content type</strong>{" "}
                      dropdown, select{" "}
                      <strong className="text-primary font-semibold">application/json</strong>.
                      (GitHub defaults to form-urlencoded, so make sure to change it to JSON).
                    </p>
                  </div>
                </li>

                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    4
                  </span>
                  <div className="flex-1">
                    <span className="font-semibold text-foreground">Paste Webhook Secret:</span>
                    <p className="text-muted-foreground mt-0.5">
                      Paste your secret into the{" "}
                      <strong className="text-foreground font-medium">Secret</strong> field in
                      GitHub:
                    </p>
                    {webhookSecret ? (
                      <div className="flex items-center gap-2 mt-1.5">
                        <input
                          readOnly
                          value={webhookSecret}
                          className="h-8 flex-1 rounded border border-input bg-background px-2.5 font-mono text-xs text-foreground select-all"
                        />
                        <button
                          type="button"
                          onClick={() => copyToClipboard(webhookSecret, "secret")}
                          className="h-8 inline-flex items-center gap-1 rounded border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
                        >
                          {copiedSecret ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {copiedSecret ? "Copied" : "Copy Secret"}
                        </button>
                      </div>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-[11px] italic">
                        Secret was already saved. If you need a new one, click &ldquo;Rotate
                        secret&rdquo; above.
                      </p>
                    )}
                  </div>
                </li>

                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    5
                  </span>
                  <div>
                    <span className="font-semibold text-foreground">Select Trigger Events:</span>
                    <p className="text-muted-foreground mt-0.5">
                      Under &ldquo;Which events would you like to trigger this webhook?&rdquo;,
                      leave{" "}
                      <strong className="text-foreground font-medium">Just the push event</strong>{" "}
                      selected.
                    </p>
                  </div>
                </li>

                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    6
                  </span>
                  <div>
                    <span className="font-semibold text-foreground">Save Webhook:</span>
                    <p className="text-muted-foreground mt-0.5">
                      Ensure <strong className="text-foreground font-medium">Active</strong> is
                      checked, and click{" "}
                      <strong className="text-foreground font-medium">Add webhook</strong>. GitHub
                      will send a test event to verify the connection.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}
        </section>
      )}

      {canManage && (
        <section className="mt-6 rounded-lg border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowMigration(!showMigration)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/40 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <FolderArchive className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Migrate ADRs & Archives</h2>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                    Optional
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Optionally import existing Markdown ADRs from a Git repository or export/import
                  Decyra archive JSON files.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <span>{showMigration ? "Hide options" : "Show options"}</span>
              {showMigration ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          </button>

          {showMigration && (
            <div className="border-t border-border p-4 pt-4 space-y-4 bg-muted/20">
              <div>
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Import Existing ADRs from Git
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Clone and parse existing Markdown ADR files into this project as draft ADRs.
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
                      placeholder="docs/adr (or / for repository root)"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono font-normal"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={importAdrsFromRepository}
                    disabled={migratingRepo}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    {migratingRepo ? "Importing ADRs…" : "Import ADRs from Git"}
                  </button>
                  <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground hover:text-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={updateExistingAdrs}
                      onChange={(e) => setUpdateExistingAdrs(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-input"
                    />
                    <span>Update / Overwrite existing ADRs if already present in Decyra</span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-border">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Project Archive Backup & Restore
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Export project ADRs as JSON or restore an archive JSON file.
                </p>
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
              </div>

              <p className="text-xs text-muted-foreground pt-1">
                Archives include visible ADR content and relationships only; imports create drafts
                and do not restore approvals, comments, or published-version history.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Delete Project Modal */}
      {showDeleteProject && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-destructive flex items-center gap-2">
                <Trash2 className="h-5 w-5" /> Delete project
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Permanently delete{" "}
                <span className="font-semibold text-foreground">{project.name}</span>. All ADRs,
                records, and memberships will be erased. This cannot be undone.
              </p>
            </div>

            {/* Approval Requirement & Progress */}
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">Approval Requirement</span>
                <span className="font-semibold">{deletionApprovalCount} / 3 Approvals</span>
              </div>
              <div className="h-2 rounded-full bg-border overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    deletionApprovalCount >= 3 ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                  style={{ width: `${Math.min(100, (deletionApprovalCount / 3) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {deletionApprovalCount >= 3
                  ? "Required 3 approvals reached. Platform admins and project admins can now permanently delete this project."
                  : "Requires at least 3 approvals from platform admins or project members (excluding interns) before this project can be deleted."}
              </p>
            </div>

            {/* Approvers List */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Approvals ({deletionApprovals.length})
              </h3>
              {deletionApprovals.length === 0 ? (
                <p className="text-xs text-muted-foreground italic bg-muted/20 rounded-md p-3 text-center border border-dashed border-border">
                  No approvals yet. At least 3 approvals are needed.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {deletionApprovals.map(
                    (a: {
                      id: string;
                      full_name?: string | null;
                      email?: string | null;
                      created_at: string;
                    }) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-6 w-6 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate text-foreground">
                              {a.full_name || a.email || "User"}
                            </p>
                            {a.email && (
                              <p className="text-[11px] text-muted-foreground truncate">
                                {a.email}
                              </p>
                            )}
                          </div>
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {new Date(a.created_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>

            {/* Approval / Revoke Action */}
            {canApproveDeletion && (
              <div className="flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">Your Approval:</span>
                {hasUserApprovedDeletion ? (
                  <button
                    type="button"
                    disabled={approvalBusy}
                    onClick={handleRevokeApproval}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {approvalBusy ? "Revoking…" : "Revoke My Approval"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={approvalBusy}
                    onClick={handleApproveDeletion}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {approvalBusy ? "Approving…" : "Approve Deletion"}
                  </button>
                )}
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex justify-between items-center gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowDeleteProject(false)}
                className="h-9 rounded-md border border-border bg-card px-4 text-xs font-medium hover:bg-accent"
              >
                Close
              </button>
              {canManage && (
                <button
                  disabled={deletingProject || !canDeleteProject}
                  onClick={handleDeleteProject}
                  title={
                    !canDeleteProject
                      ? `Requires 3 approvals before deletion (currently ${deletionApprovalCount}/3)`
                      : "Permanently delete project"
                  }
                  className="h-9 rounded-md bg-destructive px-4 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deletingProject
                    ? "Deleting…"
                    : deletionApprovalCount >= 3
                      ? "Delete project permanently"
                      : `Needs ${3 - deletionApprovalCount} more approval${3 - deletionApprovalCount === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {importResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold">ADR Import Summary</h3>
              </div>
              <button
                type="button"
                onClick={() => setImportResultModal(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-center">
                <span className="block text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {importResultModal.imported}
                </span>
                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  New Imported
                </span>
              </div>
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-center">
                <span className="block text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {importResultModal.updated}
                </span>
                <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                  Updated
                </span>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-center">
                <span className="block text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {importResultModal.skipped}
                </span>
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Skipped
                </span>
              </div>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1 pr-1 text-xs">
              {importResultModal.files.length > 0 && (
                <div>
                  <h4 className="font-semibold text-emerald-600 dark:text-emerald-400 mb-1">
                    Imported ADRs:
                  </h4>
                  <ul className="space-y-1">
                    {importResultModal.files.map((f) => (
                      <li key={f} className="font-mono bg-muted/40 rounded px-2 py-1 truncate">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {importResultModal.updatedFiles.length > 0 && (
                <div>
                  <h4 className="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                    Updated ADRs:
                  </h4>
                  <ul className="space-y-1">
                    {importResultModal.updatedFiles.map((f) => (
                      <li key={f} className="font-mono bg-muted/40 rounded px-2 py-1 truncate">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {importResultModal.skippedDetails.length > 0 && (
                <div>
                  <h4 className="font-semibold text-amber-600 dark:text-amber-400 mb-1">
                    Skipped Files & Reasons:
                  </h4>
                  <div className="space-y-1.5">
                    {importResultModal.skippedDetails.map((s, idx) => (
                      <div
                        key={idx}
                        className="rounded border border-border bg-muted/30 p-2 text-[11px]"
                      >
                        <div className="font-mono font-medium text-foreground truncate">
                          {s.file}
                        </div>
                        <div className="text-muted-foreground mt-0.5">{s.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setImportResultModal(null)}
                className="h-8 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Done
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
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to add project member"));
    }
  }

  async function remove(id: string) {
    try {
      await removeFn({ data: { id } });
      onChange();
    } catch (err: unknown) {
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
