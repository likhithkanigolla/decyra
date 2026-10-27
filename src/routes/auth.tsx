import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  loginLocalFn,
  signUpLocalFn,
  checkIsFirstRunFn,
  generateRecoveryKeyFn,
  resetPasswordWithRecoveryKeyFn,
} from "@/lib/api/decyra.functions";
import { getErrorMessage } from "@/lib/utils";
import { KeyRound, ShieldAlert, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Decyra" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPass, setIsForgotPass] = useState(false);
  const [isRecoveryReset, setIsRecoveryReset] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedFileInfo, setGeneratedFileInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);

  const queryClient = useQueryClient();
  const localLoginFn = useServerFn(loginLocalFn);
  const localSignUpFn = useServerFn(signUpLocalFn);
  const checkFirstRun = useServerFn(checkIsFirstRunFn);
  const generateRecoveryKey = useServerFn(generateRecoveryKeyFn);
  const resetWithRecoveryKey = useServerFn(resetPasswordWithRecoveryKeyFn);

  useEffect(() => {
    checkFirstRun().then(setIsFirstRun).catch(() => setIsFirstRun(false));
  }, [checkFirstRun]);

  useEffect(() => {
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
  }, [navigate]);

  async function handleGenerateRecoveryKey() {
    if (!identifier.trim()) {
      toast.error("Please enter your email or username first.");
      return;
    }
    setGeneratingKey(true);
    setGeneratedFileInfo(null);
    try {
      const res = await generateRecoveryKey({ data: { identifier } });
      setGeneratedFileInfo(res.filePath);
      toast.success("Recovery key generated on server!");
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to generate recovery key"));
    } finally {
      setGeneratingKey(false);
    }
  }

  async function handleRecoveryReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await resetWithRecoveryKey({
        data: {
          identifier,
          recoveryKey,
          newPassword,
        },
      });
      toast.success(res.message);
      setIsRecoveryReset(false);
      setIsForgotPass(false);
      setPassword(newPassword);
      setRecoveryKey("");
      setNewPassword("");
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Recovery reset failed"));
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (isForgotPass) {
        toast.error("Use your server recovery key below to reset your password.");
        setLoading(false);
        return;
      }

      if (isSignUp && isFirstRun) {
        const result = await localSignUpFn({ data: { email: identifier, password, fullName, username: username || undefined } });
        localStorage.setItem("local_auth_token", result.token);
      } else {
        const result = await localLoginFn({ data: { identifier, password } });
        localStorage.setItem("local_auth_token", result.token);
      }
      queryClient.clear();
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Authentication failed"));
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
            {isRecoveryReset
              ? "Recover Account"
              : isForgotPass
                ? "Reset Password"
                : isSignUp && isFirstRun
                  ? "Platform Setup"
                  : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isRecoveryReset
              ? "Enter your recovery key found in the server file structure."
              : isForgotPass
                ? "Self-hosted recovery key authentication."
                : isSignUp && isFirstRun
                  ? "Create the initial administrator account."
                  : "Welcome back to your governance workspace."}
          </p>

          {isRecoveryReset ? (
            <form onSubmit={handleRecoveryReset} className="mt-5 space-y-3">
              <Field label="Email or Username">
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  placeholder="admin or admin@example.com"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Server Recovery Key">
                <input
                  type="text"
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                  required
                  placeholder="rec_..."
                  className="w-full h-10 rounded-md border border-input bg-background font-mono px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="New Password">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Minimum 8 characters"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <button
                disabled={loading}
                type="submit"
                className="w-full h-10 mt-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Resetting…" : "Reset Password With Key"}
              </button>
              <button
                type="button"
                onClick={() => setIsRecoveryReset(false)}
                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground outline-none"
              >
                Back to sign in options
              </button>
            </form>
          ) : (
            <>
              {isForgotPass && (
                <div className="mt-4 p-3 rounded-lg bg-accent/40 border border-border text-xs space-y-2">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <ShieldAlert className="h-4 w-4 text-amber-500" />
                    <span>Server Recovery Key</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    In self-hosted mode, recovery keys are stored directly in your server's file system (<code>recovery-keys/</code>) so only administrators with server access can read them.
                  </p>

                  <div className="pt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={generatingKey}
                      onClick={handleGenerateRecoveryKey}
                      className="inline-flex items-center justify-center gap-1.5 h-8 rounded bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {generatingKey ? "Saving key to server…" : "Generate recovery key to server file"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsRecoveryReset(true)}
                      className="inline-flex items-center justify-center h-8 rounded border border-primary/30 text-xs font-medium text-primary hover:bg-primary/10"
                    >
                      I have my recovery key → Reset password
                    </button>
                  </div>

                  {generatedFileInfo && (
                    <div className="mt-2 p-2 rounded bg-background border border-border flex items-start gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">Key saved on server:</div>
                        <div className="font-mono text-[10px] break-all">{generatedFileInfo}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={submit} className="mt-5 space-y-3">
                {!isForgotPass && isSignUp && isFirstRun && (
                  <>
                    <Field label="Full Name">
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </Field>
                    <Field label="Username">
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        minLength={3}
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </Field>
                  </>
                )}
                <Field
                  label={
                    isForgotPass
                      ? "Email or Username"
                      : isSignUp
                        ? "Email"
                        : "Email or Username"
                  }
                >
                  <input
                    type={!isForgotPass && isSignUp ? "email" : "text"}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </Field>
                {!isForgotPass && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-muted-foreground">
                        Password
                      </label>
                      {(!isFirstRun || !isSignUp) && (
                        <button
                          type="button"
                          onClick={() => setIsForgotPass(true)}
                          className="text-[10px] text-primary hover:underline outline-none"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                )}
                {!isForgotPass ? (
                  <button
                    disabled={loading}
                    type="submit"
                    className="w-full h-10 mt-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {loading
                      ? "Please wait…"
                      : isSignUp && isFirstRun
                        ? "Complete Setup"
                        : "Sign in"}
                  </button>
                ) : null}
              </form>
            </>
          )}

          {isForgotPass ? (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Remember your password?{" "}
              <button type="button" onClick={() => setIsForgotPass(false)} className="font-medium text-primary hover:underline outline-none">
                Sign in
              </button>
            </p>
          ) : isFirstRun ? (
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
              New users must be created by a platform admin.
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
