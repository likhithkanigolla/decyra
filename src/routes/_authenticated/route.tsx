import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyContext } from "@/lib/api/decyra.functions";
import { LayoutDashboard, FolderKanban, FileText, LogOut, Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Shell,
});

function Shell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fetchMe = useServerFn(getMyContext);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = [
    { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/app/projects", label: "Projects", icon: FolderKanban },
    { to: "/app/adrs", label: "All ADRs", icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col">
        <Link to="/app" className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground font-bold text-sm">D</div>
          <span className="font-semibold">Decyra</span>
        </Link>
        <nav className="flex-1 p-2 space-y-1">
          {nav.map((n) => {
            const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to as any}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"}`}>
                <n.icon className="h-4 w-4" />{n.label}
              </Link>
            );
          })}
          {me?.isAdmin && (
            <Link to="/app/admin" className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${pathname.startsWith("/app/admin") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"}`}>
              <Shield className="h-4 w-4" />Admin
            </Link>
          )}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-semibold">
              {(me?.profile?.full_name ?? me?.profile?.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{me?.profile?.full_name ?? "Loading…"}</div>
              <div className="truncate text-xs text-muted-foreground">{me?.isAdmin ? "Platform admin" : "Member"}</div>
            </div>
            <button onClick={signOut} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
