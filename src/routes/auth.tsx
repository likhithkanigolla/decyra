import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { loginLocalFn, signUpLocalFn, checkIsFirstRunFn, lookupEmailByUsernameFn } from "@/lib/api/decyra.functions";
import { toast } from "sonner";

const IS_LOCAL = import.meta.env.VITE_DATABASE_TYPE === "postgres";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Decyra" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPass, setIsForgotPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);

  const queryClient = useQueryClient();
  const localLoginFn = useServerFn(loginLocalFn);
  const localSignUpFn = useServerFn(signUpLocalFn);
  const checkFirstRun = useServerFn(checkIsFirstRunFn);
  const lookupEmailByUsername = useServerFn(lookupEmailByUsernameFn);

  useEffect(() => {
    checkFirstRun().then(setIsFirstRun).catch(() => setIsFirstRun(false));
  }, [checkFirstRun]);

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
      if (isForgotPass) {
        if (IS_LOCAL) {
          toast.error("Email-based password resets are disabled in self-hosted mode. Please contact your database administrator.");
          setLoading(false);
          return;
        }
        let loginEmail = identifier;
        if (!loginEmail.includes("@")) {
          const res = await lookupEmailByUsername({ data: { username: identifier } });
          loginEmail = res.email;
        }
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
          redirectTo: `${window.location.origin}/update-password`,
        });
        if (error) throw error;
        toast.success("Password reset email sent! Check your inbox.");
        setIsForgotPass(false);
        setLoading(false);
        return;
      }

      if (IS_LOCAL) {
        // Local Postgres mode
        if (isSignUp && isFirstRun) {
          const result = await localSignUpFn({ data: { email: identifier, password, fullName, username: username || undefined } });
          localStorage.setItem("local_auth_token", result.token);
        } else {
          const result = await localLoginFn({ data: { identifier, password } });
          localStorage.setItem("local_auth_token", result.token);
        }
        queryClient.clear();
        navigate({ to: "/dashboard" });
      } else {
        // Supabase mode
        let loginEmail = identifier;
        if (!loginEmail.includes("@")) {
          const res = await lookupEmailByUsername({ data: { username: identifier } });
          loginEmail = res.email;
        }
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
        if (error) throw error;
        queryClient.clear();
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
          <h1 className="text-xl font-semibold">
            {isForgotPass ? "Reset Password" : (isSignUp && isFirstRun) ? "Platform Setup" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isForgotPass 
              ? "Enter your email or username to receive a reset link." 
              : (isSignUp && isFirstRun) ? "Create the initial administrator account." : "Welcome back to your governance workspace."}
          </p>

          {isForgotPass && IS_LOCAL && (
            <div className="mt-4 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-sm text-amber-600 dark:text-amber-400">
              Email-based password resets are disabled in self-hosted Postgres mode. Please contact your database administrator to reset your password.
            </div>
          )}

          <form onSubmit={submit} className="mt-5 space-y-3">
            {!isForgotPass && (isSignUp && isFirstRun) && (
              <>
                <Field label="Full Name">
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </Field>
                <Field label="Username">
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </Field>
              </>
            )}
            <Field label={isForgotPass ? "Email or Username" : isSignUp ? "Email" : "Email or Username"}>
              <input type={!isForgotPass && isSignUp ? "email" : "text"} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            {!isForgotPass && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-muted-foreground">Password</label>
                  {(!isFirstRun || !isSignUp) && (
                    <button type="button" onClick={() => setIsForgotPass(true)} className="text-[10px] text-primary hover:underline outline-none">
                      Forgot password?
                    </button>
                  )}
                </div>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
              </div>
            )}
            <button disabled={loading} type="submit"
              className="w-full h-10 mt-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {loading ? "Please wait…" : isForgotPass ? "Send Reset Link" : ((isSignUp && isFirstRun) ? "Complete Setup" : "Sign in")}
            </button>
          </form>

          {isForgotPass ? (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Remember your password?{" "}
              <button type="button" onClick={() => setIsForgotPass(false)} className="font-medium text-primary hover:underline outline-none">
                Sign in
              </button>
            </p>
          ) : (isFirstRun && IS_LOCAL) ? (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {isSignUp ? "Already set up?" : "Initial setup required."}{" "}
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="font-medium text-primary hover:underline outline-none"
              >
                {isSignUp ? "Sign in instead" : "Set up platform admin"}
              </button>
            </p>
          ) : (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {!IS_LOCAL ? "New users must be invited by a platform admin via Supabase." : "New users must be created by a platform admin."}
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
