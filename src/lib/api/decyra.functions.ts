import { createServerFn } from "@tanstack/react-start";
import { requireFlexibleAuth } from "@/integrations/supabase/auth-flexible";
import type { FlexibleAuthContext } from "@/integrations/supabase/auth-flexible";
import { z } from "zod";
import { getDatabaseConfig } from "@/integrations/database/config";

// Helper: cast middleware context to the correct type
function ctx(raw: unknown): FlexibleAuthContext {
  return raw as FlexibleAuthContext;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function pgQuery<T = any>(sql: string, params?: any[]) {
  const { query } = await import("@/integrations/database/postgres");
  return query<T>(sql, params);
}

async function pgOne<T = any>(sql: string, params?: any[]) {
  const { queryOne } = await import("@/integrations/database/postgres");
  return queryOne<T>(sql, params);
}

// ─── getMyContext ─────────────────────────────────────────────────────────────

export const getMyContext = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .handler(async ({ context: rawCtx }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const [profileRow, rolesRow, membershipsRow] = await Promise.all([
        pgOne("SELECT * FROM profiles WHERE id = $1", [userId]),
        pgQuery("SELECT role FROM user_roles WHERE user_id = $1", [userId]),
        pgQuery(
          `SELECT pm.role, pm.project_id,
                  p.id AS proj_id, p.name AS proj_name, p.code AS proj_code, p.description AS proj_desc
           FROM project_members pm
           JOIN projects p ON p.id = pm.project_id
           WHERE pm.user_id = $1`,
          [userId]
        ),
      ]);
      const isAdmin = (rolesRow.rows ?? []).some((r: any) => r.role === "admin");
      const memberships = (membershipsRow.rows ?? []).map((m: any) => ({
        role: m.role,
        project_id: m.project_id,
        projects: { id: m.proj_id, name: m.proj_name, code: m.proj_code, description: m.proj_desc },
      }));
      return { userId, profile: profileRow, isAdmin, memberships };
    }

    const [{ data: profile }, { data: roles }, { data: memberships }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("project_members")
        .select("role, project_id, projects(id,name,code,description)")
        .eq("user_id", userId),
    ]);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    return { userId, profile, isAdmin, memberships: memberships ?? [] };
  });

// ─── listProjects ─────────────────────────────────────────────────────────────

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .handler(async ({ context: rawCtx }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const { userId } = context;
      const isAdminRow = await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [userId]);
      const isAdmin = !!isAdminRow;

      if (isAdmin) {
        const result = await pgQuery("SELECT * FROM projects ORDER BY created_at DESC");
        return result.rows;
      } else {
        const result = await pgQuery(
          `SELECT p.* FROM projects p
           JOIN project_members pm ON p.id = pm.project_id
           WHERE pm.user_id = $1
           ORDER BY p.created_at DESC`,
          [userId]
        );
        return result.rows;
      }
    }

    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

