import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getAdr, updateAdrStatus, approveAdr, revokeAdrApproval, addComment,
  getAdrRelationships, addAdrRelationship, removeAdrRelationship, publishAdr,
  searchAdrs, deleteAdr, assignAdrReviewer, resolveComment
} from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { SimpleMarkdown } from "@/components/decyra/RichEditor";
import { DEFAULT_ADR_FORM, type AdrFormData } from "@/components/decyra/AdrForm";
import { useAdrCollaboration, type AdrCollaborationState } from "@/hooks/useAdrCollaboration";
import { getErrorMessage } from "@/lib/utils";
import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Edit, Send, ThumbsUp, MessageSquare, GitCommit,
  GitBranch, Link as LinkIcon, X, Plus, Book, ChevronDown, ChevronRight,
  Eye, Rocket, ExternalLink, Trash2, UserCheck, CheckCircle2, Check, AtSign,
  History, Clock, FileEdit, Sparkles, ArrowRight
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/adrs/$adrId")({
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
  const revokeApprovalFn = useServerFn(revokeAdrApproval);
  const commentFn = useServerFn(addComment);
  const getRelFn = useServerFn(getAdrRelationships);
  const addRelFn = useServerFn(addAdrRelationship);
  const removeRelFn = useServerFn(removeAdrRelationship);
  const publishFn = useServerFn(publishAdr);
  const searchFn = useServerFn(searchAdrs);
  const deleteAdrFn = useServerFn(deleteAdr);
  const assignReviewerFn = useServerFn(assignAdrReviewer);
  const resolveCommentFn = useServerFn(resolveComment);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAdr, setDeletingAdr] = useState(false);

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

  const { data, isError, isLoading } = useQuery({
    queryKey: ["adr", adrId],
    queryFn: () => getAdrFn({ data: { id: adrId } }),
  });
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
  const hasUserApproved = Boolean(
    data?.hasUserApproved ??
      (data?.approvals ?? []).some(
        (a: any) => a.user_id === data?.currentUserId && a.decision === "approve",
      ),
  );

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
        toast.error(getErrorMessage(err, "Failed to publish ADR"));
      } finally { setBusy(""); }
      return;
    }
    setBusy("status");
    try {
      await updateStatusFn({ data: { id: adrId, status: nextStatus } });
      toast.success(`Moved to ${nextStatus.replace("_", " ")}`);
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
    } catch (err: any) { toast.error(getErrorMessage(err, "Failed to update ADR status")); }
    finally { setBusy(""); }
  }

  async function submitApproval(decision: "approve" | "request_changes") {
    setBusy("approve");
    try {
      await approveFn({ data: { adr_id: adrId, decision, note: approvalNote } });
      toast.success(decision === "approve" ? "Approved!" : "Requested Changes");
      setApprovalNote("");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
    } catch (err: any) { toast.error(getErrorMessage(err, "Failed to submit review")); }
    finally { setBusy(""); }
  }

  async function handleRevokeApproval() {
    setBusy("revoke");
    try {
      await revokeApprovalFn({ data: { adr_id: adrId } });
      toast.success("ADR approval revoked");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to revoke approval"));
    } finally {
      setBusy("");
    }
  }

  async function handleAssignReviewer(reviewerId: string | null) {
    setBusy("assign");
    try {
      await assignReviewerFn({ data: { adr_id: adrId, reviewer_id: reviewerId } });
      toast.success(reviewerId ? "Reviewer assigned" : "Reviewer unassigned");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to assign reviewer"));
    } finally {
      setBusy("");
    }
  }

  async function handleToggleResolve(commentId: string, isResolved: boolean) {
    try {
      await resolveCommentFn({ data: { comment_id: commentId, is_resolved: isResolved } });
      toast.success(isResolved ? "Comment marked as resolved" : "Comment reopened");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to update comment resolution"));
    }
  }

  function handleCommentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setComment(val);

    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/);

    if (match) {
      setMentionQuery(match[1].toLowerCase());
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(username: string) {
    if (!commentTextareaRef.current) return;
    const textarea = commentTextareaRef.current;
    const cursorPos = textarea.selectionStart ?? comment.length;
    const textBeforeCursor = comment.slice(0, cursorPos);
    const textAfterCursor = comment.slice(cursorPos);

    const match = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/);
    if (!match) return;

    const prefix = textBeforeCursor.slice(0, match.index);
    const nextComment = `${prefix}@${username} ${textAfterCursor}`;
    setComment(nextComment);
    setMentionQuery(null);

    setTimeout(() => {
      textarea.focus();
      const nextPos = (prefix + `@${username} `).length;
      textarea.setSelectionRange(nextPos, nextPos);
    }, 0);
  }

  const matchingMembers = mentionQuery !== null
    ? (data?.projectMembers ?? []).filter((m: any) => {
        const u = (m.username ?? "").toLowerCase();
        const n = (m.full_name ?? "").toLowerCase();
        return u.includes(mentionQuery) || n.includes(mentionQuery);
      })
    : [];

  async function submitComment() {
    if (!comment.trim()) return;
    setBusy("comment");
    try {
      await commentFn({ data: { adr_id: adrId, body: comment.trim() } });
      setComment("");
      setMentionQuery(null);
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
    } catch (err: any) { toast.error(getErrorMessage(err, "Failed to add comment")); }
    finally { setBusy(""); }
  }

  async function searchRels(q: string) {
    setRelSearch(q);
    if (q.length < 2) { setRelResults([]); return; }
    setRelSearching(true);
    try {
      const results = await searchFn({ data: { q } });
      setRelResults((results as any[]).filter((r: any) => r.id !== adrId));
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to search ADRs"));
    } finally { setRelSearching(false); }
  }

  async function addRel(targetId: string) {
    try {
      await addRelFn({ data: { source_adr_id: adrId, target_adr_id: targetId, rel_type: relType as any } });
      toast.success("Relationship added");
      setRelSearch(""); setRelResults([]);
      refetchRels();
    } catch (err: any) { toast.error(getErrorMessage(err, "Failed to add relationship")); }
  }

  async function removeRel(relId: string) {
    try {
      await removeRelFn({ data: { id: relId } });
      toast.success("Relationship removed");
      refetchRels();
    } catch (err: any) { toast.error(getErrorMessage(err, "Failed to remove relationship")); }
  }

  async function handleDeleteAdr() {
    setDeletingAdr(true);
    try {
      const result = await deleteAdrFn({ data: { id: adrId } });
      toast.success("Draft ADR deleted");
      qc.invalidateQueries({ queryKey: ["project", result?.project_id] });
      navigate({ to: "/projects/$projectId", params: { projectId: result!.project_id } });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to delete ADR"));
      setDeletingAdr(false);
      setShowDeleteConfirm(false);
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground animate-pulse">Loading…</div>;
  if (isError || !data) return <div className="p-8 text-sm text-muted-foreground">ADR not found.</div>;
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
        {rels && (
          <AdrCollaborationListener
            adrId={adrId}
            adr={adr}
            relationships={rels}
            invalidate={(queryKey) => {
              void qc.invalidateQueries({ queryKey });
            }}
          />
        )}
        {/* Back + edit */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: adr.project_id } })}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to project
          </button>
          <Link
            to="/adrs/$adrId/edit" params={{ adrId }}
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
                {adr.repository_deleted_at && (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    Archived from repository
                  </span>
                )}
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
                {adr.assigned_to_profile && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                      <UserCheck className="h-3 w-3" />
                      Reviewer: @{adr.assigned_to_profile.username || adr.assigned_to_profile.full_name}
                    </span>
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

        {/* Activity & Edit Timeline */}
        <Collapsible
          title={`Activity & Edit Timeline (${(data?.timeline ?? []).length})`}
          icon={<History className="h-4 w-4" />}
          defaultOpen={true}
        >
          {(data?.timeline ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3">No activity recorded yet.</p>
          ) : (
            <div className="relative pl-6 space-y-4 pt-4 pb-1 before:absolute before:left-2 before:top-4 before:bottom-3 before:w-0.5 before:bg-border">
              {(data?.timeline as any[]).map((evt) => {
                const badge = getTimelineBadge(evt.event_type);
                const changes = evt.changes ?? {};
                const actorName =
                  evt.profiles?.full_name ||
                  evt.profiles?.username ||
                  (evt.event_type === "git_synced" ? "Git Sync" : "System");
                const username = evt.profiles?.username;
                const dateStr = new Date(evt.created_at).toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <div key={evt.id} className="relative group">
                    <div className="absolute -left-6 top-1 grid h-4 w-4 -translate-x-1/2 place-items-center rounded-full bg-card border border-border text-[9px] shadow-sm">
                      {badge.icon}
                    </div>

                    <div className="rounded-lg border border-border/80 bg-background/50 p-3 hover:border-border transition-colors">
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.color}`}
                          >
                            {badge.label}
                          </span>
                          <span className="text-xs font-semibold text-foreground">{actorName}</span>
                          {username && (
                            <span className="text-[11px] text-muted-foreground font-mono">@{username}</span>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3 opacity-60" />
                          {dateStr}
                        </span>
                      </div>

                      <div className="text-xs font-medium text-foreground/90 mt-1">
                        {evt.summary}
                      </div>

                      {/* Changed fields badges */}
                      {Array.isArray(changes.changed_fields) && changes.changed_fields.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-2 pt-2 border-t border-border/40">
                          <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                            Edited sections:
                          </span>
                          {changes.changed_fields.map((f: string) => (
                            <span
                              key={f}
                              className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary/10 text-primary border border-primary/20"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Status change details */}
                      {changes.previous_status &&
                        changes.next_status &&
                        changes.previous_status !== changes.next_status && (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-2">
                            <span className="font-semibold text-[10px] uppercase">Status:</span>
                            <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                              {changes.previous_status}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-semibold">
                              {changes.next_status}
                            </span>
                          </div>
                        )}

                      {/* Version details */}
                      {changes.version && (
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                          <span className="font-mono text-primary font-bold">v{changes.version}</span>
                          {changes.git_commit_hash && (
                            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                              commit {changes.git_commit_hash.slice(0, 7)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Note */}
                      {changes.note && (
                        <p className="mt-2 text-xs text-muted-foreground italic bg-muted/40 p-2 rounded border border-border/40">
                          "{changes.note}"
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Collapsible>

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
          {(data.comments ?? []).map((c: any) => {
            if (c.body.startsWith("📋")) {
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2 p-2.5 my-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs text-muted-foreground"
                >
                  <UserCheck className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="flex-1 font-medium">{renderCommentWithMentions(c.body)}</span>
                  <span className="text-[10px] opacity-70 shrink-0">
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={c.id}
                className={`flex gap-3 mb-3 p-2.5 rounded-xl border transition-colors ${
                  c.is_resolved
                    ? "border-emerald-500/30 bg-emerald-500/[0.03]"
                    : "border-border bg-background"
                }`}
              >
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold">
                  {(c.profiles?.full_name ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold">{c.profiles?.full_name ?? "User"}</span>
                      {c.profiles?.username && (
                        <span className="text-[10px] text-muted-foreground">@{c.profiles.username}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Resolution button & badge */}
                    <div className="flex items-center gap-2 shrink-0">
                      {c.is_resolved ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            <Check className="h-3 w-3" />
                            Resolved{c.resolved_by_profile ? ` by ${c.resolved_by_profile.full_name}` : ""}
                          </span>
                          <button
                            onClick={() => handleToggleResolve(c.id, false)}
                            className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors"
                            title="Reopen comment"
                          >
                            Reopen
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleToggleResolve(c.id, true)}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 font-medium px-2 py-0.5 rounded hover:bg-emerald-500/10 transition-colors"
                          title="Mark comment as resolved"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Resolve
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{renderCommentWithMentions(c.body)}</p>
                </div>
              </div>
            );
          })}

          {/* Comment input with @mention autocomplete */}
          <div className="relative mt-3">
            {mentionQuery !== null && matchingMembers.length > 0 && (
              <div className="absolute bottom-full mb-1 left-0 w-64 max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-20 divide-y divide-border/60 animate-in fade-in duration-150">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
                  Tag member
                </div>
                {matchingMembers.map((m: any) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => insertMention(m.username || m.email?.split("@")[0])}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
                  >
                    <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                      {(m.full_name || m.username || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{m.full_name || m.username}</div>
                      <div className="text-[10px] text-muted-foreground truncate">@{m.username || m.email?.split("@")[0]}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <textarea
                ref={commentTextareaRef}
                value={comment}
                onChange={handleCommentChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitComment();
                  }
                }}
                rows={2}
                placeholder="Add a comment… Type @ to mention a team member (Cmd+Enter to submit)"
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={submitComment}
                disabled={!comment.trim() || busy === "comment"}
                className="self-end h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center justify-center"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
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

            {/* Approve/Reject / Revoke (under review) */}
            {adr.status === "under_review" && canApprove && (
              <div className="space-y-2">
                {hasUserApproved ? (
                  <div className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-success flex items-center gap-1.5">
                        <ThumbsUp className="h-3.5 w-3.5 text-success" />
                        You approved this ADR
                      </span>
                    </div>
                    <button
                      onClick={handleRevokeApproval}
                      disabled={busy === "revoke"}
                      className="w-full h-8 rounded-md border border-destructive/40 bg-card px-2 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <X className="h-3.5 w-3.5" />
                      {busy === "revoke" ? "Revoking…" : "Revoke Approval"}
                    </button>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={approvalNote}
                      onChange={(e) => setApprovalNote(e.target.value)}
                      rows={2}
                      placeholder="Optional review note…"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs resize-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => submitApproval("approve")}
                        disabled={busy === "approve"}
                        className="h-8 rounded-md bg-success px-2 text-xs font-medium text-success-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => submitApproval("request_changes")}
                        disabled={busy === "approve"}
                        className="h-8 rounded-md bg-destructive px-2 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Delete draft ADR */}
          {adr.status === "draft" && canPublish && (
            <div className="mt-3 pt-3 border-t border-border">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full h-9 rounded-md border border-destructive/40 bg-card px-3 text-sm font-medium text-destructive hover:bg-destructive/10 flex items-center justify-center gap-2"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete draft
              </button>
            </div>
          )}

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
                    <span className="truncate font-medium">
                      {a.profiles?.full_name ?? "User"}
                      {a.user_id === data?.currentUserId ? " (you)" : ""}
                    </span>
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
                    <span className="truncate font-medium">
                      {a.profiles?.full_name ?? "User"}
                      {a.user_id === data?.currentUserId ? " (you)" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Reviewer Assignment */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assigned Reviewer</h3>
            <UserCheck className="h-4 w-4 text-amber-500" />
          </div>

          {adr.assigned_to_profile ? (
            <div className="flex items-center gap-2.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-600 dark:text-amber-400">
                {(adr.assigned_to_profile.full_name || adr.assigned_to_profile.username || "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground truncate">{adr.assigned_to_profile.full_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">@{adr.assigned_to_profile.username}</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mb-3 italic">No reviewer assigned yet.</p>
          )}

          <select
            value={adr.assigned_to ?? ""}
            onChange={(e) => handleAssignReviewer(e.target.value ? e.target.value : null)}
            disabled={busy === "assign"}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">{adr.assigned_to ? "Unassign reviewer" : "Assign a reviewer…"}</option>
            {(data.projectMembers ?? []).map((m: any) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ? `${m.full_name} (@${m.username || 'user'})` : m.username || m.email}
              </option>
            ))}
          </select>
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
                      <Link to="/adrs/$adrId" params={{ adrId: otherId }}
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
          to="/projects/$projectId/graph" params={{ projectId: adr.project_id }}
          className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <GitBranch className="h-4 w-4 shrink-0" />
          View relationship graph
          <ChevronRight className="h-3.5 w-3.5 ml-auto" />
        </Link>
      </aside>

      {/* ── Delete ADR Confirmation ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Delete draft ADR</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-foreground font-mono">{adr.full_id}</span>?{" "}
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="h-10 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent">Cancel</button>
              <button disabled={deletingAdr} onClick={handleDeleteAdr}
                className="h-10 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50">
                {deletingAdr ? "Deleting…" : "Delete ADR"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AdrCollaborationListener({
  adrId,
  adr,
  relationships,
  invalidate,
}: {
  adrId: string;
  adr: Record<string, any>;
  relationships: unknown[];
  invalidate: (queryKey: string[]) => void;
}) {
  const statusRef = useRef(adr.status);
  const relationshipsRevisionRef = useRef<string | undefined>(undefined);
  const form: AdrFormData = {
    ...DEFAULT_ADR_FORM,
    title: adr.title ?? "",
    tags: (adr.tags ?? []).join(", "),
    context: adr.context ?? "",
    decision: adr.decision ?? "",
    consequences: adr.consequences ?? "",
    alternatives: adr.alternatives ?? "",
    design_changes: { ...DEFAULT_ADR_FORM.design_changes, ...(adr.design_changes ?? {}) },
    major_impacts: { ...DEFAULT_ADR_FORM.major_impacts, ...(adr.major_impacts ?? {}) },
    references_data: { ...DEFAULT_ADR_FORM.references_data, ...(adr.references_data ?? {}) },
  };
  const initialState: AdrCollaborationState = { form, status: adr.status, relationships };

  useAdrCollaboration(adrId, initialState, {
    syncLocalForm: false,
    onRemoteChange: (state) => {
      if (state.status !== statusRef.current) {
        statusRef.current = state.status;
        invalidate(["adr", adrId]);
      }
      if (
        state.relationshipsRevision &&
        state.relationshipsRevision !== relationshipsRevisionRef.current
      ) {
        relationshipsRevisionRef.current = state.relationshipsRevision;
        invalidate(["adr-rels", adrId]);
      }
    },
  });
  return null;
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h2>
      <MarkdownProse body={body} />
    </div>
  );
}

function Collapsible({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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

function getTimelineBadge(type: string) {
  switch (type) {
    case "created":
      return {
        icon: <Sparkles className="h-2.5 w-2.5 text-emerald-500" />,
        label: "Created",
        color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      };
    case "edited":
      return {
        icon: <FileEdit className="h-2.5 w-2.5 text-blue-500" />,
        label: "Edited",
        color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      };
    case "status_changed":
      return {
        icon: <GitCommit className="h-2.5 w-2.5 text-amber-500" />,
        label: "Status Changed",
        color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      };
    case "reviewer_assigned":
      return {
        icon: <UserCheck className="h-2.5 w-2.5 text-purple-500" />,
        label: "Reviewer Assigned",
        color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
      };
    case "approved":
      return {
        icon: <ThumbsUp className="h-2.5 w-2.5 text-emerald-500" />,
        label: "Approved",
        color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      };
    case "changes_requested":
      return {
        icon: <X className="h-2.5 w-2.5 text-rose-500" />,
        label: "Changes Requested",
        color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      };
    case "approval_revoked":
      return {
        icon: <X className="h-2.5 w-2.5 text-amber-500" />,
        label: "Approval Revoked",
        color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      };
    case "comment_resolved":
      return {
        icon: <CheckCircle2 className="h-2.5 w-2.5 text-teal-500" />,
        label: "Resolved",
        color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
      };
    case "published":
      return {
        icon: <Rocket className="h-2.5 w-2.5 text-violet-500" />,
        label: "Published",
        color: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
      };
    case "git_synced":
      return {
        icon: <GitBranch className="h-2.5 w-2.5 text-cyan-500" />,
        label: "Git Sync",
        color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
      };
    default:
      return {
        icon: <Clock className="h-2.5 w-2.5 text-muted-foreground" />,
        label: "Activity",
        color: "bg-muted text-muted-foreground border-border",
      };
  }
}

function MarkdownProse({ body }: { body: string }) {
  if (!body?.trim()) return <p className="text-sm text-muted-foreground italic">Not provided</p>;
  return <div className="text-sm leading-relaxed text-foreground prose-sm max-w-none"><SimpleMarkdown text={body} /></div>;
}

function renderCommentWithMentions(text: string) {
  const parts = text.split(/(@[a-zA-Z0-9_-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded bg-primary/15 text-primary font-semibold px-1 py-0.5 text-xs mx-0.5"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

