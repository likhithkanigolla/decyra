import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProject, updateProject } from "@/lib/api/decyra.functions";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId_/edit")({
  head: () => ({ meta: [{ title: "Edit project — Decyra" }] }),
  component: EditProject,
});

function EditProject() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getProjectFn = useServerFn(getProject);
  const updateProjectFn = useServerFn(updateProject);

  const { data } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectFn({ data: { id: projectId } }),
  });

  const [form, setForm] = useState({
    name: "",
    description: "",
    repo_url: "",
    branch: "main",
    adr_path: "docs/adr",
    git_pat: "",
    required_approvals: 3,
  });
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Pre-fill form once data loads
  useEffect(() => {
    if (data?.project && !initialized) {
      const p = data.project;
      setForm({
        name: p.name ?? "",
        description: p.description ?? "",
        repo_url: p.repo_url ?? "",
        branch: p.branch ?? "main",
        adr_path: p.adr_path ?? "docs/adr",
        git_pat: p.git_pat ?? "",
        required_approvals: p.required_approvals ?? 3,
      });
      setInitialized(true);
    }
  }, [data, initialized]);

  // Guard: only admins / project admins can edit
  if (data && !data.isAdmin && data.myRole !== "project_admin") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">You don't have permission to edit this project.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProjectFn({
        data: {
          id: projectId,
          ...form,
          git_pat: form.git_pat ? form.git_pat.trim() : null,
          required_approvals: Number(form.required_approvals),
        },
      });
      toast.success("Project updated");
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      navigate({ to: "/projects/$projectId", params: { projectId } });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <button
        onClick={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to project
      </button>

      <div className="flex items-center gap-2 mb-1">
        <span className="rounded bg-accent px-2 py-0.5 text-xs font-mono font-semibold">
          {data.project.code}
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Edit project</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Update project metadata and configuration.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6">
        <Field label="Project name">
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="User Management Service"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Git repository URL">
            <input
              value={form.repo_url}
              onChange={(e) => setForm({ ...form, repo_url: e.target.value })}
              placeholder="https://github.com/org/repo"
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Branch">
            <input
              value={form.branch}
              onChange={(e) => setForm({ ...form, branch: e.target.value })}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="ADR directory path">
            <input
              value={form.adr_path}
              onChange={(e) => setForm({ ...form, adr_path: e.target.value })}
              placeholder="docs/adr"
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono"
            />
          </Field>
          <Field label="Required approvals" hint="Approvals needed to publish an ADR">
            <input
              type="number"
              min={1}
              max={20}
              value={form.required_approvals}
              onChange={(e) => setForm({ ...form, required_approvals: Number(e.target.value) })}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
        </div>

        <Field label="GitHub Personal Access Token (Optional)" hint="Required for auto-pushing ADRs to a private repository">
          <input
            type="password"
            value={form.git_pat}
            onChange={(e) => setForm({ ...form, git_pat: e.target.value })}
            placeholder="Leave blank to keep existing, or enter ghp_..."
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
            className="h-10 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            type="submit"
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-muted-foreground/80">{hint}</span>
      )}
    </label>
  );
}