// ─── createProject ────────────────────────────────────────────────────────────

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120),
        code: z
          .string()
          .min(2)
          .max(16)
          .regex(/^[A-Z0-9]+$/, "Use uppercase letters and digits"),
        description: z.string().optional(),
        repo_url: z.string().optional(),
        branch: z.string().optional(),
        adr_path: z.string().optional(),
        git_pat: z.string().nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const roleRow = await pgOne<{ role: string }>(
        "SELECT role FROM user_roles WHERE user_id = $1 AND role = 'admin'",
        [userId]
      );
      if (!roleRow) throw new Error("Only platform admins can create projects.");

      const project = await pgOne<any>(
        `INSERT INTO projects (name, code, description, repo_url, branch, adr_path, git_pat, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          data.name,
          data.code,
          data.description ?? null,
          data.repo_url || null,
          data.branch || "main",
          data.adr_path || "docs/adr",
          data.git_pat || null,
          userId,
        ]
      );
      if (!project) throw new Error("Failed to create project");

      await pgQuery(
        `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'project_admin')`,
        [project.id, userId]
      );
      return project;
    }

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
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
        git_pat: data.git_pat || null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await supabase.from("project_members").insert({
      project_id: project.id,
      user_id: userId,
      role: "project_admin",
    });
    return project;
  });

// ─── updateProject (NEW — fixes Issue 4) ─────────────────────────────────────

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        repo_url: z.string().optional(),
        branch: z.string().optional(),
        adr_path: z.string().optional(),
        git_pat: z.string().nullable().optional(),
        required_approvals: z.number().int().min(1).max(20).optional(),
      })
      .parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const isAdmin = !!(await pgOne(
        "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
        [userId]
      ));
      const isProjectAdmin = !!(await pgOne(
        "SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2 AND role = 'project_admin'",
        [userId, data.id]
      ));
      if (!isAdmin && !isProjectAdmin) {
        throw new Error("Only admins or project admins can edit projects.");
      }

      const updated = await pgOne<any>(
        `UPDATE projects SET
           name = $1, description = $2, repo_url = $3,
           branch = $4, adr_path = $5, git_pat = $6, required_approvals = COALESCE($7, required_approvals)
         WHERE id = $8
         RETURNING *`,
        [
          data.name,
          data.description ?? null,
          data.repo_url || null,
          data.branch || "main",
          data.adr_path || "docs/adr",
          data.git_pat ?? null,
          data.required_approvals ?? null,
          data.id,
        ]
      );
      if (!updated) throw new Error("Project not found");
      return updated;
    }

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const { data: membership } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    const isProjectAdmin = membership?.role === "project_admin";
    if (!isAdmin && !isProjectAdmin) {
      throw new Error("Only admins or project admins can edit projects.");
    }

    const { data: project, error } = await supabase
      .from("projects")
      .update({
        name: data.name,
        description: data.description ?? null,
        repo_url: data.repo_url || null,
        branch: data.branch || "main",
        adr_path: data.adr_path || "docs/adr",
        git_pat: data.git_pat ?? null,
        ...(data.required_approvals !== undefined ? { required_approvals: data.required_approvals } : {}),
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return project;
  });

// ─── getProject ───────────────────────────────────────────────────────────────

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const project = await pgOne<any>(
        "SELECT * FROM projects WHERE id = $1",
        [data.id]
      );
      if (!project) throw new Error("Project not found");

      const [membersRow, adrsRow, myMembershipRow, rolesRow] = await Promise.all([
        pgQuery(
          `SELECT pm.id, pm.role, pm.user_id,
                  pr.full_name, pr.email, pr.avatar_url
           FROM project_members pm
           LEFT JOIN profiles pr ON pr.id = pm.user_id
           WHERE pm.project_id = $1`,
          [data.id]
        ),
        pgQuery(
          `SELECT id, full_id, title, status, tags, updated_at, author_id
           FROM adrs WHERE project_id = $1
           ORDER BY adr_number DESC`,
          [data.id]
        ),
        pgOne<{ role: string }>(
          "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
          [data.id, userId]
        ),
        pgQuery("SELECT role FROM user_roles WHERE user_id = $1", [userId]),
      ]);

      const members = (membersRow.rows ?? []).map((m: any) => ({
        id: m.id,
        role: m.role,
        user_id: m.user_id,
        profiles: { full_name: m.full_name, email: m.email, avatar_url: m.avatar_url },
      }));
      const isAdmin = (rolesRow.rows ?? []).some((r: any) => r.role === "admin");

      if (!isAdmin && !myMembershipRow) {
        throw new Error("Unauthorized: You do not have access to this project.");
      }

      return {
        project,
        members,
        adrs: adrsRow.rows ?? [],
        myRole: myMembershipRow?.role ?? null,
        isAdmin,
      };
    }

    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");
    const { data: members } = await supabase
      .from("project_members")
      .select("id, role, user_id, profiles(full_name, email, avatar_url)")
      .eq("project_id", data.id);
    const { data: adrs } = await supabase
      .from("adrs")
      .select("id, full_id, title, status, tags, updated_at, author_id")
      .eq("project_id", data.id)
      .order("adr_number", { ascending: false });
    const { data: myMembership } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    return {
      project,
      members: members ?? [],
      adrs: adrs ?? [],
      myRole: myMembership?.role ?? null,
      isAdmin,
    };
  });

// ─── listProfiles ─────────────────────────────────────────────────────────────

export const listProfiles = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .handler(async ({ context: rawCtx }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const result = await pgQuery<{ id: string; email: string; full_name: string }>(
        "SELECT id, email, full_name FROM profiles ORDER BY full_name"
      );
      return result.rows;
    }

    const { data } = await supabase
      .from("profiles")
      .select("id, email, full_name");
    return data ?? [];
  });

// ─── createUser (NEW — fixes Issue 3) ────────────────────────────────────────

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        full_name: z.string().min(1).max(200),
        username: z.string().min(3).max(30).optional(),
        role: z.enum(["admin", "member"]).default("member"),
      })
      .parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    // Only platform admins can create users
    if (isDatabaseLocal) {
      const isAdmin = !!(await pgOne(
        "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
        [userId]
      ));
      if (!isAdmin) throw new Error("Only platform admins can create users.");

      const { createLocalUser } = await import(
        "@/integrations/database/local-auth.server"
      );
      const user = await createLocalUser(
        data.email,
        data.password,
        data.full_name,
        data.role,
        data.username
      );
      return user;
    }

    // Supabase mode: use admin client to create auth user
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw new Error("Only platform admins can create users.");
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      user_metadata: { full_name: data.full_name, username: data.username },
      email_confirm: true,
    });
    if (error) throw new Error(error.message);

    // Assign role (handle_new_user trigger sets 'member' by default for non-first users)
    if (data.role === "admin") {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: newUser.user.id, role: "admin" }, { onConflict: "user_id,role" });
    }

    return { id: newUser.user.id, email: data.email, username: data.username, full_name: data.full_name, role: data.role };
  });

// ─── loginLocal (NEW — local auth endpoint) ───────────────────────────────────

export const loginLocalFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ identifier: z.string().min(1), password: z.string() }).parse(d)
  )
  .handler(async ({ data }) => {
    const dbConfig = getDatabaseConfig();
    if (!dbConfig.isLocal) {
      throw new Error("Local login is only available in local PostgreSQL mode.");
    }
    const { loginLocal } = await import(
      "@/integrations/database/local-auth.server"
    );
    return loginLocal(data.identifier, data.password);
  });

// ─── lookupEmailByUsernameFn (NEW — Supabase mode lookup) ─────────────────────

export const lookupEmailByUsernameFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ username: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const dbConfig = getDatabaseConfig();
    if (dbConfig.isLocal) {
      throw new Error("Only used in Supabase mode.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("username", data.username.toLowerCase().trim())
      .maybeSingle();
      
    if (!profile || !profile.email) {
      throw new Error("Username not found");
    }
    return { email: profile.email };
  });

// ─── signUpLocal (NEW — local auth endpoint) ───────────────────────────────────

export const checkIsFirstRunFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const dbConfig = getDatabaseConfig();
    if (dbConfig.isLocal) {
      const { queryOne } = await import("@/integrations/database/postgres");
      const result = await queryOne<{ count: string }>("SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin'");
      return parseInt(result?.count || "0", 10) === 0;
    }
    return false; // For Supabase mode, we don't expose UI signups to prevent API abuse
  });

export const signUpLocalFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ email: z.string().email(), password: z.string().min(8), fullName: z.string().min(1), username: z.string().min(3).max(30).optional() }).parse(d)
  )
  .handler(async ({ data }) => {
    const dbConfig = getDatabaseConfig();
    if (!dbConfig.isLocal) {
      throw new Error("Local sign up is only available in local PostgreSQL mode.");
    }
    const { queryOne } = await import("@/integrations/database/postgres");
    const result = await queryOne<{ count: string }>("SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin'");
    const isFirstRun = parseInt(result?.count || "0", 10) === 0;
    
    if (!isFirstRun) {
      throw new Error("Security Error: An admin already exists. Public signups are disabled.");
    }

    const { signUpLocal } = await import(
      "@/integrations/database/local-auth.server"
    );
    // Explicitly grant admin role to the first user
    return signUpLocal(data.email, data.password, data.fullName, "admin", data.username);
  });
// ─── addProjectMember ─────────────────────────────────────────────────────────

export const addProjectMember = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        user_id: z.string().uuid(),
        role: z.enum(["project_admin", "engineer", "intern"]),
      })
      .parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      await pgQuery(
        `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [data.project_id, data.user_id, data.role]
      );
      return { ok: true };
    }

    const { error } = await supabase.from("project_members").upsert(
      { project_id: data.project_id, user_id: data.user_id, role: data.role },
      { onConflict: "project_id,user_id" }
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── removeProjectMember ──────────────────────────────────────────────────────

export const removeProjectMember = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      await pgQuery("DELETE FROM project_members WHERE id = $1", [data.id]);
      return { ok: true };
    }

    const { error } = await supabase
      .from("project_members")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── generateDemoAdrFn (NEW — Onboarding) ───────────────────────────────────

