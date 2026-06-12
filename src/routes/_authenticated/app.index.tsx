import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardStats } from "@/lib/api/decyra.functions";
import { StatusBadge } from "@/components/decyra/StatusBadge";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Dashboard — Decyra" }] }),
  component: Dashboard,
});

function Dashboard() {
  const fn = useServerFn(dashboardStats);
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => fn() });
  const c = data?.counts ?? { total: 0, draft: 0, under_review: 0, approved: 0, published: 0, superseded: 0 };
  const cards = [
    { label: "Total ADRs", value: c.total },
    { label: "Drafts", value: c.draft },
    { label: "Under review", value: c.under_review },
    { label: "Approved", value: c.approved },
    { label: "Published", value: c.published },
    { label: "Projects", value: data?.projectsCount ?? 0 },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Architecture governance overview.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h2>
        <div className="mt-3 rounded-lg border border-border bg-card divide-y divide-border">
          {(data?.recent ?? []).length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No ADRs yet. Create a project and start writing decisions.</div>
          )}
          {(data?.recent ?? []).map((a: any) => (
            <Link key={a.id} to="/app/adrs/$adrId" params={{ adrId: a.id }}
              className="flex items-center justify-between px-4 py-3 hover:bg-accent/40">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{a.full_id}</span>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mt-0.5 truncate font-medium">{a.title}</div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0 ml-4">
                {a.projects?.code} · {new Date(a.updated_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
