import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardStats, getMyContext } from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { FileText, FolderKanban, Clock, CheckCircle, Send, BookOpen, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/")({
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

  const statCards = [
    { label: "Total ADRs", value: c.total, icon: <FileText className="h-5 w-5 text-primary" />, sub: "All decisions" },
    { label: "Projects", value: data?.projectsCount ?? 0, icon: <FolderKanban className="h-5 w-5 text-info" />, sub: "Active" },
    { label: "Pending Review", value: c.under_review, icon: <Clock className="h-5 w-5 text-warning" />, sub: "Need attention" },
    { label: "Published", value: c.published, icon: <BookOpen className="h-5 w-5 text-success" />, sub: "In production" },
  ];

  const userName = me?.profile?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {userName} 👋</h1>
          <p className="text-sm text-muted-foreground mt-1">Architecture governance overview for your projects.</p>
        </div>
        <Link to="/app/search"
          className="inline-flex items-center gap-2 h-9 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          <Send className="h-3.5 w-3.5" />
          Search ADRs
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent ADRs</h2>
            <Link to="/app/adrs" className="text-xs text-primary hover:underline">View all</Link>
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
              <Link key={a.id} to="/app/adrs/$adrId" params={{ adrId: a.id }}
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
                    contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "var(--color-foreground)" }}
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
                    to="/app/projects/$projectId" params={{ projectId: m.project_id }}
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
              <Link to="/app/projects"
                className="flex items-center gap-2.5 rounded-lg p-2.5 border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors text-sm">
                <FolderKanban className="h-4 w-4 text-primary" />
                View all projects
              </Link>
              <Link to="/app/search"
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