export const generateDemoAdrFn = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    // Get the next sequence number
    let nextSeq = 1;
    if (isDatabaseLocal) {
      const { queryOne } = await import("@/integrations/database/postgres");
      const res = await queryOne<{ count: string }>(
        "SELECT COUNT(*) FROM public.adrs WHERE project_id = $1",
        [data.project_id]
      );
      nextSeq = parseInt(res?.count || "0", 10) + 1;
    } else {
      const { count } = await supabase
        .from("adrs")
        .select("*", { count: "exact", head: true })
        .eq("project_id", data.project_id);
      nextSeq = (count ?? 0) + 1;
    }

    const demoAdr = {
      project_id: data.project_id,
      sequence_num: nextSeq,
      title: "Adopt Event-Driven Architecture for User Notifications",
      status: "approved",
      author_id: userId,
      tags: ["messaging", "kafka", "notifications"],
      context: "Currently, our notification system uses synchronous HTTP calls between microservices to trigger emails and push notifications. This tightly couples the services, leading to cascading failures when the notification service is down or slow, and makes it difficult to scale the core transaction services during peak load.\\n\\nWe need a way to decouple these services to improve overall system resilience and responsiveness.",
      decision: "We will adopt an **Event-Driven Architecture** using **Apache Kafka** as our central message broker for all user notifications.\\n\\nServices will publish `UserActionCompleted` events to a Kafka topic. The Notification Service will act as a consumer, picking up these events asynchronously and processing the required emails or push notifications.",
      consequences: "### Positive\\n- **Decoupling**: Core services no longer depend on the uptime of the Notification Service.\\n- **Resilience**: Spikes in traffic won't crash the notification pipeline, as messages will queue up safely.\\n\\n### Negative\\n- **Complexity**: Introduces a new piece of infrastructure (Kafka) that we must maintain and monitor.\\n- **Eventual Consistency**: Users might experience a slight delay in receiving emails compared to synchronous calls.",
      alternatives: "- **RabbitMQ**: Evaluated but rejected because we anticipate very high throughput and want to leverage Kafka's replayability feature for auditing.\\n- **Redis Pub/Sub**: Rejected because messages are not persistent, and we cannot risk losing notifications if the consumer crashes.",
      design_changes: {
        api_changes: "Removed `POST /internal/notifications` endpoint from the Notification Service.",
        workflow_changes: "Checkout workflow no longer waits for email confirmation before returning `200 OK` to the user.",
        service_changes: "Added Kafka Producer library to `BillingService` and `AuthService`.",
        infrastructure_changes: "Provisioned a managed Confluent Kafka cluster.",
        data_model_changes: ""
      },
      major_impacts: {
        operational: "Need to add Datadog alerts for Kafka consumer lag.",
        testing: "End-to-end tests must be updated to poll for asynchronous email delivery.",
        security: "Need to configure mTLS for Kafka clients.",
        documentation: "Update the Developer Guide with instructions on how to produce and consume events locally using Docker Compose.",
        scalability: "The notification service can now be scaled horizontally based on the size of the Kafka consumer group."
      },
      references_data: {
        pull_requests: [],
        git_commits: [],
        design_docs: ["https://wiki.example.com/architecture/event-driven"],
        wiki_pages: [],
        external: ["https://kafka.apache.org/documentation/"]
      }
    };

    if (isDatabaseLocal) {
      const { queryOne } = await import("@/integrations/database/postgres");
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO public.adrs (
           project_id, sequence_num, title, status, author_id, tags,
           context, decision, consequences, alternatives,
           design_changes, major_impacts, references_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          demoAdr.project_id, demoAdr.sequence_num, demoAdr.title, demoAdr.status, demoAdr.author_id,
          JSON.stringify(demoAdr.tags), demoAdr.context, demoAdr.decision, demoAdr.consequences, demoAdr.alternatives,
          JSON.stringify(demoAdr.design_changes), JSON.stringify(demoAdr.major_impacts), JSON.stringify(demoAdr.references_data)
        ]
      );
      return inserted;
    }

    const { data: inserted, error } = await supabase
      .from("adrs")
      .insert(demoAdr)
      .select()
      .single();
      
    if (error) throw new Error(error.message);
    return inserted;
  });

// ─── createAdr ────────────────────────────────────────────────────────────────

