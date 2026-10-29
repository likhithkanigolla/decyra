import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyContext } from "@/lib/api/decyra.functions";
import {
  LayoutDashboard, FolderKanban, FileText, LogOut, Shield,
  Search, Sun, Moon, GitBranch, ChevronRight,
  PanelLeftClose, PanelLeftOpen, Pin
} from "lucide-react";
import { NotificationBell } from "@/components/decyra/NotificationBell";
import { useState, useEffect } from "react";

type Theme = "dark" | "light";

function getTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem("theme") as Theme) ?? "dark";
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.classList.toggle("light", t === "light");
  document.documentElement.dataset.colorMode = t;
  localStorage.setItem("theme", t);
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
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
  },
  component: Shell,
});

function Shell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fetchMe = useServerFn(getMyContext);
  const queryClient = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchMe(),
    staleTime: 0,        // always re-fetch on mount — avoids stale user shown after re-login
    gcTime: 0,           // don't cache between sessions
  });
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("decyra_sidebar_collapsed") === "true";
  });
  const [isHovered, setIsHovered] = useState(false);

  // Apply theme on mount
  useEffect(() => { applyTheme(theme); }, [theme]);

  function toggleSidebarCollapse() {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("decyra_sidebar_collapsed", String(next));
      return next;
    });
  }

  // Keyboard shortcuts: Cmd+K (search) & Cmd+B (toggle sidebar)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate({ to: "/search" });
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebarCollapse();
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
    // Clear ALL cached queries so the next user sees a clean slate immediately
    queryClient.clear();
    localStorage.removeItem("local_auth_token");
    navigate({ to: "/auth", replace: true });
  }

  const nav = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    { to: "/adrs", label: "All ADRs", icon: FileText },
    { to: "/search", label: "Search", icon: Search },
  ];

  const isActive = (n: typeof nav[0]) =>
    n.exact ? pathname === n.to : pathname.startsWith(n.to);

  const initials = (me?.profile?.full_name ?? me?.profile?.email ?? "?")
    .split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  const isExpanded = !isCollapsed || isHovered;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar container (placeholder reserves width in normal layout flow) */}
      <div className={`relative shrink-0 transition-[width] duration-200 ease-in-out ${isCollapsed ? "w-16" : "w-64"}`}>
        <aside
          onMouseEnter={() => isCollapsed && setIsHovered(true)}
          onMouseLeave={() => isCollapsed && setIsHovered(false)}
          className={`h-screen flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 ease-in-out z-40 ${
            isCollapsed
              ? isHovered
                ? "fixed left-0 top-0 w-64 shadow-2xl ring-1 ring-border/50"
                : "sticky top-0 w-16"
              : "sticky top-0 w-64"
          }`}
        >
          {/* Logo & Header */}
          <div className={`flex h-14 items-center border-b border-sidebar-border shrink-0 ${isExpanded ? "px-4 gap-2.5" : "px-2 justify-center"}`}>
            <Link to="/dashboard" className="flex items-center gap-2.5 min-w-0" title="Decyra Dashboard">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground font-bold text-sm shadow-sm">
                D
              </div>
              {isExpanded && (
                <>
                  <span className="font-semibold tracking-tight truncate">Decyra</span>
                  <span className="text-[10px] font-medium text-muted-foreground/50 tracking-widest uppercase">Beta</span>
                </>
              )}
            </Link>

            {isExpanded && (
              <button
                onClick={toggleSidebarCollapse}
                className="ml-auto text-sidebar-foreground/50 hover:text-sidebar-foreground p-1 rounded-md hover:bg-sidebar-accent/50 transition-colors"
                title={isCollapsed ? "Pin sidebar open (⌘B)" : "Collapse sidebar (⌘B) — open on hover"}
                aria-label="Toggle sidebar collapse"
              >
                {isCollapsed ? <Pin className="h-3.5 w-3.5 text-primary" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>

          {/* Quick search */}
          <div className={`py-2 shrink-0 ${isExpanded ? "px-3" : "px-2 text-center"}`}>
            {isExpanded ? (
              <button
                onClick={() => navigate({ to: "/search" })}
                className="w-full flex items-center gap-2 h-8 rounded-md bg-sidebar-accent/40 border border-sidebar-border px-3 text-xs text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="truncate">Search ADRs…</span>
                <kbd className="ml-auto text-[10px] bg-sidebar-border rounded px-1 py-0.5 font-mono">⌘K</kbd>
              </button>
            ) : (
              <button
                onClick={() => navigate({ to: "/search" })}
                title="Search ADRs (⌘K)"
                className="h-9 w-9 mx-auto grid place-items-center rounded-md bg-sidebar-accent/40 border border-sidebar-border text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              >
                <Search className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Nav Links */}
          <nav className="flex-1 px-2 py-1 space-y-1 overflow-y-auto overflow-x-hidden">
            {isExpanded && (
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">Navigation</p>
            )}
            {nav.map((n) => {
              const active = isActive(n);
              if (!isExpanded) {
                return (
                  <Link
                    key={n.to}
                    to={n.to as any}
                    title={n.label}
                    className={`h-9 w-9 mx-auto grid place-items-center rounded-lg text-sm transition-colors ${
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-xs"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    }`}
                  >
                    <n.icon className="h-4 w-4 shrink-0" />
                  </Link>
                );
              }

              return (
                <Link
                  key={n.to}
                  to={n.to as any}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
                >
                  <n.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{n.label}</span>
                  {active && <ChevronRight className="h-3 w-3 ml-auto opacity-50 shrink-0" />}
                </Link>
              );
            })}

            {/* Admin Section */}
            {me?.isAdmin && (
              <>
                {isExpanded ? (
                  <>
                    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">Admin</p>
                    <Link
                      to="/admin"
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                        pathname.startsWith("/admin")
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      }`}
                    >
                      <Shield className="h-4 w-4 shrink-0" />
                      <span className="truncate">Platform Admin</span>
                    </Link>
                  </>
                ) : (
                  <div className="pt-2">
                    <Link
                      to="/admin"
                      title="Platform Admin"
                      className={`h-9 w-9 mx-auto grid place-items-center rounded-lg text-sm transition-colors ${
                        pathname.startsWith("/admin")
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      }`}
                    >
                      <Shield className="h-4 w-4 shrink-0" />
                    </Link>
                  </div>
                )}
              </>
            )}

            {/* My Projects */}
            {(me?.memberships ?? []).length > 0 && (
              <>
                {isExpanded ? (
                  <>
                    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">My Projects</p>
                    {(me?.memberships ?? []).slice(0, 5).map((m: any) => (
                      <Link
                        key={m.project_id}
                        to="/projects/$projectId"
                        params={{ projectId: m.project_id }}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                          pathname === `/projects/${m.project_id}`
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                        }`}
                      >
                        <div className="h-4 w-4 shrink-0 grid place-items-center rounded bg-primary/20 text-primary text-[8px] font-bold">
                          {m.projects?.code?.slice(0, 2)}
                        </div>
                        <span className="truncate">{m.projects?.name}</span>
                      </Link>
                    ))}
                  </>
                ) : (
                  <div className="pt-2 space-y-1">
                    {(me?.memberships ?? []).slice(0, 4).map((m: any) => (
                      <Link
                        key={m.project_id}
                        to="/projects/$projectId"
                        params={{ projectId: m.project_id }}
                        title={m.projects?.name}
                        className={`h-8 w-8 mx-auto grid place-items-center rounded-lg transition-colors ${
                          pathname === `/projects/${m.project_id}`
                            ? "bg-primary/20 text-primary font-bold"
                            : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        }`}
                      >
                        <div className="h-5 w-5 grid place-items-center rounded bg-primary/20 text-primary text-[9px] font-bold">
                          {m.projects?.code?.slice(0, 2)}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </nav>

          {/* Footer */}
          <div className="shrink-0 border-t border-sidebar-border p-2">
            {/* Theme toggle */}
            {isExpanded ? (
              <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                <span className="text-xs text-sidebar-foreground/50">Theme</span>
                <button
                  onClick={toggleTheme}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                >
                  {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  {theme === "dark" ? "Light" : "Dark"}
                </button>
              </div>
            ) : (
              <div className="flex justify-center mb-1">
                <button
                  onClick={toggleTheme}
                  title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                  className="h-8 w-8 grid place-items-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                >
                  {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}

            {/* User */}
            {isExpanded ? (
              <Link
                to="/profile"
                className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-sidebar-accent/50 transition-colors group"
              >
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
            ) : (
              <div className="flex justify-center">
                <Link
                  to="/profile"
                  title={`${me?.profile?.full_name ?? "Profile"} (${me?.isAdmin ? "Platform admin" : "Member"})`}
                  className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary text-xs font-semibold border border-primary/20 hover:ring-2 hover:ring-primary/40 transition-all"
                >
                  {initials}
                </Link>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">
        <header className="h-14 border-b border-border/40 bg-background/80 backdrop-blur px-6 sm:px-8 flex items-center justify-between shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <button
              onClick={toggleSidebarCollapse}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
              title={isCollapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B) — open on hover"}
              aria-label="Toggle sidebar collapse"
            >
              {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <span className="font-semibold text-foreground tracking-tight capitalize text-sm">
              {pathname === "/dashboard" ? "Dashboard" : pathname.replace(/^\//, "").split("/")[0]}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
