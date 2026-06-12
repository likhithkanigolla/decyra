import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAdr, updateAdrStatus, approveAdr, addComment } from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/adrs/$adrId")({
  head: () => ({ meta: [{ title: "ADR — Decyra" }] }),
  component: AdrDetail,
});

function AdrDetail() {
  const { adrId } = Route.useParams();
  const fn = useServerFn(getAdr);
  const statusFn = useServerFn(updateAdrStatus);
  const approveFn = useServerFn(approveAdr);
  const commentFn = useServerFn(addComment);
  const { data, refetch } = useQuery({ queryKey: ["adr", adrId], queryFn: () => fn({ data: { id: adrId } }) });
  const [comment, setComment] = useState("");

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { adr, approvals, comments } = data;

  async function setStatus(s: string) {
    try { await statusFn({ data: { id: adrId, status: s as any } }); toast.success(`Status: ${s}`); refetch(); }
    catch (err: any) { toast.error(err.message); }
  }
  async function approve(decision: "approve" | "request_changes") {
    try { await approveFn({ data: { adr_id: adrId, decision } }); toast.success("Recorded"); refetch(); }
    catch (err: any) { toast.error(err.message); }
  }
  async function postComment() {
    if (!comment.trim()) return;
    try { await commentFn({ data: { adr_id: adrId, body: comment } }); setComment(""); refetch(); }
    catch (err: any) { toast.error(err.message); }
  }

  const approvalsCount = approvals.filter((a: any) => a.decision === "approve").length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="text-xs text-muted-foreground">
        <Link to="/app/projects/$projectId" params={{ projectId: adr.project_id }} className="hover:text-foreground">
          {adr.projects?.code} · {adr.projects?.name}
        </Link>
      </div>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">{adr.full_id}</span>
            <StatusBadge status={adr.status} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{adr.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1">
            {(adr.tags ?? []).map((t: string) => (
              <span key={t} className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium">{t}</span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {adr.status === "draft" && <Action onClick={() => setStatus("under_review")}>Submit for review</Action>}
          {adr.status === "under_review" && <Action onClick={() => setStatus("approved")}>Mark approved</Action>}
          {adr.status === "approved" && <Action onClick={() => setStatus("published")} primary>Publish</Action>}
          {adr.status === "published" && <Action onClick={() => setStatus("superseded")}>Mark superseded</Action>}
        </div>
      </div>

      <div className="mt-8 grid gap-6">
        <Block title="Context" body={adr.context} />
        <Block title="Decision" body={adr.decision} />
        <Block title="Consequences" body={adr.consequences} />
        <Block title="Alternatives considered" body={adr.alternatives} />
      </div>

      <section className="mt-10 grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Approvals ({approvalsCount} / {adr.projects?.required_approvals ?? 3})
          </h2>
          <div className="mt-3 rounded-lg border border-border bg-card divide-y divide-border">
            {approvals.length === 0 && <div className="p-4 text-sm text-muted-foreground">No approvals yet.</div>}
            {approvals.map((a: any) => (
              <div key={a.id} className="p-3 text-sm flex items-center justify-between">
                <span>{a.profiles?.full_name ?? a.profiles?.email}</span>
                <span className={a.decision === "approve" ? "text-success text-xs" : "text-warning text-xs"}>
                  {a.decision === "approve" ? "Approved" : "Requested changes"}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => approve("approve")} className="h-9 rounded-md bg-success/90 px-3 text-sm font-medium text-success-foreground hover:opacity-90">Approve</button>
            <button onClick={() => approve("request_changes")} className="h-9 rounded-md border border-border bg-card px-3 text-sm hover:bg-accent">Request changes</button>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Discussion</h2>
          <div className="mt-3 rounded-lg border border-border bg-card divide-y divide-border">
            {comments.length === 0 && <div className="p-4 text-sm text-muted-foreground">No comments yet.</div>}
            {comments.map((c: any) => (
              <div key={c.id} className="p-3">
                <div className="text-xs text-muted-foreground">{c.profiles?.full_name ?? c.profiles?.email} · {new Date(c.created_at).toLocaleString()}</div>
                <div className="mt-1 text-sm whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Leave a comment…"
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" />
            <button onClick={postComment} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">Post</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="mt-2 rounded-lg border border-border bg-card p-4 text-sm whitespace-pre-wrap leading-relaxed">
        {body || <span className="text-muted-foreground italic">Empty</span>}
      </div>
    </div>
  );
}

function Action({ onClick, children, primary }: { onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <button onClick={onClick}
      className={`h-9 rounded-md px-3 text-sm font-medium ${primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-card hover:bg-accent"}`}>
      {children}
    </button>
  );
}
