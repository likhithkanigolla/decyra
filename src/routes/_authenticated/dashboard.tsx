import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardStats, getMyContext } from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  FileText, FolderKanban, Clock, CheckCircle, Send, BookOpen,
  TrendingUp, UserCheck, MessageSquare, CheckCircle2, ChevronRight
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Decyra" }] }),
  component: Dashboard,
});

const STATUS_COLORS: Record<string, string> = {
  draft: "#6366f1",
  under_review: "#f59e0b",
  approved: "#10b981",
  published: "#3b82f6",
  superseded: "#6b7280",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  draft: <FileText className="h-4 w-4" />,
  under_review: <Clock className="h-4 w-4" />,
  approved: <CheckCircle className="h-4 w-4" />,
  published: <BookOpen className="h-4 w-4" />,
};

function Dashboard() {
  const statsFn = useServerFn(dashboardStats);
  const meFn = useServerFn(getMyContext);

  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => statsFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });

  const c = data?.counts ?? { total: 0, draft: 0, under_review: 0, approved: 0, published: 0, superseded: 0 };
  const recent = data?.recent ?? [];

  const pieData = [
    { name: "Draft", value: c.draft, key: "draft" },
    { name: "Under Review", value: c.under_review, key: "under_review" },
    { name: "Approved", value: c.approved, key: "approved" },
    { name: "Published", value: c.published, key: "published" },
    { name: "Superseded", value: c.superseded, key: "superseded" },
  ].filter((d) => d.value > 0);

  const reviewRequired = data?.reviewRequiredAdrs ?? [];
  const resolvedComments = data?.resolvedComments ?? [];
  const resolvedCount = data?.resolvedCommentsCount ?? 0;

  const statCards = [
    { label: "Total ADRs", value: c.total, icon: <FileText className="h-5 w-5 text-primary" />, sub: "All decisions" },
    { label: "Required for Review", value: reviewRequired.length, icon: <UserCheck className="h-5 w-5 text-amber-500" />, sub: "Awaiting your review" },
    { label: "Resolved Comments", value: resolvedCount, icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, sub: "Discussions closed" },
    { label: "Pending Review", value: c.under_review, icon: <Clock className="h-5 w-5 text-warning" />, sub: "Across all projects" },
    { label: "Published", value: c.published, icon: <BookOpen className="h-5 w-5 text-success" />, sub: "In production" },
  ];

  const userName = me?.profile?.full_name?.split(" ")[0] ?? "there";

  if (data?.projectsCount === 0) {
    return (
      <div className="p-8 max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[70vh] text-center animate-in fade-in zoom-in duration-500">
        <div className="h-20 w-20 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-6 ring-8 ring-primary/5">
          <FolderKanban className="h-10 w-10" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-3">Welcome to Decyra!</h1>
        <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
          Your new home for Architecture Governance. Get started by creating your first project to organize and track your Architecture Decision Records (ADRs).
        </p>
        <Link to="/projects/new" className="h-11 inline-flex items-center gap-2 rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:opacity-90 shadow-sm transition-opacity">
          <FolderKanban className="h-4 w-4" />
          Create Your First Project
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {userName} 👋</h1>
          <p className="text-sm text-muted-foreground mt-1">Architecture governance overview for your projects.</p>
        </div>
        <Link to="/search"
          className="inline-flex items-center gap-2 h-9 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          <Send className="h-3.5 w-3.5" />
          Search ADRs
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</span>
              {card.icon}
            </div>
            <div className="text-3xl font-bold tabular-nums">{card.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* ADRs Required for Review Section */}
      {reviewRequired.length > 0 && (
        <div className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-amber-500" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">ADRs Required for Review</h2>
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                {reviewRequired.length} action needed
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {reviewRequired.map((a: any) => (
              <Link
                key={a.id}
                to="/adrs/$adrId"
                params={{ adrId: a.id }}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-3 hover:border-primary/40 hover:bg-accent/40 transition-colors group"
              >
                <div className="min-w-0 flex-1 pr-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-medium text-muted-foreground">{a.full_id}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs font-medium text-muted-foreground">{a.proj_code}</span>
                    {a.is_assigned_to_me && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        <UserCheck className="h-2.5 w-2.5" /> Assigned to you
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {a.title}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1 text-xs font-medium text-primary">
                  Review <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent ADRs</h2>
            <Link to="/adrs" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {recent.length === 0 && (
              <div className="p-8 text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No ADRs yet.</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Create a project and start writing decisions.</p>
              </div>
            )}
            {recent.map((a: any) => (
              <Link key={a.id} to="/adrs/$adrId" params={{ adrId: a.id }}
                className="flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors group">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{a.full_id}</span>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium group-hover:text-primary transition-colors">{a.title}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0 ml-4 text-right">
                  <div className="font-medium">{a.projects?.code}</div>
                  <div className="opacity-70">{new Date(a.updated_at).toLocaleDateString()}</div>
                </div>
              </Link>
            ))}
          </div>

          {/* Resolved Discussions & Comments */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Resolved Discussions & Comments
              </h2>
            </div>
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {resolvedComments.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No resolved comments yet.
                </div>
              ) : (
                resolvedComments.map((rc: any) => (
                  <Link
                    key={rc.id}
                    to="/adrs/$adrId"
                    params={{ adrId: rc.adr_id }}
                    className="flex items-start justify-between p-4 hover:bg-accent/40 transition-colors group"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-muted-foreground">{rc.full_id}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-foreground font-medium truncate">{rc.adr_title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1 italic">
                        "{rc.body}"
                      </p>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/80">
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3 w-3" /> Resolved by {rc.resolved_by_name ?? "reviewer"}
                        </span>
                        {rc.author_name && (
                          <span className="text-muted-foreground/60">· Author: {rc.author_name}</span>
                        )}
                        {rc.resolved_at && (
                          <span className="text-muted-foreground/60">· {new Date(rc.resolved_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors self-center" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Status distribution chart */}
          {c.total > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">Status distribution</h3>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                    paddingAngle={3} dataKey="value">
                    {pieData.map((entry) => (
                      <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, color: "var(--color-card-foreground)" }}
                    labelStyle={{ color: "var(--color-foreground)" }}
                    itemStyle={{ color: "var(--color-card-foreground)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {pieData.map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[d.key] }} />
                      <span className="capitalize">{d.name}</span>
                    </div>
                    <span className="font-medium">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My projects */}
          {(me?.memberships ?? []).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">My projects</h3>
              <div className="space-y-2">
                {(me?.memberships ?? []).map((m: any) => (
                  <Link key={m.project_id}
                    to="/projects/$projectId" params={{ projectId: m.project_id }}
                    className="flex items-center gap-2.5 rounded-lg p-2 hover:bg-accent transition-colors group">
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary text-[10px] font-bold">
                      {m.projects?.code?.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate group-hover:text-primary transition-colors">{m.projects?.name}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">{m.role?.replace("_", " ")}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Quick actions</h3>
            <div className="space-y-2">
              <Link to="/projects"
                className="flex items-center gap-2.5 rounded-lg p-2.5 border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors text-sm">
                <FolderKanban className="h-4 w-4 text-primary" />
                View all projects
              </Link>
              <Link to="/search"
                className="flex items-center gap-2.5 rounded-lg p-2.5 border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors text-sm">
                <Send className="h-4 w-4 text-primary" />
                Search ADRs
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