export const createAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        title: z.string().min(3).max(200),
        tags: z.array(z.string()).default([]),
        context: z.string().default(""),
        decision: z.string().default(""),
        consequences: z.string().default(""),
        alternatives: z.string().default(""),
        design_changes: z.object({
          api_changes: z.string().default(""),
          workflow_changes: z.string().default(""),
          service_changes: z.string().default(""),
          infrastructure_changes: z.string().default(""),
          data_model_changes: z.string().default(""),
        }).default({}),
        major_impacts: z.object({
          operational: z.string().default(""),
          testing: z.string().default(""),
          security: z.string().default(""),
          documentation: z.string().default(""),
          scalability: z.string().default(""),
        }).default({}),
        references_data: z.object({
          pull_requests: z.array(z.string()).default([]),
          git_commits: z.array(z.string()).default([]),
          design_docs: z.array(z.string()).default([]),
          wiki_pages: z.array(z.string()).default([]),
          external: z.array(z.string()).default([]),
        }).default({}),
      })
      .parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const adr = await pgOne<any>(
        `INSERT INTO adrs
           (project_id, title, tags, context, decision, consequences, alternatives,
            design_changes, major_impacts, references_data, author_id)
         VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)
         RETURNING *`,
        [
          data.project_id, data.title, data.tags,
          data.context, data.decision, data.consequences, data.alternatives,
          JSON.stringify(data.design_changes),
          JSON.stringify(data.major_impacts),
          JSON.stringify(data.references_data),
          userId,
        ]
      );
      if (!adr) throw new Error("Failed to create ADR");
      return adr;
    }

    const { data: adr, error } = await supabase
      .from("adrs")
      .insert({
        project_id: data.project_id,
        title: data.title,
        tags: data.tags,
        context: data.context,
        decision: data.decision,
        consequences: data.consequences,
        alternatives: data.alternatives,
        design_changes: data.design_changes,
        major_impacts: data.major_impacts,
        references_data: data.references_data,
        author_id: userId,
        adr_number: 0,
        full_id: "PENDING",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return adr;
  });


// ─── getAdr ───────────────────────────────────────────────────────────────────

export const getAdr = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const adr = await pgOne<any>(
        `SELECT a.*, p.id AS proj_id, p.name AS proj_name, p.code AS proj_code, p.required_approvals
         FROM adrs a
         JOIN projects p ON p.id = a.project_id
         WHERE a.id = $1`,
        [data.id]
      );
      if (!adr) throw new Error("ADR not found");

      // Shape to match Supabase nested format
      const shaped = {
        ...adr,
        projects: {
          id: adr.proj_id,
          name: adr.proj_name,
          code: adr.proj_code,
          required_approvals: adr.required_approvals,
        },
      };

      const [approvalsRow, commentsRow, versionsRow, roleRow, adminRow] = await Promise.all([
        pgQuery(
          `SELECT ap.*, pr.full_name, pr.email
           FROM approvals ap LEFT JOIN profiles pr ON pr.id = ap.user_id
           WHERE ap.adr_id = $1`,
          [data.id]
        ),
        pgQuery(
          `SELECT c.*, pr.full_name, pr.email
           FROM comments c LEFT JOIN profiles pr ON pr.id = c.user_id
           WHERE c.adr_id = $1 ORDER BY c.created_at`,
          [data.id]
        ),
        pgQuery(
          `SELECT pv.*, pr.full_name, pr.email
           FROM published_versions pv LEFT JOIN profiles pr ON pr.id = pv.published_by
           WHERE pv.adr_id = $1 ORDER BY pv.version_number DESC`,
          [data.id]
        ),
        pgQuery("SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2", [userId, adr.proj_id]),
        pgQuery("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [userId]),
      ]);

      const shapeWithProfiles = (rows: any[]) =>
        rows.map((r) => ({ ...r, profiles: { full_name: r.full_name, email: r.email } }));

      const isAdmin = (adminRow.rows?.length ?? 0) > 0;
      const myRole = roleRow.rows?.[0]?.role ?? null;

      if (!isAdmin && !myRole) {
        throw new Error("Unauthorized: You do not have access to this ADR's project.");
      }

      return {
        adr: shaped,
        approvals: shapeWithProfiles(approvalsRow.rows ?? []),
        comments: shapeWithProfiles(commentsRow.rows ?? []),
        publishedVersions: shapeWithProfiles(versionsRow.rows ?? []),
        isAdmin,
        myRole,
      };
    }

    const { data: adr, error } = await supabase
      .from("adrs")
      .select("*, projects(id, name, code, required_approvals)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!adr) throw new Error("ADR not found");
    const [{ data: approvals }, { data: comments }, { data: versions }, { data: member }, { data: adminRole }] =
      await Promise.all([
        supabase
          .from("approvals")
          .select("*, profiles(full_name, email)")
          .eq("adr_id", data.id),
        supabase
          .from("comments")
          .select("*, profiles(full_name, email)")
          .eq("adr_id", data.id)
          .order("created_at"),
        supabase
          .from("published_versions")
          .select("*, profiles(full_name, email)")
          .eq("adr_id", data.id)
          .order("version_number", { ascending: false }),
        supabase.from("project_members").select("role").eq("user_id", userId).eq("project_id", adr.project_id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
      ]);
    return {
      adr,
      approvals: approvals ?? [],
      comments: comments ?? [],
      publishedVersions: versions ?? [],
      isAdmin: !!adminRole,
      myRole: member?.role ?? null,
    };
  });

// ─── updateAdrStatus ──────────────────────────────────────────────────────────

export const updateAdrStatus = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["draft", "under_review", "approved", "published", "superseded"]),
      })
      .parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (data.status === "approved") {
      if (isDatabaseLocal) {
        const adminApproveRow = await pgOne(
          `SELECT 1 FROM approvals a
           JOIN user_roles ur ON ur.user_id = a.user_id
           WHERE a.adr_id = $1 AND a.decision = 'approve' AND ur.role = 'admin'`,
          [data.id]
        );
        if (!adminApproveRow) {
          throw new Error("Final Root Admin Approval is mandatory before an ADR can be approved.");
        }
      } else {
        const { data: approvals, error: appErr } = await supabase
          .from("approvals")
          .select("user_id")
          .eq("adr_id", data.id)
          .eq("decision", "approve");
        if (appErr) throw new Error(appErr.message);

        if (!approvals || approvals.length === 0) {
          throw new Error("Final Root Admin Approval is mandatory before an ADR can be approved.");
        }

        const userIds = approvals.map(a => a.user_id);
        const { data: roles, error: rolesErr } = await supabase
          .from("user_roles")
          .select("role")
          .in("user_id", userIds)
          .eq("role", "admin")
          .limit(1);
        
        if (rolesErr) throw new Error(rolesErr.message);
        if (!roles || roles.length === 0) {
          throw new Error("Final Root Admin Approval is mandatory before an ADR can be approved.");
        }
      }
    }

    if (isDatabaseLocal) {
      await pgQuery("UPDATE adrs SET status = $1 WHERE id = $2", [
        data.status,
        data.id,
      ]);
      return { ok: true };
    }

    const { error } = await supabase
      .from("adrs")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── approveAdr ───────────────────────────────────────────────────────────────

