import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProfiles } from "@/lib/api/decyra.functions";

export const Route = createFileRoute("/_authenticated/app/admin")({
  head: () => ({ meta: [{ title: "Admin — Decyra" }] }),
  component: Admin,
});

function Admin() {
  const fn = useServerFn(listProfiles);
  const { data: profiles } = useQuery({ queryKey: ["profiles"], queryFn: () => fn() });

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight">Platform administration</h1>
      <p className="text-sm text-muted-foreground mt-1">Manage users and platform-level configuration.</p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Users</h2>
        <div className="mt-3 rounded-lg border border-border bg-card divide-y divide-border">
          {(profiles ?? []).map((p: any) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">{p.full_name ?? p.email}</div>
                <div className="text-xs text-muted-foreground">{p.email}</div>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{p.id.slice(0, 8)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
