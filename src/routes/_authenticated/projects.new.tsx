import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createProject } from "@/lib/api/decyra.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/new")({
  head: () => ({ meta: [{ title: "New project — Decyra" }] }),
  component: NewProject,
});

function NewProject() {
  const navigate = useNavigate();
  const fn = useServerFn(createProject);
  const [form, setForm] = useState({ name: "", code: "", description: "", repo_url: "", branch: "main", adr_path: "docs/adr", git_pat: "" });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await fn({ data: form });
      toast.success("Project created");
      navigate({ to: "/projects/$projectId", params: { projectId: p.id } });
    } catch (err: any) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      <p className="text-sm text-muted-foreground mt-1">Set up a project and its Git target for published ADRs.</p>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6">
        <Field label="Project name">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="User Management Service"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
        </Field>
        <Field label="Project code" hint="Used as the ADR ID prefix (e.g. UMS → UMS-ADR-001)">
          <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="UMS" maxLength={16}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono uppercase" />
        </Field>
        <Field label="Description">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Git repository URL">
            <input value={form.repo_url} onChange={(e) => setForm({ ...form, repo_url: e.target.value })}
              placeholder="https://github.com/org/repo"
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </Field>
          <Field label="Branch">
            <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </Field>
        </div>
        <Field label="ADR directory path">
          <input value={form.adr_path} onChange={(e) => setForm({ ...form, adr_path: e.target.value })}
            placeholder="docs/adr/user-management"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono" />
        </Field>
        <Field label="GitHub Personal Access Token (Optional)" hint="Required for auto-pushing ADRs to a private repository">
          <input type="password" value={form.git_pat} onChange={(e) => setForm({ ...form, git_pat: e.target.value })}
            placeholder="ghp_..."
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono" />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => navigate({ to: "/projects" })}
            className="h-10 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent">Cancel</button>
          <button disabled={busy} type="submit"
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground/80">{hint}</span>}
    </label>
  );
}
