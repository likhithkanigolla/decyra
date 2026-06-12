import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createAdr } from "@/lib/api/decyra.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/projects/$projectId/adrs/new")({
  head: () => ({ meta: [{ title: "New ADR — Decyra" }] }),
  component: NewAdr,
});

function NewAdr() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const fn = useServerFn(createAdr);
  const [form, setForm] = useState({
    title: "", tags: "", context: "", decision: "", consequences: "", alternatives: "",
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const adr = await fn({ data: { project_id: projectId, ...form, tags } });
      toast.success(`Created ${adr.full_id}`);
      navigate({ to: "/app/adrs/$adrId", params: { adrId: adr.id } });
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight">New Architecture Decision Record</h1>
      <p className="text-sm text-muted-foreground mt-1">An ID will be assigned automatically (PROJECTCODE-ADR-NNN).</p>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6">
        <Field label="Title">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Adopt event-driven messaging for tenant provisioning"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
        </Field>
        <Field label="Tags" hint="Comma-separated">
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="messaging, kafka, multi-tenant"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
        </Field>
        <Section label="Context" value={form.context} onChange={(v) => setForm({ ...form, context: v })} placeholder="Describe the situation and forces at play." />
        <Section label="Decision" value={form.decision} onChange={(v) => setForm({ ...form, decision: v })} placeholder="State the decision in clear terms." />
        <Section label="Consequences" value={form.consequences} onChange={(v) => setForm({ ...form, consequences: v })} placeholder="Positive, negative, and follow-up implications." />
        <Section label="Alternatives considered" value={form.alternatives} onChange={(v) => setForm({ ...form, alternatives: v })} placeholder="Other options and why they were not chosen." />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => navigate({ to: "/app/projects/$projectId", params: { projectId } })}
            className="h-10 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent">Cancel</button>
          <button disabled={busy} type="submit"
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? "Creating…" : "Create draft"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Field label={label}>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={5}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed" />
    </Field>
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
