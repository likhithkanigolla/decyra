import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProfiles, createUser, updateUser, adminResetPassword, listProjects, addProjectMember, deleteUser, toggleUserLock } from "@/lib/api/decyra.functions";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, X, Shield, User, Pencil, Key, FolderPlus, Trash2, Lock, Unlock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Decyra" }] }),
  component: Admin,
});

const DEFAULT_CREATE = { email: "", password: "", full_name: "", username: "", role: "member" as "admin" | "member" };
const DEFAULT_EDIT = { user_id: "", full_name: "", role: "member" as "admin" | "member" };

function Admin() {
  const profilesFn = useServerFn(listProfiles);
  const createUserFn = useServerFn(createUser);
  const updateUserFn = useServerFn(updateUser);
  const qc = useQueryClient();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => profilesFn(),
  });

  const listProjectsFn = useServerFn(listProjects);
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjectsFn(),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE);
  const [createBusy, setCreateBusy] = useState(false);

  const [editTarget, setEditTarget] = useState<null | { id: string; full_name: string; role: string; email: string }>(null);
  const [editForm, setEditForm] = useState(DEFAULT_EDIT);
  const [editBusy, setEditBusy] = useState(false);

  const adminResetFn = useServerFn(adminResetPassword);
  const [resetTarget, setResetTarget] = useState<null | { id: string; email: string }>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const deleteUserFn = useServerFn(deleteUser);
  const assignProjectFn = useServerFn(addProjectMember);
  const [assignTarget, setAssignTarget] = useState<null | { id: string; email: string; full_name: string }>(null);
  const [assignForm, setAssignForm] = useState({ project_id: "", role: "engineer" as const });
  const [assignBusy, setAssignBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<null | { id: string; email: string; full_name: string }>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const toggleLockFn = useServerFn(toggleUserLock);
  const [lockBusy, setLockBusy] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    try {
      const payload = { ...createForm, username: createForm.username || undefined };
      await createUserFn({ data: payload });
      toast.success(`User ${createForm.email} created`);
      setCreateForm(DEFAULT_CREATE);
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create user");
    } finally { setCreateBusy(false); }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditBusy(true);
    try {
      await updateUserFn({ data: { user_id: editForm.user_id, full_name: editForm.full_name, role: editForm.role as any } });
      toast.success("User updated");
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update user");
    } finally { setEditBusy(false); }
  }

  function openEdit(p: any) {
    setEditTarget(p);
    setEditForm({ user_id: p.id, full_name: p.full_name ?? "", role: "member" });
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetBusy(true);
    try {
      await adminResetFn({ data: { target_user_id: resetTarget.id, new_password: resetPasswordValue } });
      toast.success("Password reset successfully");
      setResetTarget(null);
      setResetPasswordValue("");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to reset password");
    } finally {
      setResetBusy(false);
    }
  }

  async function handleAssignProject(e: React.FormEvent) {
    e.preventDefault();
    if (!assignTarget || !assignForm.project_id) return;
    setAssignBusy(true);
    try {
      await assignProjectFn({ data: { project_id: assignForm.project_id, user_id: assignTarget.id, role: assignForm.role as any } });
      toast.success("Project assigned successfully");
      setAssignTarget(null);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to assign project");
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteUserFn({ data: { target_user_id: deleteTarget.id } });
      toast.success(`User ${deleteTarget.email} deleted`);
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to delete user");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleToggleLock(user: any) {
    setLockBusy(user.id);
    try {
      await toggleLockFn({ data: { target_user_id: user.id, lock: !user.is_locked } });
      toast.success(`User ${user.email} ${user.is_locked ? 'unlocked' : 'locked'}`);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update lock status");
    } finally {
      setLockBusy(null);
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform administration</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage users and platform-level configuration.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
          <UserPlus className="h-4 w-4" /> Create user
        </button>
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Users</h2>
        <div className="mt-3 rounded-lg border border-border bg-card divide-y divide-border">
          {isLoading && <div className="px-4 py-6 text-sm text-muted-foreground">Loading users…</div>}
          {!isLoading && (profiles ?? []).length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground">No users yet. Create the first user above.</div>
          )}
          {(profiles ?? []).map((p: any) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-semibold">
                  {(p.full_name ?? p.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    {p.full_name ?? "—"}
                    {p.is_locked && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-destructive tracking-widest">Locked</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{p.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-mono">{p.id.slice(0, 8)}</span>
                <button onClick={() => { setAssignTarget(p); setAssignForm({ project_id: "", role: "engineer" }); }}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Assign to project">
                  <FolderPlus className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setResetTarget(p)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Reset password">
                  <Key className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => openEdit(p)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Edit user">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleToggleLock(p)} disabled={lockBusy === p.id}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-500 disabled:opacity-50" title={p.is_locked ? "Unlock user" : "Lock user"}>
                  {p.is_locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => setDeleteTarget(p)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete user">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Create User Modal ── */}
      {showCreate && (
        <Modal title="Create new user" onClose={() => { setShowCreate(false); setCreateForm(DEFAULT_CREATE); }}>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Full name">
              <input required value={createForm.full_name}
                onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                placeholder="Jane Smith"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Username (optional)">
              <input type="text" minLength={3} maxLength={30} value={createForm.username}
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                placeholder="janesmith"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Email">
              <input type="email" required value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                placeholder="jane@example.com"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Password">
              <input type="password" required minLength={8} value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                placeholder="Minimum 8 characters"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <RolePicker value={createForm.role} onChange={(r) => setCreateForm({ ...createForm, role: r })} />
            <ModalActions onCancel={() => { setShowCreate(false); setCreateForm(DEFAULT_CREATE); }} busy={createBusy} label="Create user" />
          </form>
        </Modal>
      )}

      {/* ── Edit User Modal ── */}
      {editTarget && (
        <Modal title={`Edit user — ${editTarget.full_name ?? editTarget.id.slice(0,8)}`} onClose={() => setEditTarget(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <Field label="Full name">
              <input required value={editForm.full_name}
                onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Email (read-only)">
              <input disabled value={(editTarget as any).email ?? ""}
                className="w-full h-10 rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground cursor-not-allowed" />
            </Field>
            <RolePicker value={editForm.role} onChange={(r) => setEditForm({ ...editForm, role: r })} />
            <ModalActions onCancel={() => setEditTarget(null)} busy={editBusy} label="Save changes" />
          </form>
        </Modal>
      )}

      {/* ── Reset Password Modal ── */}
      {resetTarget && (
        <Modal title={`Reset password — ${resetTarget.email}`} onClose={() => { setResetTarget(null); setResetPasswordValue(""); }}>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <Field label="New password">
              <input type="password" required minLength={8} value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <ModalActions onCancel={() => { setResetTarget(null); setResetPasswordValue(""); }} busy={resetBusy} label="Reset password" />
          </form>
        </Modal>
      )}

      {/* ── Assign Project Modal ── */}
      {assignTarget && (
        <Modal title={`Assign to project — ${assignTarget.full_name ?? assignTarget.email}`} onClose={() => setAssignTarget(null)}>
          <form onSubmit={handleAssignProject} className="space-y-4">
            <Field label="Project">
              <select required value={assignForm.project_id}
                onChange={(e) => setAssignForm({ ...assignForm, project_id: e.target.value })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select a project…</option>
                {(projects ?? []).map((proj: any) => (
                  <option key={proj.id} value={proj.id}>{proj.name} ({proj.code})</option>
                ))}
              </select>
            </Field>
            <Field label="Project role">
              <select required value={assignForm.role}
                onChange={(e) => setAssignForm({ ...assignForm, role: e.target.value as any })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="project_admin">Project admin</option>
                <option value="engineer">Engineer</option>
                <option value="intern">Intern</option>
              </select>
            </Field>
            <ModalActions onCancel={() => setAssignTarget(null)} busy={assignBusy} label="Assign project" />
          </form>
        </Modal>
      )}

      {/* ── Delete User Confirmation ── */}
      {deleteTarget && (
        <Modal title="Delete user" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-foreground">{deleteTarget.full_name || deleteTarget.email}</span>?
              This will remove their account, project memberships, and all associated data. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setDeleteTarget(null)}
                className="h-10 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent">Cancel</button>
              <button disabled={deleteBusy} onClick={handleDeleteUser}
                className="h-10 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50">
                {deleteBusy ? "Deleting…" : "Delete user"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RolePicker({ value, onChange }: { value: "admin" | "member"; onChange: (r: "admin" | "member") => void }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">Platform role</span>
      <div className="grid grid-cols-2 gap-2">
        {([["member", "Member", User, "Can join projects"], ["admin", "Admin", Shield, "Full platform access"]] as const).map(([v, label, Icon, desc]) => (
          <button key={v} type="button" onClick={() => onChange(v)}
            className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-colors ${value === v ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-accent"}`}>
            <Icon className="h-4 w-4 mt-0.5 shrink-0" />
            <div><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted-foreground">{desc}</div></div>
          </button>
        ))}
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

function ModalActions({ onCancel, busy, label }: { onCancel: () => void; busy: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onCancel} className="h-10 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent">Cancel</button>
      <button disabled={busy} type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {busy ? "Saving…" : label}
      </button>
    </div>
  );
}
