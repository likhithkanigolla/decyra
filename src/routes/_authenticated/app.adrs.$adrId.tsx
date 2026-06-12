import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getAdr, updateAdrStatus, approveAdr, addComment,
  getAdrRelationships, addAdrRelationship, removeAdrRelationship, publishAdr,
  searchAdrs
} from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { SimpleMarkdown } from "@/components/decyra/RichEditor";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Edit, Send, ThumbsUp, MessageSquare, GitCommit,
  GitBranch, Link as LinkIcon, X, Plus, Book, ChevronDown, ChevronRight,
  Eye, Rocket, ExternalLink
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/adrs/$adrId")({
  head: () => ({ meta: [{ title: "ADR — Decyra" }] }),
  component: AdrDetail,
});

const STATUS_FLOW: Record<string, string | null> = {
  draft: "under_review",
  under_review: "approved",
  approved: "published",
  published: null,
  superseded: null,
};

const REL_TYPE_LABELS: Record<string, string> = {
  depends_on: "Depends on",
  related_to: "Related to",
  supersedes: "Supersedes",
  superseded_by: "Superseded by",
  conflicts_with: "Conflicts with",
  affects: "Affects",
};

function AdrDetail() {
  const { adrId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getAdrFn = useServerFn(getAdr);
  const updateStatusFn = useServerFn(updateAdrStatus);
  const approveFn = useServerFn(approveAdr);
  const commentFn = useServerFn(addComment);
  const getRelFn = useServerFn(getAdrRelationships);
  const addRelFn = useServerFn(addAdrRelationship);
  const removeRelFn = useServerFn(removeAdrRelationship);
  const publishFn = useServerFn(publishAdr);
  const searchFn = useServerFn(searchAdrs);

  const { data } = useQuery({ queryKey: ["adr", adrId], queryFn: () => getAdrFn({ data: { id: adrId } }) });
  const { data: rels, refetch: refetchRels } = useQuery({
    queryKey: ["adr-rels", adrId],
    queryFn: () => getRelFn({ data: { adr_id: adrId } }),
  });

  const [approvalNote, setApprovalNote] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [showVersions, setShowVersions] = useState(false);

  // Relationship panel
  const [relSearch, setRelSearch] = useState("");
  const [relType, setRelType] = useState("related_to");
  const [relResults, setRelResults] = useState<any[]>([]);
  const [relSearching, setRelSearching] = useState(false);

  const adr = data?.adr;
  const isAdmin = data?.isAdmin;
  const myRole = data?.myRole;
  const canPublish = isAdmin || myRole === "project_admin";
  const canApprove = myRole !== "intern" && (isAdmin || myRole);
  const nextStatus = adr ? STATUS_FLOW[adr.status] : null;

  async function moveStatus() {
    if (!nextStatus || !adr) return;
    if (nextStatus === "published") {
      // Use publishAdr instead of simple status update
      setBusy("publish");
      try {
        const result = await publishFn({ data: { adr_id: adrId } });
        toast.success(`Published as v${result.version}${result.gitCommitHash ? ` (${result.gitCommitHash.slice(0,7)})` : ""}`);
        qc.invalidateQueries({ queryKey: ["adr", adrId] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      } catch (err: any) {
        toast.error(err.message);
      } finally { setBusy(""); }
      return;
    }
    setBusy("status");
    try {
      await updateStatusFn({ data: { id: adrId, status: nextStatus } });
      toast.success(`Moved to ${nextStatus.replace("_", " ")}`);
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(""); }
  }

  async function submitApproval(decision: "approve" | "request_changes") {
    setBusy("approve");
    try {
      await approveFn({ data: { adr_id: adrId, decision, note: approvalNote } });
      toast.success(decision === "approve" ? "Approved!" : "Requested Changes");
      setApprovalNote("");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(""); }
  }

  async function submitComment() {
    if (!comment.trim()) return;
    setBusy("comment");
    try {
      await commentFn({ data: { adr_id: adrId, body: comment.trim() } });
      setComment("");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(""); }
  }

  async function searchRels(q: string) {
    setRelSearch(q);
    if (q.length < 2) { setRelResults([]); return; }
    setRelSearching(true);
    try {
      const results = await searchFn({ data: { q } });
      setRelResults((results as any[]).filter((r: any) => r.id !== adrId));
    } finally { setRelSearching(false); }
  }

  async function addRel(targetId: string) {
    try {
      await addRelFn({ data: { source_adr_id: adrId, target_adr_id: targetId, rel_type: relType as any } });
      toast.success("Relationship added");
      setRelSearch(""); setRelResults([]);
      refetchRels();
    } catch (err: any) { toast.error(err.message); }
  }

  async function removeRel(relId: string) {
    try {
      await removeRelFn({ data: { id: relId } });
      toast.success("Relationship removed");
      refetchRels();
    } catch (err: any) { toast.error(err.message); }
  }

  if (!data) return <div className="p-8 text-sm text-muted-foreground animate-pulse">Loading…</div>;
  if (!adr) return <div className="p-8 text-sm text-muted-foreground">ADR not found.</div>;

  const dc = adr.design_changes ?? {};
  const mi = adr.major_impacts ?? {};
  const refs = adr.references_data ?? {};

  const hasDc = Object.values(dc).some((v: any) => v?.trim());
  const hasMi = Object.values(mi).some((v: any) => v?.trim());
  const hasRefs = Object.values(refs).some((v: any) => Array.isArray(v) && v.length > 0);

  return (
    <div className="flex min-h-screen">
      {/* Main content */}
      <div className="flex-1 min-w-0 p-8 max-w-4xl">
        {/* Back + edit */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => navigate({ to: "/app/projects/$projectId", params: { projectId: adr.project_id } })}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to project
          </button>
          <Link
            to="/app/adrs/$adrId/edit" params={{ adrId }}
            className="inline-flex items-center gap-1.5 h-8 rounded-md border border-border bg-card px-3 text-xs hover:bg-accent"
          >
            <Edit className="h-3.5 w-3.5" /> Edit
          </Link>
        </div>

        {/* ADR Header */}
        <div className="rounded-xl border border-border bg-card p-6 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-sm font-bold text-primary">{adr.full_id}</span>
                <StatusBadge status={adr.status} />
                {adr.current_version > 0 && (
                  <span className="text-xs bg-accent px-1.5 py-0.5 rounded font-mono">v{adr.current_version}</span>
                )}
              </div>
              <h1 className="text-xl font-semibold tracking-tight">{adr.title}</h1>
              <div className="mt-2 flex items-center flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{adr.projects?.name ?? "Unknown project"}</span>
                <span>·</span>
                <span>{new Date(adr.created_at).toLocaleDateString()}</span>
                {(adr.tags ?? []).length > 0 && (
                  <>
                    <span>·</span>
                    <div className="flex flex-wrap gap-1">
                      {(adr.tags as string[]).map((t) => (
                        <span key={t} className="rounded-full bg-primary/10 text-primary px-2 py-0.5">{t}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Core Sections */}
        {[
          { label: "Context", body: adr.context },
          { label: "Decision", body: adr.decision },
          { label: "Consequences", body: adr.consequences },
          { label: "Alternatives Considered", body: adr.alternatives },
        ].filter((s) => s.body?.trim()).map((s) => (
          <Section key={s.label} title={s.label} body={s.body} />
        ))}

        {/* Design Changes */}
        {hasDc && (
          <Collapsible title="Design Changes" icon={<GitBranch className="h-4 w-4" />}>
            {[
              ["API Changes", dc.api_changes],
              ["Workflow Changes", dc.workflow_changes],
              ["Service Changes", dc.service_changes],
              ["Infrastructure Changes", dc.infrastructure_changes],
              ["Data Model Changes", dc.data_model_changes],
            ].filter(([, v]) => v?.trim()).map(([label, body]) => (
              <div key={label as string} className="mb-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</h4>
                <MarkdownProse body={body as string} />
              </div>
            ))}
          </Collapsible>
        )}

        {/* Major Impacts */}
        {hasMi && (
          <Collapsible title="Major Impacts" icon={<Eye className="h-4 w-4" />}>
            <div className="grid grid-cols-1 gap-4">
              {[
                ["Operational", mi.operational],
                ["Testing", mi.testing],
                ["Security", mi.security],
                ["Documentation", mi.documentation],
                ["Scalability", mi.scalability],
              ].filter(([, v]) => v?.trim()).map(([label, body]) => (
                <div key={label as string}>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</h4>
                  <MarkdownProse body={body as string} />
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* References */}
        {hasRefs && (
          <Collapsible title="References" icon={<LinkIcon className="h-4 w-4" />}>
            {[
              ["Pull Requests", refs.pull_requests],
              ["Git Commits", refs.git_commits],
              ["Design Documents", refs.design_docs],
              ["Wiki Pages", refs.wiki_pages],
              ["External References", refs.external],
            ].filter(([, v]) => (v as string[])?.length).map(([label, items]) => (
              <div key={label as string} className="mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</h4>
                <ul className="space-y-1">
                  {(items as string[]).map((ref, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      {ref.startsWith("http") ? (
                        <a href={ref} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate">{ref}</a>
                      ) : (
                        <span className="font-mono text-muted-foreground">{ref}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Collapsible>
        )}

        {/* Published Versions */}
        {(data.publishedVersions ?? []).length > 0 && (
          <Collapsible title={`Published Versions (${data.publishedVersions.length})`} icon={<Book className="h-4 w-4" />}>
            <div className="space-y-2">
              {data.publishedVersions.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold text-primary">v{v.version_number}</span>
                    <div>
                      <div className="text-xs text-muted-foreground">{new Date(v.published_at).toLocaleDateString()}</div>
                      {v.git_commit_hash && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <GitCommit className="h-2.5 w-2.5 text-muted-foreground" />
                          <span className="font-mono text-[10px] text-muted-foreground">{v.git_commit_hash.slice(0, 7)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => { const blob = new Blob([v.markdown], {type:"text/markdown"}); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${adr.full_id}-v${v.version_number}.md`; a.click(); }}
                    className="text-xs text-primary hover:underline"
                  >
                    Download .md
                  </button>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* Discussion / Comments */}
        <div className="mt-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Discussion</h3>
          </div>

          {/* Approvals history */}
          {(data.approvals ?? []).length > 0 && (
            <div className="mb-4 space-y-2">
              {data.approvals.map((a: any) => (
                <div key={a.id} className={`rounded-lg p-3 border text-sm ${a.decision === "approve" ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
                  <div className="flex items-center gap-2">
                    <ThumbsUp className={`h-3.5 w-3.5 ${a.decision === "approve" ? "text-success" : "text-destructive"}`} />
                    <span className="font-medium">{a.profiles?.full_name ?? "User"}</span>
                    <span className={a.decision === "approve" ? "text-success" : "text-destructive"}>{a.decision === "approve" ? "Approved" : "Requested Changes"}</span>
                    <span className="text-muted-foreground ml-auto text-xs">{new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                  {a.note && <p className="mt-1.5 text-xs text-muted-foreground">{a.note}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Comments */}
          {(data.comments ?? []).map((c: any) => (
            <div key={c.id} className="flex gap-3 mb-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold">
                {(c.profiles?.full_name ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium">{c.profiles?.full_name ?? "User"}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-sm">{c.body}</p>
              </div>
            </div>
          ))}

          {/* Comment input */}
          <div className="flex gap-2 mt-3">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment(); }}
              rows={2}
              placeholder="Add a comment… (Cmd+Enter to submit)"
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
            />
            <button
              onClick={submitComment}
              disabled={!comment.trim() || busy === "comment"}
              className="self-end h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <aside className="w-72 shrink-0 border-l border-border p-5 space-y-5">
        {/* Actions */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Actions</h3>
          <div className="space-y-2">
            {nextStatus && nextStatus !== "published" && (
              <button
                onClick={moveStatus}
                disabled={busy === "status"}
                className="w-full h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="h-3.5 w-3.5" />
                {nextStatus === "under_review" ? "Submit for review" : nextStatus === "approved" ? "Mark approved" : ""}
              </button>
            )}
            {adr.status === "approved" && canPublish && (
              <button
                onClick={moveStatus}
                disabled={busy === "publish"}
                className="w-full h-9 rounded-md bg-success px-3 text-sm font-medium text-success-foreground hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Rocket className="h-3.5 w-3.5" />
                {busy === "publish" ? "Publishing…" : "Publish ADR"}
              </button>
            )}

            {/* Approve/Reject (under review) */}
            {adr.status === "under_review" && canApprove && (
              <div className="space-y-2">
                <textarea value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)}
                  rows={2} placeholder="Optional review note…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs resize-none" />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => submitApproval("approve")} disabled={busy === "approve"}
                    className="h-8 rounded-md bg-success px-2 text-xs font-medium text-success-foreground hover:opacity-90 disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => submitApproval("request_changes")} disabled={busy === "approve"}
                    className="h-8 rounded-md bg-destructive px-2 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50">
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Approval progress */}
          {adr.status === "under_review" && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Approvals</span>
                <span>{(data.approvals ?? []).filter((a: any) => a.decision === "approve").length} / {adr.projects?.required_approvals ?? 3}</span>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full bg-success rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((data.approvals ?? []).filter((a: any) => a.decision === "approve").length / (adr.projects?.required_approvals ?? 3)) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Approved By List */}
          {(data.approvals ?? []).filter((a: any) => a.decision === "approve").length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Approved By</h4>
              <div className="space-y-1.5">
                {(data.approvals ?? []).filter((a: any) => a.decision === "approve").map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <div className="h-5 w-5 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                      <ThumbsUp className="h-2.5 w-2.5 text-success" />
                    </div>
                    <span className="truncate font-medium">{a.profiles?.full_name ?? "User"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rejected By List */}
          {(data.approvals ?? []).filter((a: any) => a.decision === "request_changes").length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Changes Requested By</h4>
              <div className="space-y-1.5">
                {(data.approvals ?? []).filter((a: any) => a.decision === "request_changes").map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <div className="h-5 w-5 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                      <ThumbsUp className="h-2.5 w-2.5 text-destructive rotate-180" />
                    </div>
                    <span className="truncate font-medium">{a.profiles?.full_name ?? "User"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Relationships */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Relationships</h3>

          {(rels ?? []).length > 0 && (
            <div className="space-y-1.5 mb-3">
              {(rels as any[]).map((r) => {
                const isSource = r.source_adr_id === adrId;
                const otherId = isSource ? r.target_adr_id : r.source_adr_id;
                const otherFullId = isSource ? (r.target_full_id || r.target?.full_id) : (r.source_full_id || r.source?.full_id);
                const otherTitle = isSource ? (r.target_title || r.target?.title) : (r.source_title || r.source?.title);
                return (
                  <div key={r.id} className="flex items-center gap-2 text-xs p-2 rounded-md bg-accent/50">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-muted-foreground">{REL_TYPE_LABELS[r.rel_type]}</div>
                      <Link to="/app/adrs/$adrId" params={{ adrId: otherId }}
                        className="truncate text-primary hover:underline block">{otherFullId}</Link>
                    </div>
                    <button onClick={() => removeRel(r.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add relationship */}
          <select value={relType} onChange={(e) => setRelType(e.target.value)}
            className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs mb-2">
            {Object.entries(REL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input
            value={relSearch}
            onChange={(e) => searchRels(e.target.value)}
            placeholder="Search for an ADR…"
            className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs"
          />
          {relResults.length > 0 && (
            <div className="mt-1 rounded-md border border-border bg-card shadow-md divide-y divide-border max-h-40 overflow-y-auto">
              {relResults.map((r: any) => (
                <button key={r.id} onClick={() => addRel(r.id)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2">
                  <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="font-mono text-muted-foreground">{r.full_id}</span>
                  <span className="truncate">{r.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Graph link */}
        <Link
          to="/app/projects/$projectId/graph" params={{ projectId: adr.project_id }}
          className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <GitBranch className="h-4 w-4 shrink-0" />
          View relationship graph
          <ChevronRight className="h-3.5 w-3.5 ml-auto" />
        </Link>
      </aside>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h2>
      <MarkdownProse body={body} />
    </div>
  );
}

function Collapsible({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3.5 text-sm font-medium hover:bg-accent/50 transition-colors"
      >
        <span className="text-muted-foreground">{icon}</span>
        {title}
        {open ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-border">{children}</div>}
    </div>
  );
}

function MarkdownProse({ body }: { body: string }) {
  if (!body?.trim()) return <p className="text-sm text-muted-foreground italic">Not provided</p>;
  return <div className="text-sm leading-relaxed text-foreground prose-sm max-w-none"><SimpleMarkdown text={body} /></div>;
}
