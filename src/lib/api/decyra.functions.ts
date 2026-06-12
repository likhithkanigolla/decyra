import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getMyContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }, { data: memberships }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("project_members").select("role, project_id, projects(id,name,code,description)").eq("user_id", userId),
    ]);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    return { userId, profile, isAdmin, memberships: memberships ?? [] };
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1).max(120),
      code: z.string().min(2).max(16).regex(/^[A-Z0-9]+$/, "Use uppercase letters and digits"),
      description: z.string().max(2000).optional(),
      repo_url: z.string().url().optional().or(z.literal("")),
      branch: z.string().max(120).optional(),
      adr_path: z.string().max(255).optional(),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Only platform admins can create projects (also enforced by RLS)
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw new Error("Only platform admins can create projects.");
    }
    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        name: data.name,
        code: data.code,
        description: data.description ?? null,
        repo_url: data.repo_url || null,
        branch: data.branch || "main",
        adr_path: data.adr_path || "docs/adr",
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    // Creator becomes project_admin
    await supabase.from("project_members").insert({
      project_id: project.id,
      user_id: userId,
      role: "project_admin",
    });
    return project;
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");
    const { data: members } = await supabase
      .from("project_members")
      .select("id, role, user_id, profiles(full_name, email, avatar_url)")
      .eq("project_id", data.id);
    const { data: adrs } = await supabase
      .from("adrs").select("id, full_id, title, status, tags, updated_at, author_id")
      .eq("project_id", data.id)
      .order("adr_number", { ascending: false });
    const { data: myMembership } = await supabase
      .from("project_members").select("role").eq("project_id", data.id).eq("user_id", userId).maybeSingle();
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    return { project, members: members ?? [], adrs: adrs ?? [], myRole: myMembership?.role ?? null, isAdmin };
  });

export const listProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("profiles").select("id, email, full_name");
    return data ?? [];
  });

export const addProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      project_id: z.string().uuid(),
      user_id: z.string().uuid(),
      role: z.enum(["project_admin", "engineer", "intern"]),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("project_members").upsert(
      { project_id: data.project_id, user_id: data.user_id, role: data.role },
      { onConflict: "project_id,user_id" }
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("project_members").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createAdr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      project_id: z.string().uuid(),
      title: z.string().min(3).max(200),
      tags: z.array(z.string()).default([]),
      context: z.string().default(""),
      decision: z.string().default(""),
      consequences: z.string().default(""),
      alternatives: z.string().default(""),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: adr, error } = await supabase.from("adrs").insert({
      project_id: data.project_id,
      title: data.title,
      tags: data.tags,
      context: data.context,
      decision: data.decision,
      consequences: data.consequences,
      alternatives: data.alternatives,
      author_id: userId,
      // adr_number / full_id assigned by trigger
      adr_number: 0,
      full_id: "PENDING",
    }).select().single();
    if (error) throw new Error(error.message);
    return adr;
  });

export const getAdr = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: adr, error } = await supabase.from("adrs").select("*, projects(id, name, code, required_approvals)").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!adr) throw new Error("ADR not found");
    const [{ data: approvals }, { data: comments }, { data: versions }] = await Promise.all([
      supabase.from("approvals").select("*, profiles(full_name, email)").eq("adr_id", data.id),
      supabase.from("comments").select("*, profiles(full_name, email)").eq("adr_id", data.id).order("created_at"),
      supabase.from("published_versions").select("*, profiles(full_name, email)").eq("adr_id", data.id).order("version_number", { ascending: false }),
    ]);
    return { adr, approvals: approvals ?? [], comments: comments ?? [], versions: versions ?? [] };
  });

export const updateAdrStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    status: z.enum(["draft", "under_review", "approved", "published", "superseded"]),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("adrs").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveAdr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    adr_id: z.string().uuid(),
    decision: z.enum(["approve", "request_changes"]),
    note: z.string().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("approvals").upsert({
      adr_id: data.adr_id,
      user_id: context.userId,
      decision: data.decision,
      note: data.note ?? null,
    }, { onConflict: "adr_id,user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ adr_id: z.string().uuid(), body: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("comments").insert({
      adr_id: data.adr_id, user_id: context.userId, body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const dashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: adrs } = await supabase.from("adrs").select("id, status, full_id, title, updated_at, project_id, projects(name, code)").order("updated_at", { ascending: false }).limit(20);
    const counts = { total: 0, draft: 0, under_review: 0, approved: 0, published: 0, superseded: 0 };
    (adrs ?? []).forEach((a: any) => { counts.total++; counts[a.status as keyof typeof counts]++; });
    const { data: projects } = await supabase.from("projects").select("id, name, code");
    return { recent: adrs ?? [], counts, projectsCount: (projects ?? []).length };
  });
