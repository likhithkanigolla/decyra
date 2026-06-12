import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyContext, updateProfile, changePassword } from "@/lib/api/decyra.functions";
import { useState } from "react";
import { toast } from "sonner";
import { User, Lock, Shield, Check } from "lucide-react";

const IS_LOCAL = import.meta.env.VITE_DATABASE_TYPE === "postgres";

export const Route = createFileRoute("/_authenticated/app/profile")({
  head: () => ({ meta: [{ title: "Profile — Decyra" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const fetchMe = useServerFn(getMyContext);
  const updateProfileFn = useServerFn(updateProfile);
  const changePasswordFn = useServerFn(changePassword);
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });

  // Profile form
  const [profileForm, setProfileForm] = useState({ full_name: "", avatar_url: "" });
  const [profileInitialized, setProfileInitialized] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);

  // Password form
  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);

  // Initialize profile form once data loads
  if (me?.profile && !profileInitialized) {
    setProfileForm({
      full_name: me.profile.full_name ?? "",
      avatar_url: me.profile.avatar_url ?? "",
    });
    setProfileInitialized(true);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    try {
      await updateProfileFn({ data: { full_name: profileForm.full_name, avatar_url: profileForm.avatar_url } });
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally { setProfileBusy(false); }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwForm.new_password !== pwForm.confirm) {
      toast.error("New passwords do not match");
      return;
    }
    setPwBusy(true);
    try {
      await changePasswordFn({ data: { current_password: pwForm.current_password, new_password: pwForm.new_password } });
      toast.success("Password changed successfully");
      setPwForm({ current_password: "", new_password: "", confirm: "" });
    } catch (err: any) {
      toast.error(err.message);
    } finally { setPwBusy(false); }
  }

  const initials = (me?.profile?.full_name ?? me?.profile?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/15 text-primary text-2xl font-bold border-2 border-primary/30">
          {initials}
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{me?.profile?.full_name ?? "Your Profile"}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground">{me?.profile?.email}</span>
            {me?.isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                <Shield className="h-3 w-3" /> Platform Admin
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Profile Info */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <User className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Personal information</h2>
        </div>
        <form onSubmit={saveProfile} className="space-y-4">
          <Field label="Full name">
            <input
              required
              value={profileForm.full_name}
              onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
              placeholder="Jane Smith"
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Avatar URL" hint="Optional — link to a profile image">
            <input
              value={profileForm.avatar_url}
              onChange={(e) => setProfileForm({ ...profileForm, avatar_url: e.target.value })}
              placeholder="https://…"
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Email (read-only)">
            <input
              disabled
              value={me?.profile?.email ?? ""}
              className="w-full h-10 rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground cursor-not-allowed"
            />
          </Field>
          <div className="flex justify-end">
            <button
              disabled={profileBusy}
              type="submit"
              className="inline-flex items-center gap-2 h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {profileBusy ? "Saving…" : <><Check className="h-4 w-4" /> Save changes</>}
            </button>
          </div>
        </form>
      </section>

      {/* Change Password — local mode only */}
      {IS_LOCAL ? (
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Change password</h2>
          </div>
          <form onSubmit={savePassword} className="space-y-4">
            <Field label="Current password">
              <input
                type="password"
                required
                value={pwForm.current_password}
                onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="New password">
                <input
                  type="password"
                  required
                  minLength={8}
                  value={pwForm.new_password}
                  onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                  placeholder="Min 8 characters"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="password"
                  required
                  minLength={8}
                  value={pwForm.confirm}
                  onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                  placeholder="Repeat password"
                  className={`w-full h-10 rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-ring bg-background ${
                    pwForm.confirm && pwForm.confirm !== pwForm.new_password ? "border-destructive" : "border-input"
                  }`}
                />
              </Field>
            </div>
            {pwForm.confirm && pwForm.confirm !== pwForm.new_password && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
            <div className="flex justify-end">
              <button
                disabled={pwBusy || (!!pwForm.confirm && pwForm.confirm !== pwForm.new_password)}
                type="submit"
                className="inline-flex items-center gap-2 h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {pwBusy ? "Changing…" : <><Lock className="h-4 w-4" /> Change password</>}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Password</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            To change your password, use the{" "}
            <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Supabase dashboard
            </a>{" "}
            or the email link from your account settings.
          </p>
        </section>
      )}

      {/* Account info */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Account details</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">User ID</dt>
            <dd className="font-mono text-xs">{me?.userId}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Platform role</dt>
            <dd>{me?.isAdmin ? "Admin" : "Member"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Projects</dt>
            <dd>{me?.memberships?.length ?? 0}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground/70">{hint}</span>}
    </label>
  );
}
