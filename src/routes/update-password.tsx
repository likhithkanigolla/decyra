import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/update-password")({
  head: () => ({ meta: [{ title: "Update Password — Decyra" }] }),
  component: UpdatePassword,
});

function UpdatePassword() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("local_auth_token") : null;
    if (token) {
      navigate({ to: "/profile" });
    } else {
      navigate({ to: "/auth" });
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background grid place-items-center px-4">
      <div className="w-full max-w-sm text-center">
        <Link to="/" className="mb-8 inline-flex items-center justify-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">D</div>
          <span className="text-lg font-semibold">Decyra</span>
        </Link>
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h1 className="text-xl font-semibold">Password Management</h1>
          <p className="text-sm text-muted-foreground">
            Password changes are handled in your Profile when logged in, or via Server Recovery Key on the sign-in page.
          </p>
          <div className="pt-2">
            <Link
              to="/auth"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Go to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
