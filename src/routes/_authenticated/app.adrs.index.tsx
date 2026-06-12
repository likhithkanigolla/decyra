import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardStats } from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/app/adrs/")({
  head: () => ({ meta: [{ title: "All ADRs — Decyra" }] }),
  component: AllAdrs,
});

function AllAdrs() {
  const fn = useServerFn(dashboardStats);
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => fn() });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const items = (data?.recent ?? []).filter((a: any) =>
    (!q || `${a.full_id} ${a.title}`.toLowerCase().includes(q.toLowerCase())) &&
    (!status || a.status === status)
  );

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight">All ADRs</h1>
      <p className="text-sm text-muted-foreground mt-1">Search and filter across every project you can access.</p>

      <div className="mt-5 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID or title…"
          className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="under_review">Under review</option>
          <option value="approved">Approved</option>
          <option value="published">Published</option>
          <option value="superseded">Superseded</option>
        </select>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card divide-y divide-border">
        {items.length === 0 && <div className="p-6 text-sm text-muted-foreground">No ADRs match.</div>}
        {items.map((a: any) => (
          <Link key={a.id} to="/app/adrs/$adrId" params={{ adrId: a.id }}
            className="flex items-center justify-between px-4 py-3 hover:bg-accent/40">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{a.full_id}</span>
                <StatusBadge status={a.status} />
              </div>
              <div className="mt-0.5 truncate font-medium">{a.title}</div>
            </div>
            <div className="text-xs text-muted-foreground ml-4 shrink-0">{a.projects?.code}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