export const approveAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        adr_id: z.string().uuid(),
        decision: z.enum(["approve", "request_changes"]),
        note: z.string().optional(),
      })
      .parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      await pgQuery(
        `INSERT INTO approvals (adr_id, user_id, decision, note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (adr_id, user_id) DO UPDATE
           SET decision = EXCLUDED.decision, note = EXCLUDED.note`,
        [data.adr_id, userId, data.decision, data.note ?? null]
      );
      return { ok: true };
    }

    const { error } = await supabase.from("approvals").upsert(
      {
        adr_id: data.adr_id,
        user_id: userId,
        decision: data.decision,
        note: data.note ?? null,
      },
      { onConflict: "adr_id,user_id" }
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── addComment ───────────────────────────────────────────────────────────────

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        adr_id: z.string().uuid(),
        body: z.string().min(1).max(4000),
      })
      .parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      await pgQuery(
        "INSERT INTO comments (adr_id, user_id, body) VALUES ($1, $2, $3)",
        [data.adr_id, userId, data.body]
      );
      return { ok: true };
    }

    const { error } = await supabase
      .from("comments")
      .insert({ adr_id: data.adr_id, user_id: userId, body: data.body });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── dashboardStats ───────────────────────────────────────────────────────────

export const dashboardStats = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .handler(async ({ context: rawCtx }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const { userId } = context;
      const isAdminRow = await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [userId]);
      const isAdmin = !!isAdminRow;

      let adrsRow, projectsRow;

      if (isAdmin) {
        [adrsRow, projectsRow] = await Promise.all([
          pgQuery(
            `SELECT a.id, a.status, a.full_id, a.title, a.updated_at, a.project_id,
                    p.name AS proj_name, p.code AS proj_code
             FROM adrs a JOIN projects p ON p.id = a.project_id
             ORDER BY a.updated_at DESC LIMIT 20`
          ),
          pgQuery("SELECT id, name, code FROM projects"),
        ]);
      } else {
        [adrsRow, projectsRow] = await Promise.all([
          pgQuery(
            `SELECT a.id, a.status, a.full_id, a.title, a.updated_at, a.project_id,
                    p.name AS proj_name, p.code AS proj_code
             FROM adrs a 
             JOIN projects p ON p.id = a.project_id
             JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
             ORDER BY a.updated_at DESC LIMIT 20`,
             [userId]
          ),
          pgQuery(
            `SELECT p.id, p.name, p.code FROM projects p
             JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1`,
             [userId]
          ),
        ]);
      }

      const adrs = (adrsRow.rows ?? []).map((a: any) => ({
        ...a,
        projects: { name: a.proj_name, code: a.proj_code },
      }));
      const counts = { total: 0, draft: 0, under_review: 0, approved: 0, published: 0, superseded: 0 };
      adrs.forEach((a: any) => {
        counts.total++;
        if (a.status in counts) counts[a.status as keyof typeof counts]++;
      });
      return { recent: adrs, counts, projectsCount: (projectsRow.rows ?? []).length };
    }

    const { data: adrs } = await supabase
      .from("adrs")
      .select("id, status, full_id, title, updated_at, project_id, projects(name, code)")
      .order("updated_at", { ascending: false })
      .limit(20);
    const counts = { total: 0, draft: 0, under_review: 0, approved: 0, published: 0, superseded: 0 };
    (adrs ?? []).forEach((a: any) => {
      counts.total++;
      counts[a.status as keyof typeof counts]++;
    });
    const { data: projects } = await supabase.from("projects").select("id, name, code");
    return { recent: adrs ?? [], counts, projectsCount: (projects ?? []).length };
  });

// ─── updateUser (admin: edit role / name) ─────────────────────────────────────

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      full_name: z.string().min(1).max(200).optional(),
      role: z.enum(["admin", "member"]).optional(),
    }).parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const isAdmin = !!(await pgOne(
        "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
        [userId]
      ));
      if (!isAdmin) throw new Error("Only platform admins can edit users.");

      if (data.full_name) {
        await pgQuery("UPDATE profiles SET full_name = $1 WHERE id = $2", [data.full_name, data.user_id]);
        await pgQuery("UPDATE local_users SET full_name = $1 WHERE id = $2", [data.full_name, data.user_id]);
      }
      if (data.role) {
        // Replace all platform roles for this user
        await pgQuery("DELETE FROM user_roles WHERE user_id = $1 AND role IN ('admin','member')", [data.user_id]);
        await pgQuery("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [data.user_id, data.role]);
        await pgQuery("UPDATE local_users SET role = $1 WHERE id = $2", [data.role, data.user_id]);
      }
      return { ok: true };
    }

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw new Error("Only platform admins can edit users.");
    }
    if (data.full_name) {
      await supabase.from("profiles").update({ full_name: data.full_name }).eq("id", data.user_id);
    }
    if (data.role) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id).in("role", ["admin", "member"]);
      await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    }
    return { ok: true };
  });

