import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/update-password")({
  head: () => ({ meta: [{ title: "Update Password — Decyra" }] }),
  component: UpdatePassword,
});

function UpdatePassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    // Check if the user is authenticated (they should be, from the magic link)
    import("@/integrations/supabase/client").then(({ supabase }) => {
      supabase.auth.getSession().then(({ data, error }) => {
        if (error || !data.session) {
          toast.error("Invalid or expired reset link. Please try again.");
          navigate({ to: "/auth" });
        } else {
          setSessionChecked(true);
        }
      });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.auth.updateUser({ password });
      
      if (error) throw error;
      
      toast.success("Password updated successfully!");
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update password.");
    } finally {
      setLoading(false);
    }
  }

  if (!sessionChecked) return <div className="min-h-screen grid place-items-center"><div className="animate-pulse">Loading...</div></div>;

  return (
    <div className="min-h-screen bg-background grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">D</div>
          <span className="text-lg font-semibold">Decyra</span>
        </Link>
        <div className="rounded-xl border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">Update Password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Please enter your new password below.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">New Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </label>
            
            <button disabled={loading} type="submit"
              className="w-full h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {loading ? "Updating…" : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
