import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { loginLocalFn } from "@/lib/api/decyra.functions";
import { toast } from "sonner";

const IS_LOCAL = import.meta.env.VITE_DATABASE_TYPE === "postgres";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Decyra" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const localLoginFn = useServerFn(loginLocalFn);

  useEffect(() => {
    if (IS_LOCAL) {
      // Check for existing valid local token
      const token = localStorage.getItem("local_auth_token");
      if (token) {
        try {
          const parts = token.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (!payload.exp || payload.exp > Math.floor(Date.now() / 1000)) {
              navigate({ to: "/dashboard" });
              return;
            }
          }
          localStorage.removeItem("local_auth_token");
        } catch {
          localStorage.removeItem("local_auth_token");
        }
      }
    } else {
      // Supabase mode: check existing session
      import("@/integrations/supabase/client").then(({ supabase }) => {
        supabase.auth.getSession().then(({ data }) => {
          if (data.session) navigate({ to: "/dashboard" });
        });
      });
    }
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (IS_LOCAL) {
        // Local Postgres mode: call our loginLocalFn server function
        const result = await localLoginFn({ data: { email, password } });
        localStorage.setItem("local_auth_token", result.token);
        navigate({ to: "/dashboard" });
      } else {
        // Supabase mode: unchanged
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">D</div>
          <span className="text-lg font-semibold">Decyra</span>
        </Link>
        <div className="rounded-xl border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back to your governance workspace.
            {IS_LOCAL && (
              <span className="ml-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 text-xs font-medium">
                Local mode
              </span>
            )}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <button disabled={loading} type="submit"
              className="w-full h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {loading ? "Please wait…" : "Sign in"}
            </button>
          </form>

          {!IS_LOCAL && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              New users must be created by a platform admin.
            </p>
          )}
          {IS_LOCAL && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Ask your platform admin to create an account for you.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