// ─── updateProfile (self: edit own name / avatar_url) ────────────────────────

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({
      full_name: z.string().min(1).max(200),
      avatar_url: z.string().url().optional().or(z.literal("")),
    }).parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      await pgQuery(
        "UPDATE profiles SET full_name = $1, avatar_url = $2 WHERE id = $3",
        [data.full_name, data.avatar_url || null, userId]
      );
      await pgQuery(
        "UPDATE local_users SET full_name = $1 WHERE id = $2",
        [data.full_name, userId]
      );
      return { ok: true };
    }

    const { error } = await supabase
      .from("profiles")
      .update({ full_name: data.full_name, avatar_url: data.avatar_url || null })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── changePassword (local mode only) ────────────────────────────────────────

export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({
      current_password: z.string().min(1),
      new_password: z.string().min(8),
    }).parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId, isDatabaseLocal } = context;

    if (!isDatabaseLocal) {
      throw new Error("Use Supabase account settings to change your password.");
    }

    const user = await pgOne<{ password_hash: string; email: string }>(
      "SELECT password_hash, email FROM local_users WHERE id = $1",
      [userId]
    );
    if (!user) throw new Error("User not found");

    const { loginLocal } = await import("@/integrations/database/local-auth.server");
    // Verify current password by attempting login
    try {
      await loginLocal(user.email, data.current_password);
    } catch {
      throw new Error("Current password is incorrect");
    }

    // Hash new password
    const { createLocalUser: _ , ...authHelpers } = await import("@/integrations/database/local-auth.server");
    // Re-import to get hashPassword (we'll do it via a workaround)
    const { pbkdf2, randomBytes } = await import("crypto");
    const salt = randomBytes(16).toString("hex");
    const newHash = await new Promise<string>((resolve, reject) => {
      pbkdf2(data.new_password, salt, 100_000, 64, "sha256", (err, key) => {
        if (err) return reject(err);
        resolve(`${salt}:${key.toString("hex")}`);
      });
    });

    await pgQuery("UPDATE local_users SET password_hash = $1 WHERE id = $2", [newHash, userId]);
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({
      target_user_id: z.string().uuid(),
      new_password: z.string().min(8),
    }).parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId, isDatabaseLocal, supabase } = context;

    if (!isDatabaseLocal) {
      throw new Error("Use Supabase admin panel to manage passwords.");
    }

    const isAdmin = !!(await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [userId]));
    if (!isAdmin) throw new Error("Unauthorized");

    // Hash new password
    const { pbkdf2, randomBytes } = await import("crypto");
    const salt = randomBytes(16).toString("hex");
    const newHash = await new Promise<string>((resolve, reject) => {
      pbkdf2(data.new_password, salt, 100_000, 64, "sha256", (err, key) => {
        if (err) return reject(err);
        resolve(`${salt}:${key.toString("hex")}`);
      });
    });

    await pgQuery("UPDATE local_users SET password_hash = $1 WHERE id = $2", [newHash, data.target_user_id]);
    return { ok: true };
  });

// ─── updateAdr ────────────────────────────────────────────────────────────────

const adrFieldsSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(3).max(200).optional(),
  tags: z.array(z.string()).optional(),
  context: z.string().optional(),
  decision: z.string().optional(),
  consequences: z.string().optional(),
  alternatives: z.string().optional(),
  design_changes: z.any().optional(),
  major_impacts: z.any().optional(),
  references_data: z.any().optional(),
});

export const updateAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => adrFieldsSchema.parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      // Check project_member or admin
      const adr = await pgOne<any>("SELECT status, project_id FROM adrs WHERE id = $1", [data.id]);
      if (!adr) throw new Error("ADR not found");
      const isAdmin = !!(await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role='admin'", [userId]));
      const isProjectMember = !!(await pgOne("SELECT 1 FROM project_members WHERE user_id=$1 AND project_id=$2", [userId, adr.project_id]));
      if (!isAdmin && !isProjectMember) throw new Error("Not authorized to edit this ADR");

      const fields: string[] = [];
      const vals: any[] = [];
      let p = 1;
      const set = (col: string, val: any, cast = "") => {
        if (val !== undefined) { 
          fields.push(`${col} = $${p++}${cast}`); 
          if (cast === "::jsonb") {
            vals.push(JSON.stringify(val));
          } else {
            vals.push(val);
          }
        }
      };
      set("title", data.title);
      set("tags", data.tags, "::text[]");
      set("context", data.context);
      set("decision", data.decision);
      set("consequences", data.consequences);
      set("alternatives", data.alternatives);
      set("design_changes", data.design_changes, "::jsonb");
      set("major_impacts", data.major_impacts, "::jsonb");
      set("references_data", data.references_data, "::jsonb");
      
      if (adr.status === "published" || adr.status === "superseded") {
        fields.push(`status = $${p++}`);
        vals.push("draft");
      }

      if (!fields.length) return { ok: true };
      vals.push(data.id);
      await pgQuery(`UPDATE adrs SET ${fields.join(", ")} WHERE id = $${p}`, vals);
      return { ok: true };
    }

    const updates: any = {};
    if (data.title !== undefined) updates.title = data.title;
    if (data.tags !== undefined) updates.tags = data.tags;
    if (data.context !== undefined) updates.context = data.context;
    if (data.decision !== undefined) updates.decision = data.decision;
    if (data.consequences !== undefined) updates.consequences = data.consequences;
    if (data.alternatives !== undefined) updates.alternatives = data.alternatives;
    if (data.design_changes !== undefined) updates.design_changes = data.design_changes;
    if (data.major_impacts !== undefined) updates.major_impacts = data.major_impacts;
    if (data.references_data !== undefined) updates.references_data = data.references_data;

    const { data: adrInfo, error: fetchErr } = await supabase.from("adrs").select("status").eq("id", data.id).single();
    if (fetchErr) throw new Error(fetchErr.message);
    if (adrInfo.status === "published" || adrInfo.status === "superseded") {
      updates.status = "draft";
    }

    const { error } = await supabase.from("adrs").update(updates).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── searchAdrs ───────────────────────────────────────────────────────────────

