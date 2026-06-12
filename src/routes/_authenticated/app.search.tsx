import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchAdrs, listProjects } from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { useState, useEffect, useRef } from "react";
import { Search, Filter, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/search")({
  head: () => ({ meta: [{ title: "Search — Decyra" }] }),
  component: SearchPage,
});

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "under_review", label: "Under review" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
  { value: "superseded", label: "Superseded" },
];

function SearchPage() {
  const searchFn = useServerFn(searchAdrs);
  const projectsFn = useServerFn(listProjects);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [projectId, setProjectId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsFn(),
  });

  const { data: results, isFetching } = useQuery({
    queryKey: ["search", debouncedQ, status, projectId],
    queryFn: () => searchFn({ data: { q: debouncedQ, status: status || undefined, project_id: projectId || undefined } }),
    enabled: debouncedQ.length >= 2,
  });

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  // Auto-focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const hasResults = debouncedQ.length >= 2;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Search across all ADRs you have access to.
      </p>

      {/* Search Input */}
      <div className="mt-5 relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title, ID, context, decision, tags…"
          className="w-full h-12 rounded-lg border border-input bg-background pl-10 pr-10 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {q && (
          <button onClick={() => setQ("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-3 text-xs"
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-3 text-xs"
        >
          <option value="">All projects</option>
          {(projects ?? []).map((p: any) => (
            <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
          ))}
        </select>
        {(status || projectId) && (
          <button
            onClick={() => { setStatus(""); setProjectId(""); }}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      {/* Results */}
      <div className="mt-6">
        {!hasResults && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Type at least 2 characters to search</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Searches titles, IDs, context, decisions, and tags</p>
          </div>
        )}

        {hasResults && isFetching && (
          <div className="space-y-2">
            {[1,2,3].map((i) => (
              <div key={i} className="h-16 rounded-lg border border-border bg-card animate-pulse" />
            ))}
          </div>
        )}

        {hasResults && !isFetching && (results ?? []).length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">No ADRs match your search</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try different keywords or remove filters</p>
          </div>
        )}

        {hasResults && !isFetching && (results ?? []).length > 0 && (
          <>
            <p className="text-xs text-muted-foreground mb-3">{results!.length} result{results!.length !== 1 ? "s" : ""}</p>
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {results!.map((a: any) => (
                <Link
                  key={a.id}
                  to="/app/adrs/$adrId"
                  params={{ adrId: a.id }}
                  className="flex items-start justify-between px-4 py-3.5 hover:bg-accent/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{a.full_id}</span>
                      <StatusBadge status={a.status} />
                      {(a.tags ?? []).slice(0, 3).map((t: string) => (
                        <span key={t} className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">{t}</span>
                      ))}
                    </div>
                    <p className="mt-1 font-medium text-sm truncate">{a.title}</p>
                  </div>
                  <div className="ml-4 shrink-0 text-right">
                    <div className="text-xs font-medium text-muted-foreground">{a.projects?.code}</div>
                    <div className="text-[10px] text-muted-foreground/60">{new Date(a.updated_at).toLocaleDateString()}</div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
