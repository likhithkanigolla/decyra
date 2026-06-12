import { useState } from "react";
import { RichEditor } from "./RichEditor";
import { Plus, X, Link as LinkIcon, Upload } from "lucide-react";

export interface AdrFormData {
  title: string;
  tags: string;
  context: string;
  decision: string;
  consequences: string;
  alternatives: string;
  design_changes: {
    api_changes: string;
    workflow_changes: string;
    service_changes: string;
    infrastructure_changes: string;
    data_model_changes: string;
  };
  major_impacts: {
    operational: string;
    testing: string;
    security: string;
    documentation: string;
    scalability: string;
  };
  references_data: {
    pull_requests: string[];
    git_commits: string[];
    design_docs: string[];
    wiki_pages: string[];
    external: string[];
  };
}

export const DEFAULT_ADR_FORM: AdrFormData = {
  title: "",
  tags: "",
  context: "",
  decision: "",
  consequences: "",
  alternatives: "",
  design_changes: {
    api_changes: "",
    workflow_changes: "",
    service_changes: "",
    infrastructure_changes: "",
    data_model_changes: "",
  },
  major_impacts: {
    operational: "",
    testing: "",
    security: "",
    documentation: "",
    scalability: "",
  },
  references_data: {
    pull_requests: [],
    git_commits: [],
    design_docs: [],
    wiki_pages: [],
    external: [],
  },
};

interface Props {
  form: AdrFormData;
  setForm: (f: AdrFormData) => void;
  busy?: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  submitLabel?: string;
}

type TabId = "core" | "design" | "impacts" | "references";
const TABS: { id: TabId; label: string }[] = [
  { id: "core", label: "Core sections" },
  { id: "design", label: "Design changes" },
  { id: "impacts", label: "Major impacts" },
  { id: "references", label: "References" },
];