export const searchAdrs = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({
      q: z.string().min(1).max(300),
      status: z.string().optional(),
      project_id: z.string().uuid().optional(),
    }).parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;
    const like = `%${data.q.toLowerCase()}%`;

    if (isDatabaseLocal) {
      const isAdminRow = await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [userId]);
      const isAdmin = !!isAdminRow;

      let sql = `
        SELECT a.id, a.full_id, a.title, a.status, a.tags, a.updated_at, a.project_id,
               p.name AS proj_name, p.code AS proj_code
        FROM adrs a
        JOIN projects p ON p.id = a.project_id
      `;
      const params: any[] = [];
      let p = 1;
      
      if (!isAdmin) {
        sql += ` JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $${p++}`;
        params.push(userId);
      }
      
      const likeParamIndex = p++;
      params.push(like);
      sql += ` WHERE (
          lower(a.title) LIKE $${likeParamIndex}
          OR lower(a.context) LIKE $${likeParamIndex}
          OR lower(a.decision) LIKE $${likeParamIndex}
          OR lower(a.consequences) LIKE $${likeParamIndex}
          OR lower(a.full_id) LIKE $${likeParamIndex}
          OR EXISTS (SELECT 1 FROM unnest(a.tags) t WHERE lower(t) LIKE $${likeParamIndex})
        )`;
      
      if (data.status) { sql += ` AND a.status = $${p++}`; params.push(data.status); }
      if (data.project_id) { sql += ` AND a.project_id = $${p++}`; params.push(data.project_id); }
      sql += " ORDER BY a.updated_at DESC LIMIT 50";
      const result = await pgQuery(sql, params);
      return (result.rows ?? []).map((a: any) => ({ ...a, projects: { name: a.proj_name, code: a.proj_code } }));
    }

    let query = supabase
      .from("adrs")
      .select("id, full_id, title, status, tags, updated_at, project_id, projects(name,code)")
      .or(`title.ilike.${like},context.ilike.${like},decision.ilike.${like},full_id.ilike.${like}`)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (data.status) query = query.eq("status", data.status);
    if (data.project_id) query = query.eq("project_id", data.project_id);
    const { data: results } = await query;
    return results ?? [];
  });

// ─── getAdrRelationships ──────────────────────────────────────────────────────

export const getAdrRelationships = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ adr_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const result = await pgQuery(
        `SELECT r.*, sa.full_id AS source_full_id, sa.title AS source_title,
                ta.full_id AS target_full_id, ta.title AS target_title,
                ta.status AS target_status
         FROM adr_relationships r
         JOIN adrs sa ON sa.id = r.source_adr_id
         JOIN adrs ta ON ta.id = r.target_adr_id
         WHERE r.source_adr_id = $1 OR r.target_adr_id = $1`,
        [data.adr_id]
      );
      return result.rows ?? [];
    }

    const { data: rels } = await supabase
      .from("adr_relationships")
      .select("*, source:adrs!source_adr_id(full_id,title), target:adrs!target_adr_id(full_id,title,status)")
      .or(`source_adr_id.eq.${data.adr_id},target_adr_id.eq.${data.adr_id}`);
    return rels ?? [];
  });

// ─── addAdrRelationship ───────────────────────────────────────────────────────

export const addAdrRelationship = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({
      source_adr_id: z.string().uuid(),
      target_adr_id: z.string().uuid(),
      rel_type: z.enum(["depends_on", "related_to", "supersedes", "superseded_by", "conflicts_with", "affects"]),
    }).parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      await pgQuery(
        `INSERT INTO adr_relationships (source_adr_id, target_adr_id, rel_type, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_adr_id, target_adr_id, rel_type) DO NOTHING`,
        [data.source_adr_id, data.target_adr_id, data.rel_type, userId]
      );
      return { ok: true };
    }

    const { error } = await supabase.from("adr_relationships").upsert(
      { source_adr_id: data.source_adr_id, target_adr_id: data.target_adr_id, rel_type: data.rel_type, created_by: userId },
      { onConflict: "source_adr_id,target_adr_id,rel_type" }
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── removeAdrRelationship ────────────────────────────────────────────────────

export const removeAdrRelationship = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      await pgQuery("DELETE FROM adr_relationships WHERE id = $1", [data.id]);
      return { ok: true };
    }
    const { error } = await supabase.from("adr_relationships").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── publishAdr ───────────────────────────────────────────────────────────────

