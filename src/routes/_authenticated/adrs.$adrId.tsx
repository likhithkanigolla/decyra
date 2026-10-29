import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getAdr, updateAdrStatus, approveAdr, revokeAdrApproval, addComment,
  getAdrRelationships, addAdrRelationship, removeAdrRelationship, publishAdr,
  searchAdrs, deleteAdr, assignAdrReviewer, resolveComment, submitFinalDecision,
  requestAdrReview, revokeAdrReviewRequest
} from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { SimpleMarkdown } from "@/components/decyra/RichEditor";
import { DEFAULT_ADR_FORM, type AdrFormData } from "@/components/decyra/AdrForm";
import { useAdrCollaboration, type AdrCollaborationState } from "@/hooks/useAdrCollaboration";
import { getErrorMessage, validateOverrideRationale } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Edit, Send, ThumbsUp, MessageSquare, GitCommit,
  GitBranch, Link as LinkIcon, X, Plus, Book, ChevronDown, ChevronRight, ChevronLeft,
  Eye, Rocket, ExternalLink, Trash2, UserCheck, CheckCircle2, Check, AtSign,
  History, Clock, FileEdit, Sparkles, ArrowRight, Hash, Shield, XCircle, AlertTriangle
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
  rejected: null,
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
  const requestReviewFn = useServerFn(requestAdrReview);
  const revokeReviewRequestFn = useServerFn(revokeAdrReviewRequest);
  const resolveCommentFn = useServerFn(resolveComment);
  const finalDecisionFn = useServerFn(submitFinalDecision);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAdr, setDeletingAdr] = useState(false);

  // @mention and #adr autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [adrRefQuery, setAdrRefQuery] = useState<string | null>(null);
  const [finalComment, setFinalComment] = useState("");
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
  const prevAdr = data?.prevAdr;
  const nextAdr = data?.nextAdr;
  const currentIndex = data?.currentIndex;
  const totalAdrs = data?.totalAdrs;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowLeft" && prevAdr?.id) {
        e.preventDefault();
        navigate({ to: "/adrs/$adrId", params: { adrId: prevAdr.id } });
      } else if (e.key === "ArrowRight" && nextAdr?.id) {
        e.preventDefault();
        navigate({ to: "/adrs/$adrId", params: { adrId: nextAdr.id } });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prevAdr?.id, nextAdr?.id, navigate]);

  const isAdmin = data?.isAdmin;
  const myRole = data?.myRole;
  const canPublish = isAdmin || myRole === "project_admin";
  const canApprove = myRole !== "intern" && (isAdmin || myRole);
  const nextStatus = adr ? STATUS_FLOW[adr.status] : null;
  const isFinalized = Boolean(
    (adr?.current_version ?? 0) > 0 ||
      adr?.status === "published" ||
      adr?.status === "superseded",
  );
  const myReviewDecision = data?.myReviewDecision;
  const hasUserApproved = Boolean(
    myReviewDecision === "approve" ||
      (data?.approvals ?? []).some(
        (a: any) => a.user_id === data?.currentUserId && a.decision === "approve",
      ),
  );
  const hasUserDecided = Boolean(
    myReviewDecision ||
      (data?.approvals ?? []).some((a: any) => a.user_id === data?.currentUserId),
  );
  const hasRejections = Boolean(
    (data?.approvals ?? []).some((a: any) => a.decision === "request_changes"),
  );

  const requiredApprovals = adr?.projects?.required_approvals ?? 3;
  const approvedCount = (data?.approvals ?? []).filter((a: any) => a.decision === "approve").length;
  const rejectedCount = (data?.approvals ?? []).filter((a: any) => a.decision === "request_changes").length;
  const userPersonallyRejected = myReviewDecision === "request_changes";
  const isApproveOverride = approvedCount < requiredApprovals || rejectedCount > 0 || userPersonallyRejected;

  const reviewRequests: any[] = (data as any)?.reviewRequests ?? [];
  const pendingReviewers: any[] = (data as any)?.pendingReviewers ?? [];
  const isLockedByReviewers = pendingReviewers.length > 0;

  function autoFillAdminRationale(decision: "approved" | "rejected") {
    if (decision === "approved") {
      setFinalComment("Standard project review criteria have been met. Approving decision for engineering implementation.");
    } else {
      setFinalComment(
        "This decision is declined after evaluating the architectural trade-offs. The team will pursue the proposed alternatives outlined in the document."
      );
    }
  }

  async function handlePublish(publishAs?: "published" | "rejected") {
    if (isLockedByReviewers) {
      toast.error(
        `Cannot publish ADR: Review is still pending from requested reviewer(s): ${pendingReviewers.map((r: any) => '@' + (r.username || r.full_name || 'user')).join(', ')}. Requested reviews must be completed or explicitly revoked.`
      );
      return;
    }
    setBusy("publish");
    try {
      const result = await publishFn({ data: { adr_id: adrId, publish_as: publishAs } });
      const label = result.status === "rejected" ? "Published as Rejected" : "Published";
      toast.success(`${label} as v${result.version}${result.gitCommitHash ? ` (${result.gitCommitHash.slice(0, 7)})` : ""}`);
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to publish ADR"));
    } finally {
      setBusy("");
    }
  }

  async function handleMarkRejected() {
    setBusy("status");
    try {
      await updateStatusFn({ data: { id: adrId, status: "rejected" } });
      toast.success("ADR marked as Rejected");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to update ADR status"));
    } finally {
      setBusy("");
    }
  }

  async function moveStatus() {
    if (!nextStatus || !adr) return;
    if (nextStatus === "published") {
      await handlePublish("published");
      return;
    }
    setBusy("status");
    try {
      await updateStatusFn({ data: { id: adrId, status: nextStatus as any } });
      toast.success(`Moved to ${nextStatus.replace("_", " ")}`);
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
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

  async function handleRequestReview(reviewerId: string) {
    if (!reviewerId) return;
    setBusy("request_review");
    try {
      await requestReviewFn({ data: { adr_id: adrId, reviewer_id: reviewerId } });
      toast.success("Review requested");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to request review"));
    } finally {
      setBusy("");
    }
  }

  async function handleRevokeReviewRequest(reviewerId: string) {
    setBusy("revoke_review");
    try {
      await revokeReviewRequestFn({ data: { adr_id: adrId, reviewer_id: reviewerId } });
      toast.success("Review request revoked and logged");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to revoke review request"));
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

  async function handleFinalDecision(decision: "approved" | "rejected") {
    if (isLockedByReviewers) {
      toast.error(
        `Cannot make final decision: Review is still pending from requested reviewer(s): ${pendingReviewers.map((r: any) => '@' + (r.username || r.full_name || 'user')).join(', ')}. Requested reviews must be completed or explicitly revoked.`
      );
      return;
    }
    if (decision === "approved" && isApproveOverride) {
      const check = validateOverrideRationale(finalComment);
      if (!check.valid) {
        toast.error(check.error || "A detailed rationale comment is mandatory when overriding review criteria or rejections.");
        return;
      }
    }
    setBusy("final_decision");
    try {
      await finalDecisionFn({
        data: {
          adr_id: adrId,
          decision,
          comment: finalComment.trim() || undefined,
        },
      });
      toast.success(`Admin final decision applied: ${decision.toUpperCase()}`);
      setFinalComment("");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to submit final decision"));
    } finally {
      setBusy("");
    }
  }

  function handleCommentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setComment(val);

    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/);
    const adrMatch = textBeforeCursor.match(/#([a-zA-Z0-9_-]*)$/);

    if (mentionMatch) {
      setMentionQuery(mentionMatch[1].toLowerCase());
      setAdrRefQuery(null);
    } else if (adrMatch) {
      setAdrRefQuery(adrMatch[1].toLowerCase());
      setMentionQuery(null);
    } else {
      setMentionQuery(null);
      setAdrRefQuery(null);
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

  function insertAdrRef(fullId: string) {
    if (!commentTextareaRef.current) return;
    const textarea = commentTextareaRef.current;
    const cursorPos = textarea.selectionStart ?? comment.length;
    const textBeforeCursor = comment.slice(0, cursorPos);
    const textAfterCursor = comment.slice(cursorPos);

    const match = textBeforeCursor.match(/#([a-zA-Z0-9_-]*)$/);
    if (!match) return;

    const prefix = textBeforeCursor.slice(0, match.index);
    const nextComment = `${prefix}#${fullId} ${textAfterCursor}`;
    setComment(nextComment);
    setAdrRefQuery(null);

    setTimeout(() => {
      textarea.focus();
      const nextPos = (prefix + `#${fullId} `).length;
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

  const matchingAdrs = adrRefQuery !== null
    ? (data?.projectAdrs ?? []).filter((a: any) => {
        const id = (a.full_id ?? "").toLowerCase();
        const title = (a.title ?? "").toLowerCase();
        return id.includes(adrRefQuery) || title.includes(adrRefQuery);
      })
    : [];

  async function submitComment() {
    if (!comment.trim()) return;
    setBusy("comment");
    try {
      await commentFn({ data: { adr_id: adrId, body: comment.trim() } });
      setComment("");
      setMentionQuery(null);
      setAdrRefQuery(null);
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
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
        {/* Top breadcrumb navigation and action bar */}
        <div className="flex items-center justify-between gap-4 mb-5 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <button
              onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: adr.project_id } })}
              className="inline-flex items-center gap-1.5 hover:text-foreground font-medium transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{adr.projects?.name ?? "Project"}</span>
            </button>
            <span className="opacity-40">/</span>
            <span className="font-mono font-semibold text-foreground truncate">{adr.full_id}</span>

            {/* Quick Prev / Next ADR Navigation Controls */}
            {totalAdrs && totalAdrs > 1 ? (
              <div className="flex items-center gap-0.5 ml-2 pl-2 border-l border-border/60">
                <button
                  type="button"
                  onClick={() => prevAdr && navigate({ to: "/adrs/$adrId", params: { adrId: prevAdr.id } })}
                  disabled={!prevAdr}
                  title={prevAdr ? `Previous: ${prevAdr.full_id} - ${prevAdr.title} (Left Arrow)` : "No previous ADR"}
                  className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-colors"
                  aria-label="Previous ADR"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-[11px] font-mono font-medium text-muted-foreground/80 select-none px-1">
                  {currentIndex ?? "?"} of {totalAdrs}
                </span>
                <button
                  type="button"
                  onClick={() => nextAdr && navigate({ to: "/adrs/$adrId", params: { adrId: nextAdr.id } })}
                  disabled={!nextAdr}
                  title={nextAdr ? `Next: ${nextAdr.full_id} - ${nextAdr.title} (Right Arrow)` : "No next ADR"}
                  className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-colors"
                  aria-label="Next ADR"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/projects/$projectId/graph" params={{ projectId: adr.project_id }}
              className="inline-flex items-center gap-1.5 h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shadow-2xs"
              title="Open Architecture Graph"
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Graph</span>
            </Link>
            {isFinalized ? (
              <Link
                to="/projects/$projectId/adrs/new"
                params={{ projectId: adr.project_id }}
                search={{ supersedes: adr.id }}
                className="inline-flex items-center gap-1.5 h-8 rounded-md border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/20 shadow-2xs transition-colors"
                title="This decision is finalized. Create a new ADR that supersedes it."
              >
                <GitBranch className="h-3.5 w-3.5" /> Supersede ADR
              </Link>
            ) : (
              <Link
                to="/adrs/$adrId/edit"
                params={{ adrId }}
                className="inline-flex items-center gap-1.5 h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent shadow-2xs transition-colors"
              >
                <Edit className="h-3.5 w-3.5" /> Edit
              </Link>
            )}
          </div>
        </div>

        {/* 2-Column Responsive Layout: 8 columns main content, 4 columns sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main content column */}
          <main className="lg:col-span-8 space-y-4 min-w-0">
            {/* ADR Header Card */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-2xs">
              <div className="flex items-center gap-2.5 mb-2.5 flex-wrap">
                <span className="font-mono text-sm font-bold text-primary px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                  {adr.full_id}
                </span>
                <StatusBadge
                  status={adr.status}
                  currentVersion={adr.current_version}
                  userReviewDecision={data?.myReviewDecision}
                />
                {adr.repository_deleted_at && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground bg-muted/30">
                    Archived from repository
                  </span>
                )}
              </div>

              <h1 className="text-2xl font-bold tracking-tight text-foreground leading-snug">
                {adr.title}
              </h1>

              <div className="mt-3.5 flex items-center flex-wrap gap-y-2 gap-x-4 text-xs text-muted-foreground pt-3 border-t border-border/40">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground/70" />
                  {new Date(adr.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
                {adr.assigned_to_profile && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                    <UserCheck className="h-3.5 w-3.5" />
                    Reviewer: @{adr.assigned_to_profile.username || adr.assigned_to_profile.full_name}
                  </span>
                )}
                {(adr.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 ml-auto">
                    {(adr.tags as string[]).map((t) => (
                      <span key={t} className="rounded-md bg-secondary text-secondary-foreground font-medium px-2 py-0.5 text-[11px]">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
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
                  <span className="flex-1 font-medium">{renderCommentWithMentions(c.body, data?.projectAdrs)}</span>
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
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{renderCommentWithMentions(c.body, data?.projectAdrs)}</p>
                </div>
              </div>
            );
          })}

          {/* Comment input with @mention and #adr autocomplete */}
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

            {adrRefQuery !== null && matchingAdrs.length > 0 && (
              <div className="absolute bottom-full mb-1 left-0 w-80 max-h-52 overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-20 divide-y divide-border/60 animate-in fade-in duration-150">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 flex items-center gap-1.5">
                  <Hash className="h-3 w-3" /> Reference ADR
                </div>
                {matchingAdrs.map((a: any) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => insertAdrRef(a.full_id)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold font-mono text-primary truncate">#{a.full_id}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{a.title}</div>
                    </div>
                    <span className="shrink-0 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border border-border bg-muted/50">
                      {a.status}
                    </span>
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
                placeholder="Add a comment… Type @ to mention a person, # to reference an ADR (Cmd+Enter to submit)"
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

        {/* Next / Previous ADR Navigation Footer */}
        {(prevAdr || nextAdr) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {prevAdr ? (
              <button
                type="button"
                onClick={() => navigate({ to: "/adrs/$adrId", params: { adrId: prevAdr.id } })}
                className="group flex flex-col items-start gap-1 p-3.5 rounded-xl border border-border bg-card/70 hover:bg-card hover:border-primary/40 hover:shadow-xs transition-all text-left"
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground group-hover:text-primary transition-colors">
                  <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                  <span>Previous ADR</span>
                  <kbd className="hidden sm:inline-block px-1 py-0.2 rounded border border-border bg-muted/60 text-[10px] font-mono text-muted-foreground">←</kbd>
                </span>
                <span className="font-mono text-xs font-bold text-foreground">
                  {prevAdr.full_id}
                </span>
                <span className="text-xs text-muted-foreground line-clamp-1 group-hover:text-foreground/90 transition-colors">
                  {prevAdr.title}
                </span>
              </button>
            ) : (
              <div className="hidden sm:block" />
            )}

            {nextAdr && (
              <button
                type="button"
                onClick={() => navigate({ to: "/adrs/$adrId", params: { adrId: nextAdr.id } })}
                className="group flex flex-col items-end gap-1 p-3.5 rounded-xl border border-border bg-card/70 hover:bg-card hover:border-primary/40 hover:shadow-xs transition-all text-right sm:col-start-2"
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground group-hover:text-primary transition-colors">
                  <kbd className="hidden sm:inline-block px-1 py-0.2 rounded border border-border bg-muted/60 text-[10px] font-mono text-muted-foreground">→</kbd>
                  <span>Next ADR</span>
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="font-mono text-xs font-bold text-foreground">
                  {nextAdr.full_id}
                </span>
                <span className="text-xs text-muted-foreground line-clamp-1 group-hover:text-foreground/90 transition-colors">
                  {nextAdr.title}
                </span>
              </button>
            )}
          </div>
        )}
          </main>

          {/* Right Sidebar Column */}
          <aside className="lg:col-span-4 space-y-4 lg:sticky lg:top-6">
            {/* Actions & Review Card */}
            <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Decision & Review</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted font-semibold capitalize">
                  {adr.status.replace("_", " ")}
                </span>
              </div>

              {/* Finalized Record: Historical decision locked in Git */}
              {isFinalized && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/80 bg-muted/30 p-3 text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>Finalized Architectural Record</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      This ADR is finalized and committed to the Git repository. Because architectural decision records are immutable historical snapshots, changes are introduced by creating a new ADR that supersedes this record.
                    </p>
                  </div>
                  <Link
                    to="/projects/$projectId/adrs/new"
                    params={{ projectId: adr.project_id }}
                    search={{ supersedes: adr.id }}
                    className="w-full h-8.5 rounded-md border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    Create Superseding ADR
                  </Link>
                </div>
              )}

              {/* Under Review: Unified Review Hub (4 buttons: 2 Personal, 2 Admin for admins) */}
              {adr.status === "under_review" && !isFinalized && (
                <div className="space-y-3.5">
                  {/* Approval Progress */}
                  <div className="rounded-lg bg-muted/40 p-3 border border-border/50">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground font-medium">Team Approvals</span>
                      <span className="font-semibold text-foreground">
                        {(data.approvals ?? []).filter((a: any) => a.decision === "approve").length} / {adr.projects?.required_approvals ?? 3}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            (((data.approvals ?? []).filter((a: any) => a.decision === "approve").length) /
                              (adr.projects?.required_approvals ?? 3)) *
                              100,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* 1. Personal Decision (For Reviewers & Engineers) */}
                  {canApprove && (
                    <div className="space-y-2 rounded-lg border border-border/70 bg-card p-3 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-foreground tracking-wide">
                          Personal Decision
                        </span>
                        {hasUserDecided && (
                          <span className="text-[10px] font-medium text-muted-foreground lowercase">
                            (submitted)
                          </span>
                        )}
                      </div>

                      {hasUserDecided ? (
                        <div className="space-y-2 pt-1">
                          <div className="text-xs">
                            {myReviewDecision === "request_changes" ? (
                              <span className="font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                                <ThumbsUp className="h-3.5 w-3.5 rotate-180" />
                                You requested changes
                              </span>
                            ) : (
                              <span className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                <ThumbsUp className="h-3.5 w-3.5" />
                                You approved this ADR
                              </span>
                            )}
                          </div>
                          <button
                            onClick={handleRevokeApproval}
                            disabled={busy === "revoke"}
                            className="w-full h-8 rounded-md border border-destructive/30 bg-card px-2 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                            {busy === "revoke" ? "Withdrawing…" : "Withdraw Decision"}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2 pt-1">
                          <textarea
                            value={approvalNote}
                            onChange={(e) => setApprovalNote(e.target.value)}
                            rows={2}
                            placeholder="Optional review note…"
                            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => submitApproval("approve")}
                              disabled={busy === "approve"}
                              className="h-8.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1 shadow-2xs transition-colors"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Approve
                            </button>
                            <button
                              onClick={() => submitApproval("request_changes")}
                              disabled={busy === "approve"}
                              className="h-8.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1 shadow-2xs transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                              Reject
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. Admin Decision (Only Visible to Project Admins & Platform Admins) */}
                  {canPublish && (
                    <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="text-[11px] font-semibold text-foreground tracking-wide">
                            Admin Decision
                          </span>
                        </div>
                        {isApproveOverride && (
                          <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                            Override Active
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-muted-foreground leading-snug">
                        Authoritative project decision. Overrides team review criteria.
                      </div>

                      {isApproveOverride && (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
                          <div className="font-semibold flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>Standard review criteria not met</span>
                          </div>
                          <p className="text-[10px] leading-relaxed opacity-90">
                            Current: {approvedCount}/{requiredApprovals} approvals
                            {rejectedCount > 0 ? `, ${rejectedCount} rejection(s)` : ""}
                            {userPersonallyRejected ? " (including your personal rejection)" : ""}.
                            Provide at least 2 sentences (60 chars). System automatically attaches project vote stats.
                          </p>
                        </div>
                      )}

                      <div className="space-y-1">
                        <textarea
                          value={finalComment}
                          onChange={(e) => setFinalComment(e.target.value)}
                          rows={3}
                          placeholder={
                            isApproveOverride
                              ? "Enter your architectural rationale (at least 2 sentences explaining why this override is necessary)…"
                              : "Official administrative rationale…"
                          }
                          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          {!isApproveOverride ? (
                            <button
                              type="button"
                              onClick={() => autoFillAdminRationale("approved")}
                              className="text-primary hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Sparkles className="h-3 w-3" /> Auto-draft rationale
                            </button>
                          ) : (
                            <span className="text-muted-foreground italic text-[10px]">
                              Auto-draft disabled: custom justification required
                            </span>
                          )}
                          {isApproveOverride && (
                            <span
                              className={
                                validateOverrideRationale(finalComment).valid
                                  ? "text-emerald-600 dark:text-emerald-400 font-mono font-medium"
                                  : "text-amber-600 dark:text-amber-400 font-mono"
                              }
                            >
                              {validateOverrideRationale(finalComment).valid
                                ? "✓ Rationale criteria met"
                                : `${finalComment.trim().length}/60 chars (min 2 sentences)`}
                            </span>
                          )}
                        </div>
                        {isApproveOverride && finalComment.trim().length > 0 && !validateOverrideRationale(finalComment).valid && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium leading-tight">
                            {validateOverrideRationale(finalComment).error}
                          </p>
                        )}
                      </div>

                      {isApproveOverride && (
                        <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-[10px] text-muted-foreground space-y-0.5">
                          <div className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                            <Shield className="h-3 w-3 text-primary" />
                            <span>System Audit Guarantee</span>
                          </div>
                          <p className="text-[10px] leading-relaxed">
                            Decyra will automatically attach the official voting statistics and audit stamp to your rationale upon approval.
                          </p>
                        </div>
                      )}

                      {isLockedByReviewers && (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-200 space-y-1">
                          <div className="font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>Decision Locked by Pending Reviews</span>
                          </div>
                          <p className="text-[10px] leading-relaxed text-muted-foreground">
                            Waiting for: {pendingReviewers.map((r: any) => '@' + (r.username || r.full_name || 'user')).join(', ')}.
                            Till they make their decision or an admin/requester revokes their review request, no final decision can be made.
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleFinalDecision("approved")}
                          disabled={
                            busy === "final_decision" ||
                            isLockedByReviewers ||
                            (isApproveOverride && !validateOverrideRationale(finalComment).valid)
                          }
                          title={
                            isLockedByReviewers
                              ? "Final decision locked: pending reviews from " + pendingReviewers.map((r: any) => '@' + (r.username || r.full_name)).join(', ')
                              : isApproveOverride && !validateOverrideRationale(finalComment).valid
                              ? validateOverrideRationale(finalComment).error || "Provide at least 2 sentences (60 characters) explaining the override"
                              : "Approve this ADR authoritatively"
                          }
                          className="h-8.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1 shadow-2xs transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Final Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFinalDecision("rejected")}
                          disabled={busy === "final_decision" || isLockedByReviewers}
                          title={
                            isLockedByReviewers
                              ? "Final decision locked: pending reviews from " + pendingReviewers.map((r: any) => '@' + (r.username || r.full_name)).join(', ')
                              : "Reject this ADR authoritatively"
                          }
                          className="h-8.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1 shadow-2xs transition-colors cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                          Final Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Draft Status Actions */}
              {adr.status === "draft" && (
                <div className="space-y-2.5">
                  <button
                    onClick={moveStatus}
                    disabled={busy === "status"}
                    className="w-full h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-2xs transition-opacity"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Submit for review
                  </button>
                  {canPublish && (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="w-full h-8 rounded-md border border-destructive/30 bg-card px-3 text-xs font-medium text-destructive hover:bg-destructive/10 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete draft
                    </button>
                  )}
                </div>
              )}

              {/* Approved Status Actions */}
              {adr.status === "approved" && !isFinalized && (
                canPublish ? (
                  <div className="space-y-2">
                    {isLockedByReviewers && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-200">
                        <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>Publish Locked</span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground leading-normal">
                          Review pending from {pendingReviewers.map((r: any) => '@' + (r.username || r.full_name || 'user')).join(', ')}. Complete or revoke to publish.
                        </p>
                      </div>
                    )}
                    <button
                      onClick={() => handlePublish("published")}
                      disabled={busy === "publish" || isLockedByReviewers}
                      title={isLockedByReviewers ? "Publish locked by pending reviews" : undefined}
                      className="w-full h-9 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-2 shadow-2xs transition-colors"
                    >
                      <Rocket className="h-3.5 w-3.5" />
                      {busy === "publish" ? "Publishing…" : "Publish ADR to Git"}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                    <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Approved by project team
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground leading-normal">
                      Awaiting publication to repository by an Admin.
                    </p>
                  </div>
                )
              )}

              {/* Rejected Status Actions */}
              {adr.status === "rejected" && !isFinalized && (
                canPublish ? (
                  <div className="space-y-2">
                    {isLockedByReviewers && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-200">
                        <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>Publish Locked</span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground leading-normal">
                          Review pending from {pendingReviewers.map((r: any) => '@' + (r.username || r.full_name || 'user')).join(', ')}. Complete or revoke to publish.
                        </p>
                      </div>
                    )}
                    <button
                      onClick={() => handlePublish("rejected")}
                      disabled={busy === "publish" || isLockedByReviewers}
                      title={isLockedByReviewers ? "Publish locked by pending reviews" : undefined}
                      className="w-full h-9 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-2 shadow-2xs transition-colors"
                    >
                      <Rocket className="h-3.5 w-3.5" />
                      {busy === "publish" ? "Publishing…" : "Publish Rejected ADR"}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
                    <div className="flex items-center gap-2 font-semibold text-rose-600 dark:text-rose-400">
                      <XCircle className="h-4 w-4 shrink-0" />
                      Rejected by project team
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground leading-normal">
                      Awaiting archival publication by an Admin.
                    </p>
                  </div>
                )
              )}

              {/* Approved By List */}
              {(data.approvals ?? []).filter((a: any) => a.decision === "approve").length > 0 && (
                <div className="pt-3 border-t border-border/50">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Approved By</h4>
                  <div className="space-y-1.5">
                    {(data.approvals ?? []).filter((a: any) => a.decision === "approve").map((a: any) => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <div className="h-5 w-5 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <ThumbsUp className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
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

              {/* Changes Requested By List */}
              {(data.approvals ?? []).filter((a: any) => a.decision === "request_changes").length > 0 && (
                <div className="pt-3 border-t border-border/50">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Changes Requested By</h4>
                  <div className="space-y-1.5">
                    {(data.approvals ?? []).filter((a: any) => a.decision === "request_changes").map((a: any) => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <div className="h-5 w-5 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
                          <ThumbsUp className="h-2.5 w-2.5 text-rose-600 dark:text-rose-400 rotate-180" />
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

            {/* Reviewers Management Card (Multiple Reviewers) */}
            <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Reviewers {reviewRequests.length > 0 && `(${reviewRequests.length})`}
                  </h3>
                  {isLockedByReviewers && (
                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-500/30 flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" /> {pendingReviewers.length} pending
                    </span>
                  )}
                </div>
                <UserCheck className="h-3.5 w-3.5 text-amber-500" />
              </div>

              {reviewRequests.length > 0 ? (
                <div className="space-y-2">
                  {reviewRequests.map((r: any) => {
                    const isPending = r.is_pending;
                    const isApproved = r.reviewer_decision === "approve";
                    const isChangesRequested = r.reviewer_decision === "request_changes";
                    const canRevokeThis =
                      canPublish ||
                      data?.currentUserId === r.requested_by ||
                      data?.currentUserId === r.reviewer_id ||
                      data?.currentUserId === adr?.author_id;

                    return (
                      <div
                        key={r.id || r.reviewer_id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border/60 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            {(r.full_name || r.username || "?").slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-foreground truncate">
                              {r.full_name || r.username}
                              {r.reviewer_id === data?.currentUserId && " (you)"}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              @{r.username || "user"}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isPending && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              <Clock className="h-2.5 w-2.5" /> Pending
                            </span>
                          )}
                          {isApproved && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Approved
                            </span>
                          )}
                          {isChangesRequested && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                              <XCircle className="h-2.5 w-2.5" /> Changes Req
                            </span>
                          )}

                          {canRevokeThis && !isFinalized && (
                            <button
                              type="button"
                              onClick={() => handleRevokeReviewRequest(r.reviewer_id)}
                              disabled={busy === "revoke_review"}
                              title="Revoke review request (unblocks decisions and logged in audit timeline)"
                              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No reviewers requested yet.</p>
              )}

              {/* Add / Request another reviewer */}
              {!isFinalized && (
                <div className="pt-2 border-t border-border/40">
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) handleRequestReview(e.target.value);
                    }}
                    disabled={busy === "request_review"}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                  >
                    <option value="">+ Request review from member…</option>
                    {(data.projectMembers ?? [])
                      .filter((m: any) => !reviewRequests.some((r: any) => r.reviewer_id === m.user_id && r.status !== "revoked"))
                      .map((m: any) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name ? `${m.full_name} (@${m.username || 'user'})` : m.username || m.email}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            {/* Relationships Card */}
            <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Relationships</h3>
                <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>

              {(rels ?? []).length > 0 ? (
                <div className="space-y-1.5">
                  {(rels as any[]).map((r) => {
                    const isSource = r.source_adr_id === adrId;
                    const otherId = isSource ? r.target_adr_id : r.source_adr_id;
                    const otherFullId = isSource ? (r.target_full_id || r.target?.full_id) : (r.source_full_id || r.source?.full_id);
                    const otherTitle = isSource ? (r.target_title || r.target?.title) : (r.source_title || r.source?.title);
                    return (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-muted/40 border border-border/50 hover:bg-muted/70 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{REL_TYPE_LABELS[r.rel_type]}</div>
                          <Link to="/adrs/$adrId" params={{ adrId: otherId }}
                            className="truncate text-primary font-medium hover:underline block" title={otherTitle}>{otherFullId}: {otherTitle}</Link>
                        </div>
                        <button onClick={() => removeRel(r.id)} className="text-muted-foreground hover:text-destructive p-1 rounded shrink-0" title="Remove relationship">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No ADR relationships linked.</p>
              )}

              {/* Add relationship form */}
              <div className="pt-2 border-t border-border/40 space-y-2">
                <select value={relType} onChange={(e) => setRelType(e.target.value)}
                  className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground cursor-pointer">
                  {Object.entries(REL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input
                  value={relSearch}
                  onChange={(e) => searchRels(e.target.value)}
                  placeholder="Search ADR to link…"
                  className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs"
                />
                {relResults.length > 0 && (
                  <div className="rounded-lg border border-border bg-card shadow-lg divide-y divide-border/60 max-h-40 overflow-y-auto">
                    {relResults.map((r: any) => (
                      <button key={r.id} onClick={() => addRel(r.id)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="font-mono font-bold text-primary mr-1.5">{r.full_id}</span>
                          <span className="truncate text-muted-foreground">{r.title}</span>
                        </div>
                        <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

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
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-2xs">
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-border/50">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      </div>
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
    <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
      >
        <span className="text-primary">{icon}</span>
        <span>{title}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-5 pt-2 border-t border-border/50 space-y-4">{children}</div>}
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
    case "review_requested":
      return {
        icon: <UserCheck className="h-2.5 w-2.5 text-blue-500" />,
        label: "Review Requested",
        color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      };
    case "review_request_revoked":
      return {
        icon: <X className="h-2.5 w-2.5 text-amber-500" />,
        label: "Review Revoked",
        color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
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
  if (!body?.trim()) return <p className="text-xs text-muted-foreground italic">Not provided</p>;
  return (
    <div className="text-sm leading-relaxed text-foreground [&_.wmde-markdown]:bg-transparent [&_.wmde-markdown]:text-foreground [&_.wmde-markdown_h1]:text-base [&_.wmde-markdown_h1]:font-bold [&_.wmde-markdown_h1]:mt-3 [&_.wmde-markdown_h1]:mb-1.5 [&_.wmde-markdown_h2]:text-sm [&_.wmde-markdown_h2]:font-bold [&_.wmde-markdown_h2]:mt-2.5 [&_.wmde-markdown_h2]:mb-1.5 [&_.wmde-markdown_h3]:text-xs [&_.wmde-markdown_h3]:font-semibold [&_.wmde-markdown_p]:text-sm [&_.wmde-markdown_p]:leading-relaxed [&_.wmde-markdown_p]:mb-2 [&_.wmde-markdown_ul]:text-sm [&_.wmde-markdown_ol]:text-sm">
      <SimpleMarkdown text={body} />
    </div>
  );
}

function renderCommentWithMentions(text: string, projectAdrs?: any[]) {
  const parts = text.split(/(@[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)/g);
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
    if (part.startsWith("#")) {
      const targetFullId = part.slice(1).toLowerCase();
      const matchedAdr = projectAdrs?.find(
        (a: any) => (a.full_id ?? "").toLowerCase() === targetFullId,
      );
      if (matchedAdr) {
        return (
          <Link
            key={i}
            to="/adrs/$adrId"
            params={{ adrId: matchedAdr.id }}
            className="inline-flex items-center gap-1 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-semibold px-1.5 py-0.5 text-xs mx-0.5 hover:underline"
            title={`${matchedAdr.full_id}: ${matchedAdr.title}`}
          >
            <Hash className="h-3 w-3" />
            {matchedAdr.full_id}
          </Link>
        );
      }
      return (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded bg-muted text-foreground font-mono font-medium px-1 py-0.5 text-xs mx-0.5"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