export function AdrForm({ form, setForm, busy, onSubmit, onCancel, submitLabel = "Create draft" }: Props) {
  const [tab, setTab] = useState<TabId>("core");
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);

  function setDC(key: keyof AdrFormData["design_changes"], val: string) {
    setForm({ ...form, design_changes: { ...form.design_changes, [key]: val } });
  }
  function setMI(key: keyof AdrFormData["major_impacts"], val: string) {
    setForm({ ...form, major_impacts: { ...form.major_impacts, [key]: val } });
  }
  function addRef(key: keyof AdrFormData["references_data"], val: string) {
    if (!val.trim()) return;
    setForm({
      ...form,
      references_data: {
        ...form.references_data,
        [key]: [...form.references_data[key], val.trim()],
      },
    });
  }
  function removeRef(key: keyof AdrFormData["references_data"], idx: number) {
    setForm({
      ...form,
      references_data: {
        ...form.references_data,
        [key]: form.references_data[key].filter((_: string, i: number) => i !== idx),
      },
    });
  }

  // Import markdown
  function parseMarkdown(md: string) {
    const extract = (heading: string) => {
      const re = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, "i");
      return md.match(re)?.[1]?.trim() ?? "";
    };
    const titleMatch = md.match(/^#\s+(.+)/m);
    setForm({
      ...form,
      title: titleMatch?.[1] ?? form.title,
      context: extract("Context") || extract("Problem Statement"),
      decision: extract("Decision"),
      consequences: extract("Consequences"),
      alternatives: extract("Alternatives"),
    });
    setShowImport(false);
    setImportText("");
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => parseMarkdown(ev.target?.result as string);
    reader.readAsText(file);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-0">
      {/* Markdown Import Banner */}
      {showImport ? (
        <div className="mb-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Import from Markdown</span>
            <button type="button" onClick={() => setShowImport(false)}><X className="h-4 w-4 text-muted-foreground" /></button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder="Paste ADR markdown here…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
          />
          <div className="mt-2 flex gap-2 items-center">
            <button type="button" onClick={() => parseMarkdown(importText)}
              className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              Parse & import
            </button>
            <span className="text-xs text-muted-foreground">or</span>
            <label className="h-8 inline-flex items-center gap-1.5 rounded-md border border-border px-3 text-xs cursor-pointer hover:bg-accent">
              <Upload className="h-3 w-3" /> Upload .md file
              <input type="file" accept=".md,.txt" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        </div>
      ) : (
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Upload className="h-3.5 w-3.5" /> Import from Markdown
          </button>
        </div>
      )}

      {/* Basic Info */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Basic information</h3>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Title <span className="text-destructive">*</span>
          </label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Adopt event-driven messaging for tenant provisioning"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Tags</label>
          <input
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="messaging, kafka, multi-tenant (comma-separated)"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Tabbed sections */}
      <div className="mt-4 rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex border-b border-border overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-5 space-y-5">
          {tab === "core" && (
            <>
              <RichEditor label="Context" value={form.context} onChange={(v) => setForm({ ...form, context: v })}
                placeholder="Describe the situation and forces at play. What is the issue that motivates this decision?" rows={8} />
              <RichEditor label="Decision" value={form.decision} onChange={(v) => setForm({ ...form, decision: v })}
                placeholder="State the decision that was made in clear, active voice." rows={6} />
              <RichEditor label="Consequences" value={form.consequences} onChange={(v) => setForm({ ...form, consequences: v })}
                placeholder="Positive, negative, and follow-up implications of this decision." rows={6} />
              <RichEditor label="Alternatives considered" value={form.alternatives} onChange={(v) => setForm({ ...form, alternatives: v })}
                placeholder="Other options evaluated and why they were not chosen." rows={5} />
            </>
          )}

          {tab === "design" && (
            <>
              <p className="text-xs text-muted-foreground -mt-1">Document specific technical changes resulting from this decision. Leave empty if not applicable.</p>
              {([
                ["api_changes", "API Changes", "Endpoint additions, removals, signature changes, versioning…"],
                ["workflow_changes", "Workflow Changes", "Process changes, sequence changes, orchestration updates…"],
                ["service_changes", "Service Changes", "New services, removed services, dependency changes…"],
                ["infrastructure_changes", "Infrastructure Changes", "Cloud resources, networking, deployment topology…"],
                ["data_model_changes", "Data Model Changes", "Schema additions, migrations, data structure changes…"],
              ] as const).map(([key, label, ph]) => (
                <RichEditor key={key} label={label} value={form.design_changes[key]} onChange={(v) => setDC(key, v)}
                  placeholder={ph} rows={4} />
              ))}
            </>
          )}

          {tab === "impacts" && (
            <>
              <p className="text-xs text-muted-foreground -mt-1">Assess the impact of this decision across key dimensions. Leave empty if not applicable.</p>
              {([
                ["operational", "Operational Impact", "Monitoring, alerting, on-call, runbooks, SLA impact…"],
                ["testing", "Testing Impact", "Test coverage changes, new test strategies, CI/CD…"],
                ["security", "Security Impact", "Threat model changes, authentication, authorization, data privacy…"],
                ["documentation", "Documentation Impact", "Docs to update, new docs needed, API docs, runbooks…"],
                ["scalability", "Scalability Impact", "Performance characteristics, scaling strategies, limits…"],
              ] as const).map(([key, label, ph]) => (
                <RichEditor key={key} label={label} value={form.major_impacts[key]} onChange={(v) => setMI(key, v)}
                  placeholder={ph} rows={4} />
              ))}
            </>
          )}

          {tab === "references" && (
            <>
              <p className="text-xs text-muted-foreground -mt-1">Link supporting resources for this decision.</p>
              {([
                ["pull_requests", "Pull Requests", "https://github.com/org/repo/pull/123"],
                ["git_commits", "Git Commits", "abc1234"],
                ["design_docs", "Design Documents", "https://…"],
                ["wiki_pages", "Wiki Pages", "https://wiki.company.com/…"],
                ["external", "External References", "https://…"],
              ] as const).map(([key, label, ph]) => (
                <RefList key={key} label={label} placeholder={ph}
                  items={form.references_data[key]}
                  onAdd={(v) => addRef(key, v)}
                  onRemove={(idx) => removeRef(key, idx)} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Submit */}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="h-10 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent">
          Cancel
        </button>
        <button disabled={busy} type="submit"
          className="h-10 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function RefList({ label, placeholder, items, onAdd, onRemove }: {
  label: string; placeholder: string;
  items: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void;
}) {
  const [val, setVal] = useState("");
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{label}</label>
      {items.length > 0 && (
        <div className="mb-2 space-y-1">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 rounded-md bg-accent/50 px-2.5 py-1.5 text-xs">
              <LinkIcon className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate font-mono">{item}</span>
              <button type="button" onClick={() => onRemove(idx)} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(val); setVal(""); } }}
          placeholder={placeholder}
          className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-xs font-mono"
        />
        <button type="button" onClick={() => { onAdd(val); setVal(""); }}
          className="h-8 w-8 rounded-md border border-border bg-card hover:bg-accent flex items-center justify-center">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