export const publishAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({ adr_id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, userId, isDatabaseLocal } = context;

    // Fetch the ADR
    let adr: any;
    if (isDatabaseLocal) {
      adr = await pgOne<any>(
        `SELECT a.*, p.code AS proj_code, p.name AS proj_name, p.repo_url, p.branch, p.adr_path, p.git_pat
         FROM adrs a JOIN projects p ON p.id = a.project_id WHERE a.id = $1`,
        [data.adr_id]
      );
    } else {
      const { data: d2 } = await supabase
        .from("adrs")
        .select("*, projects(code,name,repo_url,branch,adr_path,git_pat)")
        .eq("id", data.adr_id)
        .single();
      adr = d2 ? { ...d2, proj_code: d2.projects?.code, proj_name: d2.projects?.name, repo_url: d2.projects?.repo_url, branch: d2.projects?.branch, adr_path: d2.projects?.adr_path, git_pat: d2.projects?.git_pat } : null;
    }
    if (!adr) throw new Error("ADR not found");

    // Generate Markdown
    const { generateAdrMarkdown } = await import("@/lib/adr-markdown");
    const markdown = generateAdrMarkdown(adr);

    // Attempt Git push (non-blocking if no repo configured)
    let gitCommitHash: string | undefined;
    if (adr.repo_url) {
      try {
        const { pushAdrToGit } = await import("@/lib/api/git.server");
        gitCommitHash = await pushAdrToGit({ adr, markdown, publisherUserId: userId });
      } catch (err: any) {
        console.warn("Git push failed:", err);
        throw new Error(`Git push failed: ${err.message}`);
      }
    }

    // Get next version number
    let nextVersion = 1;
    if (isDatabaseLocal) {
      const vRow = await pgOne<{ max: number }>(
        "SELECT COALESCE(MAX(version_number), 0) + 1 AS max FROM published_versions WHERE adr_id = $1",
        [data.adr_id]
      );
      nextVersion = vRow?.max ?? 1;
    } else {
      const { data: vRows } = await supabase
        .from("published_versions")
        .select("version_number")
        .eq("adr_id", data.adr_id)
        .order("version_number", { ascending: false })
        .limit(1);
      nextVersion = ((vRows?.[0]?.version_number) ?? 0) + 1;
    }

    // Insert published version + update ADR status
    if (isDatabaseLocal) {
      await pgQuery(
        `INSERT INTO published_versions (adr_id, version_number, markdown, git_commit_hash, published_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [data.adr_id, nextVersion, markdown, gitCommitHash ?? null, userId]
      );
      await pgQuery("UPDATE adrs SET status = 'published', current_version = $1 WHERE id = $2", [nextVersion, data.adr_id]);
    } else {
      await supabase.from("published_versions").insert({
        adr_id: data.adr_id, version_number: nextVersion, markdown,
        git_commit_hash: gitCommitHash ?? null, published_by: userId,
      });
      await supabase.from("adrs").update({ status: "published", current_version: nextVersion }).eq("id", data.adr_id);
    }

    return { version: nextVersion, gitCommitHash, markdown };
  });

// ─── findSimilarAdrs ──────────────────────────────────────────────────────────

export const findSimilarAdrs = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({
      project_id: z.string().uuid(),
      title: z.string(),
      context: z.string(),
    }).parse(d)
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    // Extract keywords (longer than 4 chars)
    const text = `${data.title} ${data.context}`.toLowerCase();
    const words = Array.from(new Set(text.split(/\W+/).filter(w => w.length > 4))).slice(0, 5);
    console.log("findSimilarAdrs text:", text.slice(0, 50));
    console.log("findSimilarAdrs words:", words);
    
    if (words.length === 0) return [];

    if (isDatabaseLocal) {
      const isAdminRow = await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [userId]);
      const isAdmin = !!isAdminRow;

      const params: any[] = [];
      let sql = `
        SELECT a.id, a.full_id, a.title
        FROM adrs a
        JOIN projects p ON p.id = a.project_id
      `;

      if (!isAdmin) {
        params.push(userId);
        sql += ` JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1 `;
      }

      const offset = params.length;
      words.forEach(w => params.push(`%${w}%`));

      const conditions = words.map((_, i) => `(lower(a.title) LIKE $${offset + i + 1} OR lower(a.context) LIKE $${offset + i + 1})`);
      sql += ` WHERE (${conditions.join(" OR ")}) LIMIT 20`;

      const result = await pgQuery(sql, params);
      
      const scored = (result.rows ?? []).map(r => {
        const str = `${r.title} ${r.context}`.toLowerCase();
        let score = 0;
        words.forEach(w => { if (str.includes(w)) score++; });
        return { ...r, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 5).map(r => ({ id: r.id, full_id: r.full_id, title: r.title }));
    }

    // Supabase
    const orCondition = words.map(w => `title.ilike.%${w}%,context.ilike.%${w}%`).join(",");
    const { data: results, error } = await supabase
      .from("adrs")
      .select("id, full_id, title, context")
      .or(orCondition)
      .limit(20);
      
    if (error) throw new Error(error.message);
    
    const scored = (results ?? []).map(r => {
      const str = `${r.title} ${r.context}`.toLowerCase();
      let score = 0;
      words.forEach(w => { if (str.includes(w)) score++; });
      return { ...r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(r => ({ id: r.id, full_id: r.full_id, title: r.title }));
  });

// ─── getProjectForGraph ───────────────────────────────────────────────────────

export const getProjectForGraph = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { supabase, isDatabaseLocal } = context;

    if (isDatabaseLocal) {
      const [adrsRow, relsRow] = await Promise.all([
        pgQuery(
          `SELECT DISTINCT a.id, a.full_id, a.title, a.status 
           FROM adrs a 
           WHERE a.project_id = $1 
              OR a.id IN (SELECT source_adr_id FROM adr_relationships r JOIN adrs ta ON ta.id = r.target_adr_id WHERE ta.project_id = $1)
              OR a.id IN (SELECT target_adr_id FROM adr_relationships r JOIN adrs sa ON sa.id = r.source_adr_id WHERE sa.project_id = $1)`, 
          [data.project_id]
        ),
        pgQuery(
          `SELECT r.id, r.source_adr_id, r.target_adr_id, r.rel_type
           FROM adr_relationships r
           WHERE r.source_adr_id IN (SELECT id FROM adrs WHERE project_id = $1)
              OR r.target_adr_id IN (SELECT id FROM adrs WHERE project_id = $1)`,
          [data.project_id]
        ),
      ]);
      return { adrs: adrsRow.rows ?? [], relationships: relsRow.rows ?? [] };
    }

    const { data: adrsInProject } = await supabase.from("adrs").select("id").eq("project_id", data.project_id);
    const projectAdrIds = adrsInProject?.map((a: any) => a.id) ?? [];
    if (projectAdrIds.length === 0) return { adrs: [], relationships: [] };

    const { data: rels } = await supabase.from("adr_relationships").select("id, source_adr_id, target_adr_id, rel_type")
      .or(`source_adr_id.in.(${projectAdrIds.join(',')}),target_adr_id.in.(${projectAdrIds.join(',')})`);
      
    const allAdrIds = new Set(projectAdrIds);
    rels?.forEach((r: any) => { allAdrIds.add(r.source_adr_id); allAdrIds.add(r.target_adr_id); });

    const { data: adrs } = await supabase.from("adrs").select("id, full_id, title, status").in("id", Array.from(allAdrIds));

    return { adrs: adrs ?? [], relationships: rels ?? [] };
  });
