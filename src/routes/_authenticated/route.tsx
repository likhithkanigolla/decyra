import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyContext } from "@/lib/api/decyra.functions";
import {
  LayoutDashboard, FolderKanban, FileText, LogOut, Shield,
  Search, Sun, Moon, GitBranch, ChevronRight
} from "lucide-react";
import { useState, useEffect } from "react";

const IS_LOCAL = import.meta.env.VITE_DATABASE_TYPE === "postgres";
type Theme = "dark" | "light";

function getTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem("theme") as Theme) ?? "dark";
}
function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.classList.toggle("light", t === "light");
  localStorage.setItem("theme", t);
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (IS_LOCAL) {
      const token = localStorage.getItem("local_auth_token");
      if (!token) throw redirect({ to: "/auth" });
      try {
        const parts = token.split(".");
        if (parts.length !== 3) throw new Error("bad token");
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
          localStorage.removeItem("local_auth_token");
          throw redirect({ to: "/auth" });
        }
        return { user: { id: payload.sub, email: payload.email } };
      } catch {
        localStorage.removeItem("local_auth_token");
        throw redirect({ to: "/auth" });
      }
    }
    const { supabase } = await import("@/integrations/supabase/client");
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
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [searchOpen, setSearchOpen] = useState(false);

  // Apply theme on mount
  useEffect(() => { applyTheme(theme); }, [theme]);

  // Cmd+K global search shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        navigate({ to: "/app/search" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  async function signOut() {
    if (IS_LOCAL) {
      localStorage.removeItem("local_auth_token");
    } else {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.auth.signOut();
    }
    navigate({ to: "/auth", replace: true });
  }

  const nav = [
    { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/app/projects", label: "Projects", icon: FolderKanban },
    { to: "/app/adrs", label: "All ADRs", icon: FileText },
    { to: "/app/search", label: "Search", icon: Search },
  ];

  const isActive = (n: typeof nav[0]) =>
    n.exact ? pathname === n.to : pathname.startsWith(n.to);

  const initials = (me?.profile?.full_name ?? me?.profile?.email ?? "?")
    .split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col h-screen sticky top-0">
        {/* Logo */}
        <Link to="/app" className="flex h-14 items-center gap-2.5 px-4 border-b border-sidebar-border shrink-0">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground font-bold text-sm shadow-sm">
            D
          </div>
          <span className="font-semibold tracking-tight">Decyra</span>
          <span className="ml-auto text-[10px] font-medium text-muted-foreground/50 tracking-widest uppercase">Beta</span>
        </Link>

        {/* Quick search */}
        <div className="px-3 py-2 shrink-0">
          <button
            onClick={() => navigate({ to: "/app/search" })}
            className="w-full flex items-center gap-2 h-8 rounded-md bg-sidebar-accent/40 border border-sidebar-border px-3 text-xs text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            Search ADRs…
            <kbd className="ml-auto text-[10px] bg-sidebar-border rounded px-1 py-0.5 font-mono">⌘K</kbd>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">Navigation</p>
          {nav.map((n) => (
            <Link key={n.to} to={n.to as any}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive(n)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}>
              <n.icon className="h-4 w-4 shrink-0" />
              {n.label}
              {isActive(n) && <ChevronRight className="h-3 w-3 ml-auto opacity-50" />}
            </Link>
          ))}

          {me?.isAdmin && (
            <>
              <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">Admin</p>
              <Link to="/app/admin"
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  pathname.startsWith("/app/admin")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}>
                <Shield className="h-4 w-4 shrink-0" />
                Platform Admin
              </Link>
            </>
          )}

          {/* Projects quick access */}
          {(me?.memberships ?? []).length > 0 && (
            <>
              <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">My Projects</p>
              {(me?.memberships ?? []).slice(0, 5).map((m: any) => (
                <Link key={m.project_id}
                  to="/app/projects/$projectId" params={{ projectId: m.project_id }}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                    pathname === `/app/projects/${m.project_id}`
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                  }`}>
                  <div className="h-4 w-4 shrink-0 grid place-items-center rounded bg-primary/20 text-primary text-[8px] font-bold">
                    {m.projects?.code?.slice(0, 2)}
                  </div>
                  <span className="truncate">{m.projects?.name}</span>
                </Link>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-sidebar-border p-2">
          {/* Theme toggle */}
          <div className="flex items-center justify-between px-2 py-1.5 mb-1">
            <span className="text-xs text-sidebar-foreground/50">Theme</span>
            <button onClick={toggleTheme}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>

          {/* User */}
          <Link to="/app/profile"
            className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-sidebar-accent/50 transition-colors group">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary text-xs font-semibold border border-primary/20">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-sidebar-foreground">{me?.profile?.full_name ?? "Profile"}</div>
              <div className="truncate text-xs text-sidebar-foreground/50">{me?.isAdmin ? "Platform admin" : "Member"}</div>
            </div>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); signOut(); }}
              className="rounded-md p-1 text-sidebar-foreground/40 hover:text-sidebar-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
