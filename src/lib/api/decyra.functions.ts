import { createServerFn } from "@tanstack/react-start";
import { requireAuth, requireFlexibleAuth } from "@/integrations/database/auth-middleware";
import type { AuthContext, FlexibleAuthContext } from "@/integrations/database/auth-middleware";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { parseAdrMarkdown, extractAdrIdentifier, inspectAdrIdentifier } from "@/lib/adr-markdown";
import { getDatabaseConfig } from "@/integrations/database/config";
import * as Y from "yjs";

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

function assertDraftAdrOwner(adr: { status: string; author_id: string }, userId: string) {
  if (adr.status === "draft" && adr.author_id !== userId) {
    throw new Error("ADR not found.");
  }
}

async function assertDraftAdrVisible(context: AuthContext, adrId: string) {
  const adr = await pgOne<{ status: string; author_id: string }>(
    "SELECT status, author_id FROM adrs WHERE id = $1",
    [adrId],
  );

  if (!adr) throw new Error("ADR not found.");
  assertDraftAdrOwner(adr, context.userId);
}

type AdrCollaborationAccess = {
  author_id: string;
  project_id: string;
  status: string;
};

async function assertAdrCollaborationAccess(
  context: AuthContext,
  adrId: string,
): Promise<AdrCollaborationAccess> {
  const adr = await pgOne<AdrCollaborationAccess>(
    "SELECT author_id, project_id, status FROM adrs WHERE id = $1",
    [adrId],
  );

  if (!adr) throw new Error("ADR not found.");
  assertDraftAdrOwner(adr, context.userId);

  const [admin, membership] = await Promise.all([
    pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [context.userId]),
    pgOne("SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2", [
      context.userId,
      adr.project_id,
    ]),
  ]);
  if (!admin && !membership) {
    throw new Error("Unauthorized: You do not have access to this ADR's project.");
  }
  return adr;
}

function makeAdrCollaborationSignal(key: string, value: string): string {
  const doc = new Y.Doc();
  doc.getMap("metadata").set(key, value);
  const encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  doc.destroy();
  return encoded;
}

async function publishAdrCollaborationSignal(
  context: AuthContext,
  adrId: string,
  key: string,
  value: string,
) {
  const room = await pgOne("SELECT adr_id FROM adr_collaboration_rooms WHERE adr_id = $1", [adrId]);
  if (!room) return;
  await pgQuery(
    "INSERT INTO adr_collaboration_updates (adr_id, update_data, created_by) VALUES ($1, $2, $3)",
    [adrId, makeAdrCollaborationSignal(key, value), context.userId],
  );
}

function assertRequiredAdrContent(adr: {
  title: string;
  context: string;
  decision: string;
  consequences: string;
}) {
  const missing = ["title", "context", "decision", "consequences"].filter(
    (field) => !adr[field as keyof typeof adr]?.trim(),
  );
  if (missing.length) {
    throw new Error(`Required ADR fields are missing: ${missing.join(", ")}`);
  }
}

async function assertProjectManager(context: AuthContext, projectId: string) {
  const { userId } = context;
  const [admin, projectAdmin] = await Promise.all([
    pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [userId]),
    pgOne(
      "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'project_admin'",
      [projectId, userId],
    ),
  ]);
  if (!admin && !projectAdmin) {
    throw new Error("Only admins or project admins can manage project data.");
  }
}

async function getGitHubSyncProject(context: AuthContext, projectId: string) {
  return pgOne<{ id: string; repo_url: string | null }>(
    "SELECT id, repo_url FROM projects WHERE id = $1",
    [projectId],
  );
}

function validateGitHubRepositoryUrl(repoUrl: string | null) {
  let repo: URL;
  try {
    repo = new URL(repoUrl ?? "");
  } catch {
    throw new Error("Configure an HTTPS GitHub repository URL before enabling sync.");
  }
  if (
    repo.protocol !== "https:" ||
    repo.hostname.toLowerCase() !== "github.com" ||
    repo.username ||
    repo.password ||
    repo.port ||
    repo.search ||
    repo.hash ||
    repo.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean).length !== 2
  ) {
    throw new Error("Configure an HTTPS GitHub repository URL before enabling sync.");
  }
}

async function saveGitHubSyncConfiguration(
  context: AuthContext,
  projectId: string,
  secret: string | null,
) {
  if (secret) {
    await pgQuery(
      `INSERT INTO github_sync_secrets (project_id, secret)
       VALUES ($1, $2)
       ON CONFLICT (project_id) DO UPDATE SET secret = EXCLUDED.secret, created_at = now()`,
      [projectId, secret],
    );
  }
  await pgQuery(
    "UPDATE projects SET github_sync_enabled = $1, github_sync_last_commit = NULL WHERE id = $2",
    [Boolean(secret), projectId],
  );
  if (!secret) await pgQuery("DELETE FROM github_sync_secrets WHERE project_id = $1", [projectId]);
}

export const configureGitHubSync = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((data: unknown) =>
    z.object({ project_id: z.string().uuid(), enabled: z.boolean() }).parse(data),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    await assertProjectManager(context, data.project_id);

    const project = await getGitHubSyncProject(context, data.project_id);
    if (!project) throw new Error("Project not found.");

    if (data.enabled) validateGitHubRepositoryUrl(project.repo_url);

    const secret = data.enabled ? randomBytes(32).toString("hex") : null;
    await saveGitHubSyncConfiguration(context, project.id, secret);
    return { enabled: data.enabled, webhook_secret: secret };
  });

// ─── getMyContext ─────────────────────────────────────────────────────────────

export const getMyContext = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .handler(async ({ context: rawCtx }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const [profileRow, rolesRow, membershipsRow] = await Promise.all([
      pgOne("SELECT * FROM profiles WHERE id = $1", [userId]),
      pgQuery("SELECT role FROM user_roles WHERE user_id = $1", [userId]),
      pgQuery(
        `SELECT pm.role, pm.project_id,
                p.id AS proj_id, p.name AS proj_name, p.code AS proj_code, p.description AS proj_desc
         FROM project_members pm
         JOIN projects p ON p.id = pm.project_id
         WHERE pm.user_id = $1`,
        [userId],
      ),
    ]);
    const isAdmin = (rolesRow.rows ?? []).some((r: any) => r.role === "admin");
    const memberships = (membershipsRow.rows ?? []).map((m: any) => ({
      role: m.role,
      project_id: m.project_id,
      projects: { id: m.proj_id, name: m.proj_name, code: m.proj_code, description: m.proj_desc },
    }));
    return { userId, profile: profileRow, isAdmin, memberships };
  });

// ─── listProjects ─────────────────────────────────────────────────────────────

export const listProjects = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .handler(async ({ context: rawCtx }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const isAdminRow = await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    );
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
        [userId],
      );
      return result.rows;
    }
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
          .regex(
            /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
            "Use uppercase letters, digits, and single hyphens between segments",
          ),
        description: z.string().optional(),
        repo_url: z.string().optional(),
        branch: z.string().optional(),
        adr_path: z.string().optional(), // empty string = repo root
        git_pat: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const roleRow = await pgOne<{ role: string }>(
      "SELECT role FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
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
        data.adr_path ?? "", // empty string allowed (= repo root)
        data.git_pat || null,
        userId,
      ],
    );
    if (!project) throw new Error("Failed to create project");
    delete project.git_pat;

    await pgQuery(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'project_admin')`,
      [project.id, userId],
    );
    return project;
  });

// ─── updateProject (NEW — fixes Issue 4) ─────────────────────────────────────

export interface UpdateProjectInput {
  id: string;
  name: string;
  description?: string;
  repo_url?: string;
  branch?: string;
  adr_path?: string;
  git_pat?: string | null;
  required_approvals?: number;
}

export async function updateProjectService(userId: string, data: UpdateProjectInput) {
  const gitToken = data.git_pat?.trim();
  if (!gitToken) {
    throw new Error("Editing project info requires the git token is mandatory.");
  }

  const isAdmin = !!(await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [
    userId,
  ]));
  const isProjectAdmin = !!(await pgOne(
    "SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2 AND role = 'project_admin'",
    [userId, data.id],
  ));
  if (!isAdmin && !isProjectAdmin) {
    throw new Error("Only admins or project admins can edit projects.");
  }

  const existing = await pgOne<any>("SELECT * FROM projects WHERE id = $1", [data.id]);
  if (!existing) {
    throw new Error("Project not found");
  }

  const newRepoUrl = data.repo_url?.trim() || null;
  const newBranch = data.branch?.trim() || "main";
  const newAdrPath = data.adr_path?.trim() || "docs/adr";

  const oldRepoUrl = existing.repo_url?.trim() || null;
  const oldBranch = existing.branch?.trim() || "main";
  const oldAdrPath = existing.adr_path?.trim() || "docs/adr";

  const gitConfigChanged =
    Boolean(newRepoUrl) &&
    (newRepoUrl !== oldRepoUrl || newBranch !== oldBranch || newAdrPath !== oldAdrPath);

  if (gitConfigChanged) {
    const publishedAdrs = await pgQuery<any>(
      `SELECT a.*, p.code AS proj_code,
         (SELECT pv.markdown FROM published_versions pv WHERE pv.adr_id = a.id ORDER BY pv.version_number DESC LIMIT 1) AS latest_markdown
       FROM adrs a
       JOIN projects p ON p.id = a.project_id
       WHERE a.project_id = $1 AND (a.status = 'published' OR (a.current_version > 0 AND a.status IN ('published', 'rejected', 'superseded'))) AND a.repository_deleted_at IS NULL
       ORDER BY a.full_id ASC`,
      [data.id],
    );

    const { generateAdrMarkdown } = await import("@/lib/adr-markdown");
    const { migrateProjectAdrsToGit } = await import("@/lib/api/git.server");

    const adrsToMigrate = (publishedAdrs?.rows ?? []).map((a: any) => ({
      id: a.id,
      full_id: a.full_id,
      title: a.title,
      repository_path: a.repository_path,
      old_repository_path: a.repository_path,
      markdown: a.latest_markdown || generateAdrMarkdown(a),
    }));

    const migrationResult = await migrateProjectAdrsToGit({
      project: {
        id: existing.id,
        code: existing.code,
        name: data.name || existing.name,
        repo_url: newRepoUrl!,
        branch: newBranch,
        adr_path: newAdrPath,
        old_adr_path: oldAdrPath,
        git_pat: gitToken,
      },
      adrs: adrsToMigrate,
    });

    for (const item of migrationResult.adrPaths) {
      await pgQuery(
        "UPDATE adrs SET repository_path = $1, repository_deleted_at = NULL WHERE id = $2",
        [item.repositoryPath, item.id],
      );
    }
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
      newRepoUrl,
      newBranch,
      newAdrPath,
      gitToken,
      data.required_approvals ?? null,
      data.id,
    ],
  );
  if (!updated) throw new Error("Project not found");
  delete updated.git_pat;
  return updated;
}

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
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return updateProjectService(context.userId, data);
  });

// ─── getProject ───────────────────────────────────────────────────────────────

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const project = await pgOne<any>("SELECT * FROM projects WHERE id = $1", [data.id]);
    if (!project) throw new Error("Project not found");
    delete project.git_pat;

    const [membersRow, adrsRow, myMembershipRow, rolesRow, deletionApprovalsRow] =
      await Promise.all([
        pgQuery(
          `SELECT pm.id, pm.role, pm.user_id,
                  pr.full_name, pr.email, pr.avatar_url
           FROM project_members pm
           LEFT JOIN profiles pr ON pr.id = pm.user_id
           WHERE pm.project_id = $1`,
          [data.id],
        ),
        pgQuery(
          `SELECT id, full_id, title, status, tags, updated_at, author_id, repository_deleted_at, current_version
           FROM adrs WHERE project_id = $1
             AND (status <> 'draft' OR author_id = $2)
           ORDER BY adr_number DESC`,
          [data.id, userId],
        ),
        pgOne<{ role: string }>(
          "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
          [data.id, userId],
        ),
        pgQuery("SELECT role FROM user_roles WHERE user_id = $1", [userId]),
        pgQuery(
          `SELECT pda.id, pda.user_id, pda.created_at, pr.full_name, pr.email, pr.avatar_url
           FROM project_deletion_approvals pda
           LEFT JOIN profiles pr ON pr.id = pda.user_id
           WHERE pda.project_id = $1
           ORDER BY pda.created_at ASC`,
          [data.id],
        ),
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

    const deletionApprovals = (deletionApprovalsRow.rows ?? []).map((a: any) => ({
      id: a.id,
      user_id: a.user_id,
      created_at: a.created_at,
      full_name: a.full_name,
      email: a.email,
      avatar_url: a.avatar_url,
    }));
    const deletionApprovalCount = deletionApprovals.length;
    const hasUserApprovedDeletion = deletionApprovals.some((a: any) => a.user_id === userId);
    const canDeleteProject =
      deletionApprovalCount >= 3 && (isAdmin || myMembershipRow?.role === "project_admin");

    return {
      project,
      members,
      adrs: adrsRow.rows ?? [],
      myRole: myMembershipRow?.role ?? null,
      isAdmin,
      deletionApprovals,
      deletionApprovalCount,
      hasUserApprovedDeletion,
      canDeleteProject,
    };
  });

// ─── migrateAdrsFromRepository ─────────────────────────────────────────────────

interface MigrationProjectRow {
  id: string;
  name: string;
  code: string;
  repo_url: string | null;
  branch: string | null;
  adr_path: string | null;
  git_pat: string | null;
  adr_sequence: number;
}

export async function migrateAdrsFromRepositoryService(
  userId: string,
  data: {
    project_id: string;
    repo_url?: string;
    branch?: string;
    adr_path?: string;
    update_existing?: boolean;
  },
) {
  const project = await pgOne<MigrationProjectRow>("SELECT * FROM projects WHERE id = $1", [
    data.project_id,
  ]);
  const projectRow = project;
  if (!projectRow) throw new Error("Project not found.");

  const isAdmin = !!(await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [
    userId,
  ]));
  const isProjectAdmin = !!(await pgOne(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'project_admin'",
    [data.project_id, userId],
  ));
  if (!isAdmin && !isProjectAdmin)
    throw new Error("Only admins or project admins can import ADRs.");

  const repoUrl = (data.repo_url ?? projectRow.repo_url ?? "").trim();
  const branch = (data.branch ?? projectRow.branch ?? "main").trim() || "main";
  const adrPath =
    data.adr_path !== undefined ? data.adr_path.trim() : (projectRow.adr_path ?? "docs/adr").trim();
  const gitPat = projectRow.git_pat ?? null;
  if (!repoUrl) throw new Error("This project does not have a repository URL configured.");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/")
  ) {
    throw new Error("Enter a valid Git branch name.");
  }

  const { cloneAndReadRepositoryAdrs } = await import("@/lib/api/git.server");
  const { files: markdownFiles, skippedFiles } = await cloneAndReadRepositoryAdrs({
    repoUrl,
    gitPat,
    branch,
    adrPath,
  });

  const imported: string[] = [];
  const updated: string[] = [];
  const skippedDetails: Array<{ file: string; reason: string }> = [];

  for (const f of skippedFiles) {
    skippedDetails.push({ file: f, reason: "Non-markdown file or unsupported format" });
  }

  const seenIdsInBatch = new Set<string>();

  for (const item of markdownFiles) {
    // Validate [Project code-ADR-XXX] format
    const inspectResult = inspectAdrIdentifier(item.fileName, item.markdown, projectRow.code);
    if (!inspectResult.success) {
      skippedDetails.push({ file: item.fileName, reason: inspectResult.reason });
      continue;
    }
    const adrIdInfo = inspectResult.data;

    if (seenIdsInBatch.has(adrIdInfo.fullId.toUpperCase())) {
      skippedDetails.push({
        file: item.fileName,
        reason: `Duplicate ADR identifier (${adrIdInfo.fullId}) already processed in this import`,
      });
      continue;
    }

    const parsed = parseAdrMarkdown(item.markdown);
    const title = (adrIdInfo.cleanTitle || parsed.title || adrIdInfo.fullId).trim();
    if (
      !title ||
      !parsed.context?.trim() ||
      !parsed.decision?.trim() ||
      !parsed.consequences?.trim()
    ) {
      skippedDetails.push({
        file: item.fileName,
        reason: "Missing required ADR sections (Context, Decision, Consequences)",
      });
      continue;
    }

    const normalizedTitle = title.replace(/\s+/g, " ").trim();
    const existing = await pgOne<{ id: string; status: string }>(
      "SELECT id, status FROM adrs WHERE project_id = $1 AND lower(full_id) = lower($2) LIMIT 1",
      [data.project_id, adrIdInfo.fullId],
    );

    if (existing) {
      if (data.update_existing) {
        await pgOne(
          `UPDATE adrs
           SET title = $1, tags = $2::text[], context = $3, decision = $4,
               consequences = $5, alternatives = $6, design_changes = $7::jsonb,
               major_impacts = $8::jsonb, references_data = $9::jsonb, updated_at = NOW()
           WHERE id = $10`,
          [
            normalizedTitle,
            parsed.tags ?? [],
            parsed.context,
            parsed.decision,
            parsed.consequences,
            parsed.alternatives ?? "",
            JSON.stringify(parsed.design_changes ?? {}),
            JSON.stringify(parsed.major_impacts ?? {}),
            JSON.stringify(parsed.references_data ?? {}),
            existing.id,
          ],
        );
        updated.push(item.fileName);
        seenIdsInBatch.add(adrIdInfo.fullId.toUpperCase());
        continue;
      } else {
        skippedDetails.push({
          file: item.fileName,
          reason: `ADR ${adrIdInfo.fullId} already exists in this project`,
        });
        continue;
      }
    }

    const rawStatus = parsed.status?.toLowerCase();
    const status = ["draft", "under_review", "approved", "published", "superseded", "rejected"].includes(rawStatus ?? "")
      ? rawStatus
      : "published";

    const payload = {
      project_id: data.project_id,
      title: normalizedTitle,
      tags: parsed.tags ?? [],
      context: parsed.context,
      decision: parsed.decision,
      consequences: parsed.consequences,
      alternatives: parsed.alternatives ?? "",
      design_changes: parsed.design_changes ?? {
        api_changes: "",
        workflow_changes: "",
        service_changes: "",
        infrastructure_changes: "",
        data_model_changes: "",
      },
      major_impacts: parsed.major_impacts ?? {
        operational: "",
        testing: "",
        security: "",
        documentation: "",
        scalability: "",
      },
      references_data: parsed.references_data ?? {
        pull_requests: [],
        git_commits: [],
        design_docs: [],
        wiki_pages: [],
        external: [],
      },
      author_id: userId,
      adr_number: adrIdInfo.adrNumber,
      full_id: adrIdInfo.fullId,
      status,
    };

    const insert = await pgOne<{ id: string }>(
      `INSERT INTO adrs
       (project_id, title, tags, context, decision, consequences, alternatives,
        design_changes, major_impacts, references_data, author_id, adr_number, full_id, status)
       VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
       RETURNING *`,
      [
        payload.project_id,
        payload.title,
        payload.tags,
        payload.context,
        payload.decision,
        payload.consequences,
        payload.alternatives,
        JSON.stringify(payload.design_changes),
        JSON.stringify(payload.major_impacts),
        JSON.stringify(payload.references_data),
        payload.author_id,
        payload.adr_number,
        payload.full_id,
        payload.status,
      ],
    );

    if (insert) {
      imported.push(item.fileName);
      seenIdsInBatch.add(adrIdInfo.fullId.toUpperCase());
      await pgOne("UPDATE projects SET adr_sequence = GREATEST(adr_sequence, $1) WHERE id = $2", [
        adrIdInfo.adrNumber,
        data.project_id,
      ]);
    }
  }

  return {
    imported: imported.length,
    updated: updated.length,
    skipped: skippedDetails.length,
    files: imported,
    updatedFiles: updated,
    skippedFiles: skippedDetails.map((s) => s.file),
    skippedDetails,
  };
}

export const migrateAdrsFromRepository = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        repo_url: z.string().trim().max(2_048).optional(),
        branch: z.string().trim().max(255).optional(),
        adr_path: z.string().trim().max(1_024).optional(),
        update_existing: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return migrateAdrsFromRepositoryService(context.userId, data);
  });

const projectArchiveAdrSchema = z.object({
  source_full_id: z.string().max(100).optional(),
  title: z.string().trim().min(3).max(200),
  tags: z.array(z.string().max(200)).max(100).default([]),
  context: z.string().min(1).max(100_000),
  decision: z.string().min(1).max(100_000),
  consequences: z.string().min(1).max(100_000),
  alternatives: z.string().max(100_000).default(""),
  design_changes: z
    .object({
      api_changes: z.string().max(100_000).default(""),
      workflow_changes: z.string().max(100_000).default(""),
      service_changes: z.string().max(100_000).default(""),
      infrastructure_changes: z.string().max(100_000).default(""),
      data_model_changes: z.string().max(100_000).default(""),
    })
    .default({}),
  major_impacts: z
    .object({
      operational: z.string().max(100_000).default(""),
      testing: z.string().max(100_000).default(""),
      security: z.string().max(100_000).default(""),
      documentation: z.string().max(100_000).default(""),
      scalability: z.string().max(100_000).default(""),
    })
    .default({}),
  references_data: z
    .object({
      pull_requests: z.array(z.string().max(2_000)).max(100).default([]),
      git_commits: z.array(z.string().max(2_000)).max(100).default([]),
      design_docs: z.array(z.string().max(2_000)).max(100).default([]),
      wiki_pages: z.array(z.string().max(2_000)).max(100).default([]),
      external: z.array(z.string().max(2_000)).max(100).default([]),
    })
    .default({
      pull_requests: [],
      git_commits: [],
      design_docs: [],
      wiki_pages: [],
      external: [],
    }),
});

const projectArchiveSchema = z.object({
  format: z.literal("decyra-project-archive"),
  version: z.literal(1),
  project_code: z.string().max(32),
  exported_at: z.string().datetime(),
  adrs: z.array(projectArchiveAdrSchema).max(1_000),
  relationships: z
    .array(
      z.object({
        source_full_id: z.string().max(100),
        target_full_id: z.string().max(100),
        rel_type: z.enum([
          "depends_on",
          "related_to",
          "supersedes",
          "superseded_by",
          "conflicts_with",
          "affects",
        ]),
      }),
    )
    .max(2_000),
});

// ─── Project data export and import ──────────────────────────────────────────

export const exportProjectArchive = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;
    await assertProjectManager(context, data.project_id);

    const project = await pgOne<{ code: string }>("SELECT code FROM projects WHERE id = $1", [
      data.project_id,
    ]);
    if (!project) throw new Error("Project not found.");

    const adrs = (
      await pgQuery<any>(
        `SELECT id, full_id, title, tags, context, decision, consequences, alternatives,
                design_changes, major_impacts, references_data
         FROM adrs
         WHERE project_id = $1 AND (status <> 'draft' OR author_id = $2)
         ORDER BY adr_number`,
        [data.project_id, userId],
      )
    ).rows;

    const adrIds = adrs.map((adr: any) => adr.id);
    let relationships: any[] = [];
    if (adrIds.length) {
      const result = await pgQuery<any>(
        `SELECT r.source_adr_id, r.target_adr_id, r.rel_type
         FROM adr_relationships r
         WHERE r.source_adr_id = ANY($1::uuid[])
           AND r.target_adr_id = ANY($1::uuid[])`,
        [adrIds],
      );
      relationships = result.rows ?? [];
    }
    const fullIdByAdrId = new Map(adrs.map((adr: any) => [adr.id, adr.full_id]));

    const archive = {
      format: "decyra-project-archive" as const,
      version: 1 as const,
      project_code: project.code,
      exported_at: new Date().toISOString(),
      adrs: adrs.map((adr: any) => ({
        source_full_id: adr.full_id,
        title: adr.title,
        tags: adr.tags ?? [],
        context: adr.context ?? "",
        decision: adr.decision ?? "",
        consequences: adr.consequences ?? "",
        alternatives: adr.alternatives ?? "",
        design_changes: adr.design_changes ?? {},
        major_impacts: adr.major_impacts ?? {},
        references_data: adr.references_data ?? {},
      })),
      relationships: relationships.flatMap((relationship: any) => {
        const sourceFullId = fullIdByAdrId.get(relationship.source_adr_id);
        const targetFullId = fullIdByAdrId.get(relationship.target_adr_id);
        return sourceFullId && targetFullId
          ? [
              {
                source_full_id: sourceFullId,
                target_full_id: targetFullId,
                rel_type: relationship.rel_type,
              },
            ]
          : [];
      }),
    };
    if (archive.adrs.length > 1_000 || JSON.stringify(archive).length > 10_000_000) {
      throw new Error("This project is too large for a single archive export.");
    }
    return archive;
  });

export const importProjectArchive = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({ project_id: z.string().uuid(), archive: z.unknown() }).parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;
    await assertProjectManager(context, data.project_id);

    let archiveJson: string | undefined;
    try {
      archiveJson = JSON.stringify(data.archive);
    } catch {
      throw new Error("The project archive is not valid JSON data.");
    }
    if (!archiveJson || archiveJson.length > 10_000_000) {
      throw new Error("The project archive exceeds the 10 MB import limit.");
    }
    const archive = projectArchiveSchema.parse(data.archive);

    const existingAdrs = (
      await pgQuery<any>(
        `SELECT id, full_id, title FROM adrs
         WHERE project_id = $1 AND (status <> 'draft' OR author_id = $2)`,
        [data.project_id, userId],
      )
    ).rows;
    const existingByTitle = new Map(
      existingAdrs.map((adr: any) => [adr.title.trim().toLowerCase(), adr]),
    );
    const idBySourceFullId = new Map<string, string>();
    let imported = 0;
    let skipped = 0;

    for (const adr of archive.adrs) {
      const existing = existingByTitle.get(adr.title.trim().toLowerCase());
      if (existing) {
        skipped++;
        if (adr.source_full_id) idBySourceFullId.set(adr.source_full_id, existing.id);
        continue;
      }

      const values = {
        project_id: data.project_id,
        title: adr.title,
        tags: adr.tags,
        context: adr.context,
        decision: adr.decision,
        consequences: adr.consequences,
        alternatives: adr.alternatives,
        design_changes: adr.design_changes,
        major_impacts: adr.major_impacts,
        references_data: adr.references_data,
        author_id: userId,
      };
      const inserted = await pgOne<{ id: string; full_id: string }>(
        `INSERT INTO adrs
         (project_id, title, tags, context, decision, consequences, alternatives,
          design_changes, major_impacts, references_data, author_id)
         VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)
         RETURNING id, full_id`,
        [
          values.project_id,
          values.title,
          values.tags,
          values.context,
          values.decision,
          values.consequences,
          values.alternatives,
          JSON.stringify(values.design_changes),
          JSON.stringify(values.major_impacts),
          JSON.stringify(values.references_data),
          values.author_id,
        ],
      );
      if (!inserted) throw new Error(`Could not import ADR "${adr.title}".`);

      imported++;
      existingByTitle.set(adr.title.trim().toLowerCase(), inserted);
      if (adr.source_full_id) idBySourceFullId.set(adr.source_full_id, inserted.id);
    }

    let relationshipsImported = 0;
    for (const relationship of archive.relationships) {
      const sourceAdrId = idBySourceFullId.get(relationship.source_full_id);
      const targetAdrId = idBySourceFullId.get(relationship.target_full_id);
      if (!sourceAdrId || !targetAdrId || sourceAdrId === targetAdrId) continue;

      const inserted = await pgQuery<{ id: string }>(
        `INSERT INTO adr_relationships (source_adr_id, target_adr_id, rel_type, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_adr_id, target_adr_id, rel_type) DO NOTHING`,
        [sourceAdrId, targetAdrId, relationship.rel_type, userId],
      );
      relationshipsImported += inserted.rows.length;
    }

    return {
      imported,
      skipped,
      relationshipsImported,
      sourceProjectCode: archive.project_code,
    };
  });

// ─── listProfiles ─────────────────────────────────────────────────────────────

export const listProfiles = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .handler(async () => {
    const result = await pgQuery<{
      id: string;
      email: string;
      username: string | null;
      full_name: string;
      is_locked: boolean;
      role: "admin" | "member";
    }>(`
      SELECT p.id, p.email, p.username, p.full_name, p.is_locked,
             COALESCE((SELECT ur.role FROM user_roles ur WHERE ur.user_id = p.id AND ur.role = 'admin' LIMIT 1), 'member') as role
      FROM profiles p
      ORDER BY p.full_name
    `);
    return result.rows;
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
        username: z
          .string()
          .trim()
          .min(3)
          .max(30)
          .regex(/^[a-zA-Z0-9._-]+$/)
          .transform((value) => value.toLowerCase())
          .optional(),
        role: z.enum(["admin", "member"]).default("member"),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const isAdmin = !!(await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    ));
    if (!isAdmin) throw new Error("Only platform admins can create users.");

    const { createLocalUser } = await import("@/integrations/database/local-auth.server");
    return createLocalUser(data.email, data.password, data.full_name, data.role, data.username);
  });

// ─── loginLocal (NEW — local auth endpoint) ───────────────────────────────────

export const loginLocalFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ identifier: z.string().min(1), password: z.string() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { loginLocal } = await import("@/integrations/database/local-auth.server");
    return loginLocal(data.identifier, data.password);
  });

// ─── lookupEmailByUsernameFn ──────────────────────────────────────────────────

export const lookupEmailByUsernameFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ username: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const cleanUsername = data.username.trim().replace(/^@/, "").toLowerCase();
    const profile = await pgOne<{ email: string }>(
      `SELECT COALESCE(p.email, lu.email) AS email 
       FROM profiles p
       FULL OUTER JOIN local_users lu ON lu.id = p.id
       WHERE LOWER(COALESCE(p.username, '')) = $1 
          OR LOWER(COALESCE(lu.username, '')) = $1
       LIMIT 1`,
      [cleanUsername],
    );

    if (!profile || !profile.email) {
      throw new Error("Username not found");
    }
    return { email: profile.email };
  });

// ─── checkIsFirstRun / signUpLocal ───────────────────────────────────────────

export const checkIsFirstRunFn = createServerFn({ method: "POST" }).handler(async () => {
  const result = await pgOne<{ count: string }>(
    "SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin'",
  );
  return parseInt(result?.count || "0", 10) === 0;
});

export const signUpLocalFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        fullName: z.string().min(1),
        username: z.string().min(3).max(30).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const result = await pgOne<{ count: string }>(
      "SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin'",
    );
    const isFirstRun = parseInt(result?.count || "0", 10) === 0;

    if (!isFirstRun) {
      throw new Error("Security Error: An admin already exists. Public signups are disabled.");
    }

    const { signUpLocal } = await import("@/integrations/database/local-auth.server");
    // Explicitly grant admin role to the first user
    return signUpLocal(data.email, data.password, data.fullName, "admin", data.username);
  });

// ─── generateRecoveryKeyFn ─────────────────────────────────────────────────────

export const generateRecoveryKeyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ identifier: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const dbConfig = getDatabaseConfig();
    if (!dbConfig.isLocal) {
      throw new Error("Recovery key generation is only available in local PostgreSQL mode.");
    }
    const { queryOne } = await import("@/integrations/database/postgres");
    const cleanId = data.identifier.trim().replace(/^@/, "").toLowerCase();
    const user = await queryOne<{ id: string; email: string }>(
      `SELECT u.id, u.email 
       FROM public.local_users u
       LEFT JOIN public.profiles p ON u.id = p.id
       WHERE LOWER(u.email) = $1 
          OR LOWER(COALESCE(u.username, '')) = $1 
          OR LOWER(COALESCE(p.username, '')) = $1`,
      [cleanId],
    );
    if (!user) {
      throw new Error("No user found with the provided email or username.");
    }

    const { generateAndSaveRecoveryKey } =
      await import("@/integrations/database/local-auth.server");
    await generateAndSaveRecoveryKey(user.id, user.email);

    const sanitizedEmail = user.email.replace(/[^a-zA-Z0-9._-]/g, "_");
    return {
      success: true,
      email: user.email,
      filePath: `recovery-keys/${sanitizedEmail}.recovery.key`,
    };
  });

// ─── resetPasswordWithRecoveryKeyFn ────────────────────────────────────────────

export const resetPasswordWithRecoveryKeyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        identifier: z.string().min(1),
        recoveryKey: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const dbConfig = getDatabaseConfig();
    if (!dbConfig.isLocal) {
      throw new Error("Recovery key reset is only available in local PostgreSQL mode.");
    }
    const { resetPasswordWithRecoveryKey } =
      await import("@/integrations/database/local-auth.server");
    return resetPasswordWithRecoveryKey(data.identifier, data.recoveryKey, data.newPassword);
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
      .parse(d),
  )
  .handler(async ({ data }) => {
    await pgQuery(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [data.project_id, data.user_id, data.role],
    );
    return { ok: true };
  });

// ─── removeProjectMember ──────────────────────────────────────────────────────

export const removeProjectMember = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await pgQuery("DELETE FROM project_members WHERE id = $1", [data.id]);
    return { ok: true };
  });

// ─── deleteProject & deletion approvals ──────────────────────────────────────

export async function approveProjectDeletionService(userId: string, projectId: string) {
  const isAdmin = !!(await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [
    userId,
  ]));
  const member = await pgOne<{ role: string }>(
    "SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2",
    [userId, projectId],
  );
  if (!isAdmin && !member) {
    throw new Error("Only project members or platform admins can approve project deletion.");
  }
  if (member && member.role === "intern") {
    throw new Error("Interns cannot approve project deletion.");
  }

  await pgQuery(
    `INSERT INTO project_deletion_approvals (project_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (project_id, user_id) DO NOTHING`,
    [projectId, userId],
  );

  const countRow = await pgOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM project_deletion_approvals WHERE project_id = $1",
    [projectId],
  );
  const count = Number(countRow?.count ?? 0);
  return { ok: true, count, hasApproved: true };
}

export async function revokeProjectDeletionApprovalService(userId: string, projectId: string) {
  await pgQuery("DELETE FROM project_deletion_approvals WHERE project_id = $1 AND user_id = $2", [
    projectId,
    userId,
  ]);

  const countRow = await pgOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM project_deletion_approvals WHERE project_id = $1",
    [projectId],
  );
  const count = Number(countRow?.count ?? 0);
  return { ok: true, count, hasApproved: false };
}

export async function deleteProjectService(userId: string, projectId: string) {
  const isAdmin = !!(await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [
    userId,
  ]));
  const isProjectAdmin = !!(await pgOne(
    "SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2 AND role = 'project_admin'",
    [userId, projectId],
  ));
  if (!isAdmin && !isProjectAdmin) {
    throw new Error("Only platform admins or project admins can delete projects.");
  }

  const countRow = await pgOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM project_deletion_approvals WHERE project_id = $1",
    [projectId],
  );
  const count = Number(countRow?.count ?? 0);
  if (count < 3) {
    throw new Error(
      `Deleting a project requires at least 3 approvals. Current approvals: ${count}/3. Please gather the required approvals before deleting.`,
    );
  }

  await pgQuery("DELETE FROM projects WHERE id = $1", [projectId]);
  return { ok: true };
}

export const approveProjectDeletion = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return approveProjectDeletionService(context.userId, data.project_id);
  });

export const revokeProjectDeletionApproval = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return revokeProjectDeletionApprovalService(context.userId, data.project_id);
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return deleteProjectService(context.userId, data.id);
  });

// ─── deleteUser ───────────────────────────────────────────────────────────────

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ target_user_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    if (data.target_user_id === userId) throw new Error("You cannot delete your own account.");

    const isAdmin = !!(await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    ));
    if (!isAdmin) throw new Error("Only platform admins can delete users.");

    // Explicitly delete local_users since it lacks an ON DELETE CASCADE FK to auth.users
    await pgQuery("DELETE FROM local_users WHERE id = $1", [data.target_user_id]);
    // Deleting from auth.users cascades to profiles, user_roles, project_members, etc.
    await pgQuery("DELETE FROM auth.users WHERE id = $1", [data.target_user_id]);

    return { ok: true };
  });

// ─── toggleUserLock ───────────────────────────────────────────────────────────

export const toggleUserLock = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({ target_user_id: z.string().uuid(), lock: z.boolean() }).parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    if (data.target_user_id === userId) throw new Error("You cannot lock your own account.");

    const isAdmin = !!(await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    ));
    if (!isAdmin) throw new Error("Only platform admins can lock users.");

    await pgQuery("UPDATE profiles SET is_locked = $1 WHERE id = $2", [
      data.lock,
      data.target_user_id,
    ]);
    return { ok: true };
  });

// ─── generateDemoAdrFn (NEW — Onboarding) ───────────────────────────────────

export const generateDemoAdrFn = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const demoAdr = {
      project_id: data.project_id,
      adr_number: 0,
      full_id: "PENDING",
      title: "Adopt Decyra as the Standard Architecture Decision Record Manager",
      status: "approved",
      author_id: userId,
      tags: [
        "architecture",
        "adr",
        "decyra",
        "documentation",
        "developer-tools",
        "governance",
        "automation",
      ],

      context:
        "As our engineering organization grows, architectural decisions become increasingly difficult to track, maintain, and discover across repositories and development teams. These decisions influence system architecture, technology selection, service boundaries, infrastructure, security, scalability, and long-term maintainability.\n\nCurrently, Architecture Decision Records (ADRs) are maintained primarily as Markdown files within individual repositories. Although this approach follows the documentation-as-code philosophy, it lacks a consistent mechanism for enforcing document structure, validating metadata, maintaining sequential numbering, and discovering decisions across projects.\n\nInconsistent templates, missing metadata, duplicate ADR numbers, and limited cross-repository discoverability make it difficult for developers to understand why a particular architectural choice was made. New team members may repeat previously rejected approaches, while reviewers must manually verify whether architectural decisions follow established documentation conventions.\n\nWe need a lightweight, developer-friendly solution that standardizes ADR creation and validation without introducing unnecessary infrastructure or separating architectural documentation from the software development lifecycle. The solution should integrate with existing Git workflows and CI/CD pipelines while allowing teams to retain ownership of their architectural decisions.\n\nDecyra has been identified as a potential solution for managing ADR workflows through structured documentation, validation, and developer tooling. Adopting Decyra will provide a consistent foundation for documenting, reviewing, and maintaining architectural decisions across engineering projects.",

      decision:
        "We will adopt Decyra as the standard Architecture Decision Record (ADR) management tool for our engineering projects. Decyra will complement our existing Git-based documentation practices rather than replace them with a separate documentation platform.\n\nADRs will remain version-controlled alongside their associated codebases, preserving their history, review process, and relationship with architectural changes. Decyra will provide the tooling needed to standardize and validate ADR documents and support more consistent management of architectural knowledge.\n\nThe adoption will follow these principles:\n\n1. Standardized ADR Structure: Use a consistent ADR template covering context, decision, consequences, alternatives, and relevant technical impacts.\n2. Automated Validation: Validate ADR formatting, required metadata, numbering, and other configured conventions before changes are accepted.\n3. Developer Workflow Integration: Integrate ADR validation into pull requests and existing CI/CD pipelines.\n4. Version-Controlled Documentation: Store ADRs in the repository so that architectural decisions evolve alongside the code.\n5. Discoverability: Maintain a consistent organization of ADRs to make decisions easier to locate, review, and reference.\n6. Incremental Adoption: Introduce Decyra into selected repositories first, evaluate its effectiveness, and then expand adoption across the engineering organization.\n\nThe initial implementation will focus on ADR creation, structural validation, numbering conventions, and CI integration. Cross-repository indexing, advanced reporting, and additional automation may be introduced in subsequent iterations based on actual requirements.",

      consequences:
        "### Positive\n\n- **Standardization:** Teams follow a common ADR structure and consistent metadata conventions, improving the quality and readability of architectural documentation.\n- **Improved Discoverability:** Developers can locate existing decisions more easily and understand the rationale behind architectural choices.\n- **Automated Quality Checks:** Validation catches missing fields, malformed documents, and numbering inconsistencies before they become persistent documentation problems.\n- **Better Code Review:** Reviewers can focus on the technical merits of architectural decisions rather than manually checking basic formatting conventions.\n- **Documentation as Code:** ADRs remain version-controlled and can be reviewed alongside the code changes or design proposals they describe.\n- **Reduced Duplication:** Teams can consult existing decisions before introducing new technologies, patterns, or architectural approaches.\n- **Improved Onboarding:** New developers gain access to documented architectural context and the reasoning behind existing system designs.\n- **Maintainability:** A standardized process makes it easier to update, supersede, and preserve the history of architectural decisions.\n\n### Negative / Trade-offs\n\n- **Learning Curve:** Developers must learn the Decyra workflow, supported commands, document conventions, and validation requirements.\n- **Initial Integration Effort:** Existing repositories may require ADR restructuring, metadata corrections, and CI/CD configuration changes.\n- **Tooling Dependency:** The organization will depend on Decyra's continued compatibility with its development workflows and repository structure.\n- **Validation Overhead:** Strict validation rules may initially cause pull request failures until existing documents and authoring practices are aligned with the standard.\n- **Maintenance Responsibility:** The engineering team must review tool updates, maintain integration configurations, and resolve compatibility issues.\n- **Adoption Consistency:** The benefits depend on teams actually documenting significant architectural decisions rather than treating ADR creation as an optional administrative task.\n\n### Neutral Consequences\n\n- **Workflow Changes:** ADR creation and validation become explicit parts of the development process for changes that require architectural documentation.\n- **Repository Organization:** Teams may need to establish or standardize an ADR directory and naming conventions.\n- **Governance:** Engineering leadership must define which decisions require an ADR and who is responsible for reviewing and approving them.",

      alternatives:
        "### 1. Continue Using Ad-Hoc Markdown Files\n\n**Description:** Continue creating and maintaining ADRs manually within individual repositories.\n\n**Advantages:** No additional tooling or installation requirements; maximum flexibility; familiar workflow for developers.\n\n**Disadvantages:** Formatting and metadata can become inconsistent, numbering errors require manual correction, and cross-repository discovery remains difficult. Manual checks also become increasingly expensive as the number of repositories grows.\n\n**Reason for Rejection:** This approach does not sufficiently address the need for standardized ADR governance and automated validation.\n\n### 2. Develop a Custom Internal ADR Management Tool\n\n**Description:** Build and maintain an organization-specific tool for creating, validating, indexing, and managing ADRs.\n\n**Advantages:** Complete control over features, integration points, user experience, and organizational policies.\n\n**Disadvantages:** Requires ongoing engineering effort for development, testing, maintenance, documentation, and compatibility with evolving repository workflows. It also creates an additional internal system that must be supported.\n\n**Reason for Rejection:** Building a custom solution would introduce avoidable development and maintenance costs when an existing tool can serve as the starting point.\n\n### 3. Use an Enterprise Wiki or Confluence\n\n**Description:** Store architectural decisions in a centralized documentation platform.\n\n**Advantages:** Provides collaborative editing, search, access management, and centralized documentation.\n\n**Disadvantages:** Architectural decisions can become disconnected from source code, pull requests, and repository history. Teams may also need to maintain separate copies of related documentation.\n\n**Reason for Rejection:** A separate documentation platform does not align as closely with our preference for version-controlled, documentation-as-code workflows.\n\n### 4. Use Generic Markdown Linting and Custom CI Scripts\n\n**Description:** Combine Markdown linters, repository scripts, and CI checks to enforce selected ADR conventions.\n\n**Advantages:** Uses familiar tooling, allows incremental adoption, and provides flexibility in implementing validation rules.\n\n**Disadvantages:** ADR-specific rules must be implemented and maintained separately. Numbering, metadata validation, and future workflow requirements may require additional custom logic.\n\n**Reason for Rejection:** Although technically feasible, this approach would require assembling and maintaining functionality that a dedicated ADR management tool is intended to provide.\n\n### 5. Adopt Decyra\n\n**Description:** Use Decyra to establish consistent ADR authoring and validation practices while retaining Git as the source of truth.\n\n**Advantages:** Aligns with documentation-as-code practices, provides a foundation for standardized validation, and can be integrated into existing development workflows.\n\n**Disadvantages:** Requires initial integration, developer onboarding, and continued maintenance of the tool and its configurations.\n\n**Reason for Selection:** Decyra provides a focused approach to ADR management without requiring the organization to build a complete internal solution or migrate architectural documentation to a separate platform.",

      design_changes: {
        api_changes:
          "No production application APIs need to change solely to adopt Decyra. The initial implementation will focus on its command-line interface and repository-level integration. Any future APIs introduced for centralized ADR indexing or external integrations will be evaluated separately.",

        workflow_changes:
          "Introduce an explicit ADR authoring and validation workflow. Developers will create or update ADRs using the standardized template, run local validation, and submit the changes through the existing pull request process. CI pipelines will validate relevant ADR changes before merging. Significant architectural changes should reference the associated ADR in the pull request where appropriate.",

        service_changes:
          "No existing production microservices need to be modified for the initial adoption. Developer tooling and repository automation will be updated to invoke Decyra. Any future integrations with project management systems, code review tools, or centralized documentation services will be introduced incrementally.",

        infrastructure_changes:
          "No additional production infrastructure is required for the initial CLI-based implementation. Decyra validation will run on developer machines and existing CI runners. If centralized indexing or a hosted service is introduced later, its deployment, availability, security, and maintenance requirements will be assessed separately.",

        data_model_changes:
          "Standardize the metadata associated with ADR documents, including identifiers, titles, status, dates, and other fields supported by the adopted template. Existing ADRs may need migration or metadata normalization. Git repositories remain the source of truth for ADR content and revision history.",

        security_changes:
          "Continue using existing repository permissions and CI access controls. Validation jobs should require only the repository access necessary to inspect and validate ADR files. Credentials must not be embedded in ADR content or committed to version control.",

        repository_changes:
          "Establish a consistent ADR directory structure and naming convention across participating repositories. Add the Decyra configuration and validation workflow where required, and document how teams should create, review, approve, and supersede ADRs.",

        governance_changes:
          "Define ownership of ADR templates, validation rules, and repository-level integration. Establish guidelines for which architectural decisions require records, how ADRs transition between proposed and accepted states, and how superseded decisions are linked to their replacements.",
      },

      major_impacts: {
        operational:
          "The engineering platform team will own the shared Decyra integration guidance and troubleshooting documentation. CI failures caused by invalid ADR documents will be reported through the existing pull request checks. A lightweight runbook will cover common validation failures, configuration issues, and tool-version incompatibilities.",

        testing:
          "Validate Decyra against representative ADR documents, including valid records, missing required metadata, malformed content, inconsistent numbering, and other supported validation scenarios. Test CI integration to confirm that invalid ADR changes are reported clearly and that unrelated code changes are not unnecessarily blocked. Existing ADRs should be checked before enforcement is enabled.",

        security:
          "The initial implementation processes documentation within developer environments and trusted CI runners. Existing Git access controls will govern who can modify ADRs. CI workflows should use pinned or otherwise controlled tool versions where practical, follow dependency-management policies, and avoid exposing repository credentials to unnecessary steps. Security-sensitive information must not be recorded in ADRs unless approved for that repository.",

        documentation:
          "Update the root CONTRIBUTING.md files, developer onboarding guides, and engineering documentation to explain the ADR workflow. Create a dedicated ADR process guide describing when to create an ADR, how to use the standard template, how to run Decyra validation, how to interpret validation errors, and how to supersede an existing decision.",

        scalability:
          "The repository-based approach scales across additional projects by reusing templates and CI workflow conventions. Validation remains a lightweight documentation-processing task. If the number of repositories or ADRs grows substantially, centralized indexing and cross-repository search can be evaluated as separate capabilities.",

        developer_experience:
          "Developers gain a consistent process for recording architectural decisions, while automated checks reduce the need for manual formatting reviews. Clear validation errors and onboarding guidance will be important to prevent the process from becoming an unnecessary obstacle to routine development.",

        maintainability:
          "The engineering platform team will periodically review Decyra versions, template conventions, and CI integrations. Changes to shared validation rules should be documented and tested before being propagated across repositories.",

        compliance:
          "Consistent ADR records improve the ability to review architectural rationale and trace decisions over time. Decyra does not, by itself, guarantee regulatory compliance or replace any organization-specific audit, approval, or retention requirements.",

        adoption:
          "Adoption will begin with a small number of representative repositories. Feedback from developers and reviewers will inform improvements to templates and validation rules before the workflow is extended more broadly.",
      },

      references_data: {
        pull_requests: [],
        git_commits: [],
        design_docs: [
          "[ADR 0001: Adoption of Decyra as Architecture Decision Record Manager](https://github.com/likhithkanigolla/decyra/)",
          "[Decyra Repository](https://github.com/likhithkanigolla/decyra/)",
        ],
        wiki_pages: [],
        external: [
          "[Documenting Architecture Decisions - Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)",
          "[GitHub Actions Documentation](https://docs.github.com/en/actions)",
          "[GitLab CI/CD Documentation](https://docs.gitlab.com/ee/ci/)",
        ],
      },
    };

    const inserted = await pgOne<{ id: string }>(
      `INSERT INTO public.adrs (
         project_id, adr_number, full_id, title, status, author_id, tags,
         context, decision, consequences, alternatives,
         design_changes, major_impacts, references_data
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb)
       RETURNING *`,
      [
        demoAdr.project_id,
        demoAdr.adr_number,
        demoAdr.full_id,
        demoAdr.title,
        demoAdr.status,
        demoAdr.author_id,
        demoAdr.tags,
        demoAdr.context,
        demoAdr.decision,
        demoAdr.consequences,
        demoAdr.alternatives,
        JSON.stringify(demoAdr.design_changes),
        JSON.stringify(demoAdr.major_impacts),
        JSON.stringify(demoAdr.references_data),
      ],
    );
    if (inserted?.id) {
      await recordAdrTimelineEvent({
        adr_id: inserted.id,
        user_id: userId,
        event_type: "created",
        summary: "Created this ADR",
        changes: { initial_status: demoAdr.status },
      });
    }
    return inserted;
  });

// ─── recordAdrTimelineEvent ───────────────────────────────────────────────────

export async function recordAdrTimelineEvent(params: {
  adr_id: string;
  user_id?: string | null;
  event_type: string;
  summary: string;
  changes?: Record<string, any> | null;
}) {
  try {
    await pgQuery(
      `INSERT INTO adr_timeline_events (adr_id, user_id, event_type, summary, changes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.adr_id,
        params.user_id ?? null,
        params.event_type,
        params.summary,
        params.changes ? JSON.stringify(params.changes) : null,
      ],
    );
  } catch (err) {
    console.error("Failed to record timeline event:", err);
  }
}

// ─── createAdr ────────────────────────────────────────────────────────────────

export const createAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        title: z.string().trim().min(3).max(200),
        tags: z.array(z.string()).default([]),
        context: z.string().trim().min(1),
        decision: z.string().trim().min(1),
        consequences: z.string().trim().min(1),
        alternatives: z.string().default(""),
        design_changes: z
          .object({
            api_changes: z.string().default(""),
            workflow_changes: z.string().default(""),
            service_changes: z.string().default(""),
            infrastructure_changes: z.string().default(""),
            data_model_changes: z.string().default(""),
          })
          .default({}),
        major_impacts: z
          .object({
            operational: z.string().default(""),
            testing: z.string().default(""),
            security: z.string().default(""),
            documentation: z.string().default(""),
            scalability: z.string().default(""),
          })
          .default({}),
        references_data: z
          .object({
            pull_requests: z.array(z.string()).default([]),
            git_commits: z.array(z.string()).default([]),
            design_docs: z.array(z.string()).default([]),
            wiki_pages: z.array(z.string()).default([]),
            external: z.array(z.string()).default([]),
          })
          .default({}),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    assertRequiredAdrContent(data);
    const context = ctx(rawCtx);
    const { userId } = context;

    const adr = await pgOne<any>(
      `INSERT INTO adrs
         (project_id, title, tags, context, decision, consequences, alternatives,
          design_changes, major_impacts, references_data, author_id)
       VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)
       RETURNING *`,
      [
        data.project_id,
        data.title,
        data.tags,
        data.context,
        data.decision,
        data.consequences,
        data.alternatives,
        JSON.stringify(data.design_changes),
        JSON.stringify(data.major_impacts),
        JSON.stringify(data.references_data),
        userId,
      ],
    );
    if (!adr) throw new Error("Failed to create ADR");
    await recordAdrTimelineEvent({
      adr_id: adr.id,
      user_id: userId,
      event_type: "created",
      summary: "Created this ADR",
      changes: { initial_status: "draft" },
    });
    return adr;
  });

// ─── getAdr ───────────────────────────────────────────────────────────────────

export const getAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const adr = await pgOne<any>(
      `SELECT a.*, p.id AS proj_id, p.name AS proj_name, p.code AS proj_code, p.required_approvals,
              ass.full_name AS assigned_to_name, ass.username AS assigned_to_username, ass.avatar_url AS assigned_to_avatar
       FROM adrs a
       JOIN projects p ON p.id = a.project_id
       LEFT JOIN profiles ass ON ass.id = a.assigned_to
       WHERE a.id = $1`,
      [data.id],
    );
    if (!adr) throw new Error("ADR not found");
    assertDraftAdrOwner(adr, userId);

    // Shape to match nested format
    const shaped = {
      ...adr,
      assigned_to_profile: adr.assigned_to
        ? {
            id: adr.assigned_to,
            full_name: adr.assigned_to_name,
            username: adr.assigned_to_username,
            avatar_url: adr.assigned_to_avatar,
          }
        : null,
      projects: {
        id: adr.proj_id,
        name: adr.proj_name,
        code: adr.proj_code,
        required_approvals: adr.required_approvals,
      },
    };

    const [approvalsRow, commentsRow, versionsRow, roleRow, adminRow, membersRow, timelineRow, projectAdrsRow] = await Promise.all([
      pgQuery(
        `SELECT ap.*, pr.full_name, pr.email, pr.username
         FROM approvals ap LEFT JOIN profiles pr ON pr.id = ap.user_id
         WHERE ap.adr_id = $1`,
        [data.id],
      ),
      pgQuery(
        `SELECT c.*, pr.full_name, pr.email, pr.username,
                res_pr.full_name AS resolved_by_name, res_pr.username AS resolved_by_username
         FROM comments c
         LEFT JOIN profiles pr ON pr.id = c.user_id
         LEFT JOIN profiles res_pr ON res_pr.id = c.resolved_by
         WHERE c.adr_id = $1 ORDER BY c.created_at`,
        [data.id],
      ),
      pgQuery(
        `SELECT pv.*, pr.full_name, pr.email, pr.username
         FROM published_versions pv LEFT JOIN profiles pr ON pr.id = pv.published_by
         WHERE pv.adr_id = $1 ORDER BY pv.version_number DESC`,
        [data.id],
      ),
      pgQuery("SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2", [
        userId,
        adr.proj_id,
      ]),
      pgQuery("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'", [userId]),
      pgQuery(
        `SELECT pm.user_id, pm.role, pr.full_name, pr.username, pr.email, pr.avatar_url
         FROM project_members pm
         JOIN profiles pr ON pr.id = pm.user_id
         WHERE pm.project_id = $1
         ORDER BY pr.full_name ASC`,
        [adr.proj_id],
      ),
      pgQuery(
        `SELECT te.*, pr.full_name, pr.email, pr.username, pr.avatar_url
         FROM adr_timeline_events te LEFT JOIN profiles pr ON pr.id = te.user_id
         WHERE te.adr_id = $1 ORDER BY te.created_at DESC`,
        [data.id],
      ),
      pgQuery<{ id: string; full_id: string; title: string; status: string }>(
        `SELECT a.id, a.full_id, a.title, a.status
         FROM adrs a WHERE a.project_id = $1 AND a.id != $2
         ORDER BY a.full_id ASC`,
        [adr.proj_id, data.id],
      ),
    ]);

    const shapeWithProfiles = (rows: any[]) =>
      rows.map((r) => ({
        ...r,
        profiles: { full_name: r.full_name, email: r.email, username: r.username },
        resolved_by_profile: r.resolved_by
          ? { full_name: r.resolved_by_name, username: r.resolved_by_username }
          : null,
      }));

    let timelineEvents = (timelineRow.rows ?? []).map((r: any) => ({
      ...r,
      profiles: { full_name: r.full_name, email: r.email, username: r.username, avatar_url: r.avatar_url },
    }));

    if (timelineEvents.length === 0) {
      const synthetic: any[] = [];
      for (const v of versionsRow.rows ?? []) {
        synthetic.push({
          id: `synth-pub-${v.id}`,
          adr_id: data.id,
          user_id: v.published_by,
          event_type: "published",
          summary: `Published version v${v.version_number}${v.git_commit_hash ? ` (${v.git_commit_hash.slice(0, 7)})` : ""}`,
          changes: { version: v.version_number },
          created_at: v.published_at,
          profiles: { full_name: v.full_name, username: v.username, email: v.email },
        });
      }
      for (const ap of approvalsRow.rows ?? []) {
        synthetic.push({
          id: `synth-app-${ap.id}`,
          adr_id: data.id,
          user_id: ap.user_id,
          event_type: ap.decision === "approve" ? "approved" : "changes_requested",
          summary: ap.decision === "approve" ? "Approved this ADR" : "Requested changes on this ADR",
          changes: { note: ap.note },
          created_at: ap.created_at,
          profiles: { full_name: ap.full_name, username: ap.username, email: ap.email },
        });
      }
      synthetic.push({
        id: `synth-create-${adr.id}`,
        adr_id: data.id,
        user_id: adr.author_id,
        event_type: "created",
        summary: "Created this ADR",
        changes: { initial_status: "draft" },
        created_at: adr.created_at,
        profiles: { full_name: adr.author_name, username: adr.author_username },
      });
      synthetic.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      timelineEvents = synthetic;
    }

    const isAdmin = (adminRow.rows?.length ?? 0) > 0;
    const myRole = roleRow.rows?.[0]?.role ?? null;

    if (!isAdmin && !myRole) {
      throw new Error("Unauthorized: You do not have access to this ADR's project.");
    }

    const hasUserApproved = (approvalsRow.rows ?? []).some(
      (a: any) => a.user_id === userId && a.decision === "approve",
    );
    const myApprovalRow = (approvalsRow.rows ?? []).find((a: any) => a.user_id === userId);
    const myApproval = myApprovalRow
      ? {
          ...myApprovalRow,
          profiles: { full_name: myApprovalRow.full_name, email: myApprovalRow.email },
        }
      : null;

    return {
      adr: shaped,
      approvals: shapeWithProfiles(approvalsRow.rows ?? []),
      comments: shapeWithProfiles(commentsRow.rows ?? []),
      publishedVersions: shapeWithProfiles(versionsRow.rows ?? []),
      projectMembers: membersRow.rows ?? [],
      timeline: timelineEvents,
      isAdmin,
      myRole,
      currentUserId: userId,
      hasUserApproved,
      myApproval,
      myReviewDecision: myApprovalRow?.decision ?? null,
      projectAdrs: projectAdrsRow.rows ?? [],
    };
  });

const encodedYjsUpdateSchema = z
  .string()
  .min(4)
  .max(2_000_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

function decodeYjsUpdate(encoded: string): Uint8Array {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== encoded) {
    throw new Error("Invalid collaboration update.");
  }
  Y.decodeUpdate(new Uint8Array(bytes));
  return new Uint8Array(bytes);
}

// ─── ADR collaboration ────────────────────────────────────────────────────────

export const joinAdrCollaboration = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({ adr_id: z.string().uuid(), initial_snapshot: encodedYjsUpdateSchema }).parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    await assertAdrCollaborationAccess(context, data.adr_id);
    decodeYjsUpdate(data.initial_snapshot);

    const inserted = await pgOne<{ snapshot: string }>(
      `INSERT INTO adr_collaboration_rooms (adr_id, snapshot, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (adr_id) DO NOTHING
       RETURNING snapshot`,
      [data.adr_id, data.initial_snapshot, context.userId],
    );
    const snapshot =
      inserted?.snapshot ??
      (
        await pgOne<{ snapshot: string }>(
          "SELECT snapshot FROM adr_collaboration_rooms WHERE adr_id = $1",
          [data.adr_id],
        )
      )?.snapshot ??
      null;

    if (!snapshot) throw new Error("Could not initialize ADR collaboration.");

    const updates = await pgQuery<{ id: number; update_data: string }>(
      `SELECT id, update_data FROM adr_collaboration_updates
       WHERE adr_id = $1 ORDER BY id ASC LIMIT 500`,
      [data.adr_id],
    ).then((result) => result.rows);

    return { snapshot, updates };
  });

export const getAdrCollaborationUpdates = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({ adr_id: z.string().uuid(), after_id: z.number().int().min(0) }).parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    await assertAdrCollaborationAccess(context, data.adr_id);

    const result = await pgQuery<{ id: number; update_data: string }>(
      `SELECT id, update_data FROM adr_collaboration_updates
       WHERE adr_id = $1 AND id > $2 ORDER BY id ASC LIMIT 500`,
      [data.adr_id, data.after_id],
    );
    return result.rows ?? [];
  });

export const appendAdrCollaborationUpdate = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z.object({ adr_id: z.string().uuid(), update_data: encodedYjsUpdateSchema }).parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    await assertAdrCollaborationAccess(context, data.adr_id);
    decodeYjsUpdate(data.update_data);

    const update = await pgOne<{ id: number }>(
      `INSERT INTO adr_collaboration_updates (adr_id, update_data, created_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [data.adr_id, data.update_data, context.userId],
    );
    if (!update) throw new Error("Could not save collaboration update.");
    return update;
  });

// ─── deleteAdr ────────────────────────────────────────────────────────────────

export const deleteAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    // Only allow deletion of draft ADRs
    const adr = await pgOne<{ status: string; project_id: string }>(
      "SELECT status, project_id FROM adrs WHERE id = $1",
      [data.id],
    );
    if (!adr) throw new Error("ADR not found.");
    if (adr.status !== "draft") throw new Error("Only draft ADRs can be deleted.");

    // Prevent deletion if any published versions exist — only a never-published draft can be removed
    const pvCount = await pgOne<{ count: string }>(
      "SELECT COUNT(*) FROM published_versions WHERE adr_id = $1",
      [data.id],
    );
    if (parseInt(pvCount?.count ?? "0", 10) > 0) {
      throw new Error(
        "This ADR has published versions and cannot be deleted. You can supersede it instead.",
      );
    }

    const isAdmin = !!(await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    ));
    const isProjectAdmin = !!(await pgOne(
      "SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2 AND role = 'project_admin'",
      [userId, adr.project_id],
    ));
    if (!isAdmin && !isProjectAdmin)
      throw new Error("Only admins or project admins can delete ADRs.");

    await pgQuery("DELETE FROM adrs WHERE id = $1", [data.id]);
    return { ok: true, project_id: adr.project_id };
  });

// ─── updateAdrStatus ──────────────────────────────────────────────────────────

export const updateAdrStatus = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["draft", "under_review", "approved", "published", "superseded", "rejected"]),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const adr = await pgOne<{ status: string; author_id: string }>(
      "SELECT status, author_id FROM adrs WHERE id = $1",
      [data.id],
    );
    if (!adr) throw new Error("ADR not found.");
    assertDraftAdrOwner(adr, userId);

    if (data.status === "approved") {
      const adminApproveRow = await pgOne(
        `SELECT 1 FROM approvals a
         JOIN user_roles ur ON ur.user_id = a.user_id
         WHERE a.adr_id = $1 AND a.decision = 'approve' AND ur.role = 'admin'`,
        [data.id],
      );
      if (!adminApproveRow) {
        throw new Error("Final Root Admin Approval is mandatory before an ADR can be approved.");
      }
    }

    await pgQuery("UPDATE adrs SET status = $1 WHERE id = $2", [data.status, data.id]);
    await recordAdrTimelineEvent({
      adr_id: data.id,
      user_id: userId,
      event_type: "status_changed",
      summary: `Moved status from ${adr.status.replace("_", " ")} to ${data.status.replace("_", " ")}`,
      changes: { previous_status: adr.status, new_status: data.status },
    });
    await publishAdrCollaborationSignal(context, data.id, "status", data.status);
    return { ok: true };
  });

// ─── approveAdr & revokeAdrApproval ──────────────────────────────────────────

export async function approveAdrService(
  userId: string,
  data: { adr_id: string; decision: "approve" | "request_changes"; note?: string },
) {
  const adr = await pgOne<{ status: string; author_id: string; project_id: string }>(
    "SELECT status, author_id, project_id FROM adrs WHERE id = $1",
    [data.adr_id],
  );
  if (!adr) throw new Error("ADR not found.");
  assertDraftAdrOwner(adr, userId);

  const isAdmin = !!(await pgOne(
    "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
    [userId],
  ));
  const member = await pgOne<{ role: string }>(
    "SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2",
    [userId, adr.project_id],
  );
  if (!isAdmin && !member) {
    throw new Error("Only project members or platform admins can review ADRs.");
  }
  if (member && member.role === "intern" && !isAdmin) {
    throw new Error("Interns cannot approve ADRs.");
  }

  await pgQuery(
    `INSERT INTO approvals (adr_id, user_id, decision, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (adr_id, user_id) DO UPDATE
       SET decision = EXCLUDED.decision, note = EXCLUDED.note`,
    [data.adr_id, userId, data.decision, data.note ?? null],
  );

  const isApprove = data.decision === "approve";
  await recordAdrTimelineEvent({
    adr_id: data.adr_id,
    user_id: userId,
    event_type: isApprove ? "approved" : "changes_requested",
    summary: isApprove ? "Approved this ADR" : "Requested changes on this ADR",
    changes: { decision: data.decision, note: data.note ?? null },
  });

  return { ok: true };
}

export async function revokeAdrApprovalService(userId: string, adrId: string) {
  const adr = await pgOne<{ status: string; author_id: string; project_id: string }>(
    "SELECT status, author_id, project_id FROM adrs WHERE id = $1",
    [adrId],
  );
  if (!adr) throw new Error("ADR not found.");
  assertDraftAdrOwner(adr, userId);

  const isAdmin = !!(await pgOne(
    "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
    [userId],
  ));
  const member = await pgOne<{ role: string }>(
    "SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2",
    [userId, adr.project_id],
  );
  if (!isAdmin && !member) {
    throw new Error("Only project members or platform admins can revoke approvals.");
  }
  if (adr.status === "published") {
    throw new Error("Cannot revoke approval for a published ADR.");
  }

  const existing = await pgOne<{ decision: string; note: string | null }>(
    "SELECT decision, note FROM approvals WHERE adr_id = $1 AND user_id = $2",
    [adrId, userId],
  );

  await pgQuery("DELETE FROM approvals WHERE adr_id = $1 AND user_id = $2", [adrId, userId]);

  let statusReverted = false;
  if (adr.status === "approved" && (!existing || existing.decision !== "request_changes")) {
    await pgQuery("UPDATE adrs SET status = 'under_review' WHERE id = $1", [adrId]);
    statusReverted = true;
  }

  const nowIso = new Date().toISOString();
  const timeFormatted = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const decisionWord = existing?.decision === "request_changes" ? "rejection / changes request" : "approval";
  const summary = statusReverted
    ? `Withdrew ${decisionWord} at ${timeFormatted} (status reverted to Under Review)`
    : `Withdrew ${decisionWord} at ${timeFormatted}`;

  await recordAdrTimelineEvent({
    adr_id: adrId,
    user_id: userId,
    event_type: "approval_revoked",
    summary,
    changes: {
      withdrawn_decision: existing?.decision ?? "review",
      status_reverted: statusReverted,
      withdrawn_at: nowIso,
    },
  });

  return { ok: true, statusReverted, withdrawnDecision: existing?.decision };
}

export async function submitFinalDecisionService(
  userId: string,
  data: {
    adr_id: string;
    decision: "approved" | "rejected";
    comment?: string;
  },
) {
  const adr = await pgOne<{ status: string; author_id: string; project_id: string; full_id: string; title: string; current_version: number }>(
    "SELECT status, author_id, project_id, full_id, title, current_version FROM adrs WHERE id = $1",
    [data.adr_id],
  );
  if (!adr) throw new Error("ADR not found.");
  assertDraftAdrOwner(adr, userId);

  if ((adr.current_version ?? 0) > 0 || adr.status === "published" || adr.status === "superseded") {
    throw new Error(
      "This ADR has already been finalized/published and cannot be overridden. Create a new ADR to supersede it."
    );
  }

  const isAdmin = !!(await pgOne(
    "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
    [userId],
  ));
  const member = await pgOne<{ role: string }>(
    "SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2",
    [userId, adr.project_id],
  );
  if (!isAdmin && member?.role !== "project_admin") {
    throw new Error("Only project admins or platform admins can make final approval or rejection decisions.");
  }

  // Update ADR status directly (irrespective of team votes)
  await pgQuery("UPDATE adrs SET status = $1 WHERE id = $2", [data.decision, data.adr_id]);

  // Record admin's decision in approvals table
  const approvalDecision = data.decision === "approved" ? "approve" : "request_changes";
  await pgQuery(
    `INSERT INTO approvals (adr_id, user_id, decision, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (adr_id, user_id) DO UPDATE
       SET decision = EXCLUDED.decision, note = EXCLUDED.note`,
    [data.adr_id, userId, approvalDecision, data.comment ?? null],
  );

  // If a comment was provided, post it as an official decision comment
  if (data.comment?.trim()) {
    const prefix = data.decision === "approved" ? "🏛️ [Admin Final Approval]" : "🏛️ [Admin Final Rejection]";
    await pgQuery(
      "INSERT INTO comments (adr_id, user_id, body) VALUES ($1, $2, $3)",
      [data.adr_id, userId, `${prefix} ${data.comment.trim()}`],
    );
  }

  // Record timeline event
  const isApproved = data.decision === "approved";
  const roleLabel = isAdmin ? "Platform Admin" : "Project Admin";
  await recordAdrTimelineEvent({
    adr_id: data.adr_id,
    user_id: userId,
    event_type: isApproved ? "final_approved" : "final_rejected",
    summary: `Final ${isApproved ? "Approved" : "Rejected"} by ${roleLabel}${data.comment ? `: "${data.comment}"` : ""}`,
    changes: {
      final_decision: data.decision,
      comment: data.comment ?? null,
      previous_status: adr.status,
    },
  });

  return { ok: true, status: data.decision };
}

export const submitFinalDecision = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        adr_id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        comment: z.string().max(4000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const result = await submitFinalDecisionService(context.userId, data);
    await publishAdrCollaborationSignal(context, data.adr_id, "status", result.status);
    return result;
  });

export const approveAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        adr_id: z.string().uuid(),
        decision: z.enum(["approve", "request_changes"]),
        note: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return approveAdrService(context.userId, data);
  });

export const revokeAdrApproval = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        adr_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const result = await revokeAdrApprovalService(context.userId, data.adr_id);
    if (result.statusReverted) {
      await publishAdrCollaborationSignal(context, data.adr_id, "status", "under_review");
    }
    return { ok: true };
  });

// ─── addComment & Mentions ───────────────────────────────────────────────────

export async function addCommentService(
  userId: string,
  data: { adr_id: string; body: string },
) {
  const adr = await pgOne<any>(
    `SELECT a.id, a.full_id, a.title, a.project_id, a.author_id, a.status, p.name AS proj_name
     FROM adrs a JOIN projects p ON p.id = a.project_id
     WHERE a.id = $1`,
    [data.adr_id],
  );
  if (!adr) throw new Error("ADR not found.");
  assertDraftAdrOwner(adr, userId);

  const inserted = await pgOne<any>(
    "INSERT INTO comments (adr_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, created_at",
    [data.adr_id, userId, data.body],
  );

  const commenter = await pgOne<any>("SELECT full_name, username FROM profiles WHERE id = $1", [
    userId,
  ]);
  const commenterName = commenter?.full_name || commenter?.username || "A user";

  // Parse @username mentions: e.g. @john, @alice_1
  const mentionMatches = data.body.match(/(?:^|\s)@([a-zA-Z0-9_-]+)/g);
  if (mentionMatches) {
    const rawUsernames = Array.from(
      new Set(mentionMatches.map((m) => m.trim().replace(/^@/, "").toLowerCase())),
    );
    if (rawUsernames.length > 0) {
      const mentionedProfiles = await pgQuery<any>(
        "SELECT id, username FROM profiles WHERE LOWER(username) = ANY($1::text[])",
        [rawUsernames],
      );

      for (const target of mentionedProfiles.rows ?? []) {
        if (target.id !== userId) {
          const preview = data.body.length > 100 ? `${data.body.slice(0, 100)}…` : data.body;
          await pgQuery(
            `INSERT INTO notifications (user_id, actor_id, type, title, message, link)
             VALUES ($1, $2, 'mention', $3, $4, $5)`,
            [
              target.id,
              userId,
              `Mentioned in ${adr.full_id}`,
              `${commenterName} mentioned you on "${adr.title}": "${preview}"`,
              `/adrs/${adr.id}`,
            ],
          );
        }
      }
    }
  }

  // Parse #ADR-ID references: e.g. #DEC-001, #AUTH-002
  const adrRefMatches = data.body.match(/(?:^|\s)#([a-zA-Z0-9_-]+)/g);
  if (adrRefMatches) {
    const rawRefs = Array.from(
      new Set(adrRefMatches.map((m) => m.trim().replace(/^#/, "").toUpperCase())),
    );
    if (rawRefs.length > 0) {
      const referencedAdrs = await pgQuery<any>(
        "SELECT id, full_id, title FROM adrs WHERE project_id = $1 AND UPPER(full_id) = ANY($2::text[]) AND id != $3",
        [adr.project_id, rawRefs, data.adr_id],
      );
      for (const refAdr of referencedAdrs.rows ?? []) {
        await recordAdrTimelineEvent({
          adr_id: refAdr.id,
          user_id: userId,
          event_type: "referenced",
          summary: `Referenced by ${adr.full_id} ("${adr.title}") in discussion`,
          changes: { referenced_by_adr_id: adr.id, referenced_by_full_id: adr.full_id },
        });
      }
    }
  }

  return { ok: true, id: inserted?.id };
}

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        adr_id: z.string().uuid(),
        body: z.string().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return addCommentService(context.userId, data);
  });

// ─── assignAdrReviewer ─────────────────────────────────────────────────────────

export async function assignAdrReviewerService(
  userId: string,
  data: { adr_id: string; reviewer_id: string | null },
) {
  const adr = await pgOne<any>(
    `SELECT a.id, a.full_id, a.title, a.project_id, a.author_id, a.status, a.assigned_to
     FROM adrs a WHERE a.id = $1`,
    [data.adr_id],
  );
  if (!adr) throw new Error("ADR not found.");
  assertDraftAdrOwner(adr, userId);

  const isAdmin = !!(await pgOne(
    "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
    [userId],
  ));
  const member = await pgOne<{ role: string }>(
    "SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2",
    [userId, adr.project_id],
  );
  if (!isAdmin && !member) {
    throw new Error("Only project members or platform admins can assign reviewers.");
  }

  await pgQuery("UPDATE adrs SET assigned_to = $1 WHERE id = $2", [data.reviewer_id, data.adr_id]);

  const assigner = await pgOne<any>("SELECT full_name, username FROM profiles WHERE id = $1", [
    userId,
  ]);
  const assignerName = assigner?.full_name || assigner?.username || "A user";

  if (data.reviewer_id) {
    const reviewer = await pgOne<any>("SELECT full_name, username FROM profiles WHERE id = $1", [
      data.reviewer_id,
    ]);
    const reviewerHandle = reviewer?.username ? `@${reviewer.username}` : reviewer?.full_name || "reviewer";

    // Pass as comment in the timeline
    const timelineComment = `📋 Assigned ${reviewerHandle} to review this ADR.`;
    await pgQuery("INSERT INTO comments (adr_id, user_id, body) VALUES ($1, $2, $3)", [
      data.adr_id,
      userId,
      timelineComment,
    ]);

    // Send notification
    if (data.reviewer_id !== userId) {
      await pgQuery(
        `INSERT INTO notifications (user_id, actor_id, type, title, message, link)
         VALUES ($1, $2, 'assignment', $3, $4, $5)`,
        [
          data.reviewer_id,
          userId,
          `Assigned to review ${adr.full_id}`,
          `${assignerName} assigned you to review "${adr.title}".`,
          `/adrs/${adr.id}`,
        ],
      );
    }

    await recordAdrTimelineEvent({
      adr_id: data.adr_id,
      user_id: userId,
      event_type: "reviewer_assigned",
      summary: `Assigned ${reviewerHandle} to review this ADR`,
      changes: { reviewer_id: data.reviewer_id, reviewer_handle: reviewerHandle },
    });
  } else {
    const timelineComment = "📋 Unassigned reviewer from this ADR.";
    await pgQuery("INSERT INTO comments (adr_id, user_id, body) VALUES ($1, $2, $3)", [
      data.adr_id,
      userId,
      timelineComment,
    ]);

    await recordAdrTimelineEvent({
      adr_id: data.adr_id,
      user_id: userId,
      event_type: "reviewer_assigned",
      summary: "Unassigned reviewer from this ADR",
      changes: { reviewer_id: null },
    });
  }

  return { ok: true };
}

export const assignAdrReviewer = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        adr_id: z.string().uuid(),
        reviewer_id: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return assignAdrReviewerService(context.userId, data);
  });

// ─── resolveComment ───────────────────────────────────────────────────────────

export async function resolveCommentService(
  userId: string,
  data: { comment_id: string; resolved?: boolean; is_resolved?: boolean },
) {
  const comment = await pgOne<any>(
    `SELECT c.id, c.adr_id, c.user_id, c.body, a.full_id, a.title, a.project_id
     FROM comments c
     JOIN adrs a ON a.id = c.adr_id
     WHERE c.id = $1`,
    [data.comment_id],
  );
  if (!comment) throw new Error("Comment not found.");

  const isAdmin = !!(await pgOne(
    "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
    [userId],
  ));
  const member = await pgOne<{ role: string }>(
    "SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2",
    [userId, comment.project_id],
  );
  if (!isAdmin && !member) {
    throw new Error("Only project members or admins can resolve comments.");
  }

  const isResolved = data.resolved ?? data.is_resolved ?? true;

  if (isResolved) {
    await pgQuery(
      `UPDATE comments
       SET is_resolved = true, resolved_by = $1, resolved_at = now()
       WHERE id = $2`,
      [userId, data.comment_id],
    );

    if (comment.user_id !== userId) {
      const resolver = await pgOne<any>("SELECT full_name, username FROM profiles WHERE id = $1", [
        userId,
      ]);
      const resolverName = resolver?.full_name || resolver?.username || "A user";
      await pgQuery(
        `INSERT INTO notifications (user_id, actor_id, type, title, message, link)
         VALUES ($1, $2, 'comment_resolved', $3, $4, $5)`,
        [
          comment.user_id,
          userId,
          `Comment resolved on ${comment.full_id}`,
          `${resolverName} marked your comment on "${comment.title}" as resolved.`,
          `/adrs/${comment.adr_id}`,
        ],
      );
    }

    const preview = comment.body.length > 60 ? `${comment.body.slice(0, 60)}…` : comment.body;
    await recordAdrTimelineEvent({
      adr_id: comment.adr_id,
      user_id: userId,
      event_type: "comment_resolved",
      summary: `Marked comment as resolved: "${preview}"`,
      changes: { comment_id: data.comment_id, is_resolved: true },
    });
  } else {
    await pgQuery(
      `UPDATE comments
       SET is_resolved = false, resolved_by = NULL, resolved_at = NULL
       WHERE id = $1`,
      [data.comment_id],
    );

    const preview = comment.body.length > 60 ? `${comment.body.slice(0, 60)}…` : comment.body;
    await recordAdrTimelineEvent({
      adr_id: comment.adr_id,
      user_id: userId,
      event_type: "comment_reopened",
      summary: `Reopened comment: "${preview}"`,
      changes: { comment_id: data.comment_id, is_resolved: false },
    });
  }

  return { ok: true };
}

export const resolveComment = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        comment_id: z.string().uuid(),
        resolved: z.boolean().optional(),
        is_resolved: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return resolveCommentService(context.userId, data);
  });

// ─── Notifications: getNotifications & markNotificationRead ──────────────────

export async function getNotificationsService(userId: string) {
  const [listRow, countRow] = await Promise.all([
    pgQuery(
      `SELECT n.*, pr.full_name AS actor_name, pr.username AS actor_username, pr.avatar_url AS actor_avatar
       FROM notifications n
       LEFT JOIN profiles pr ON pr.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 30`,
      [userId],
    ),
    pgOne<{ unread: string }>(
      "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND is_read = false",
      [userId],
    ),
  ]);

  return {
    notifications: listRow.rows ?? [],
    unreadCount: Number(countRow?.unread ?? 0),
  };
}

export async function markNotificationReadService(
  userId: string,
  data: { id?: string; all?: boolean },
) {
  if (data.all) {
    await pgQuery("UPDATE notifications SET is_read = true WHERE user_id = $1", [userId]);
  } else if (data.id) {
    await pgQuery("UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2", [
      data.id,
      userId,
    ]);
  }
  return { ok: true };
}

export const getNotifications = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .handler(async ({ context: rawCtx }) => {
    const context = ctx(rawCtx);
    return getNotificationsService(context.userId);
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        all: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return markNotificationReadService(context.userId, data);
  });

// ─── dashboardStats ───────────────────────────────────────────────────────────

export const dashboardStats = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .handler(async ({ context: rawCtx }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const isAdminRow = await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    );
    const isAdmin = !!isAdminRow;

    let adrsRow, projectsRow;

    if (isAdmin) {
      [adrsRow, projectsRow] = await Promise.all([
        pgQuery(
          `SELECT a.id, a.status, a.full_id, a.title, a.updated_at, a.project_id, a.assigned_to, a.current_version,
                  p.name AS proj_name, p.code AS proj_code,
                  ass.full_name AS assigned_to_name, ass.username AS assigned_to_username
           FROM adrs a
           JOIN projects p ON p.id = a.project_id
           LEFT JOIN profiles ass ON ass.id = a.assigned_to
           WHERE (a.status <> 'draft' OR a.author_id = $1)
           ORDER BY a.updated_at DESC LIMIT 20`,
          [userId],
        ),
        pgQuery("SELECT id, name, code FROM projects"),
      ]);
    } else {
      [adrsRow, projectsRow] = await Promise.all([
        pgQuery(
          `SELECT a.id, a.status, a.full_id, a.title, a.updated_at, a.project_id, a.assigned_to, a.current_version,
                  p.name AS proj_name, p.code AS proj_code,
                  ass.full_name AS assigned_to_name, ass.username AS assigned_to_username
           FROM adrs a 
           JOIN projects p ON p.id = a.project_id
           JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
           LEFT JOIN profiles ass ON ass.id = a.assigned_to
           WHERE (a.status <> 'draft' OR a.author_id = $2)
           ORDER BY a.updated_at DESC LIMIT 20`,
          [userId, userId],
        ),
        pgQuery(
          `SELECT p.id, p.name, p.code FROM projects p
           JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1`,
          [userId],
        ),
      ]);
    }

    const [reviewRequiredRow, resolvedCommentsRow, resolvedCountRow, unreadNotificationsRow] =
      await Promise.all([
        pgQuery(
          `SELECT a.id, a.full_id, a.title, a.status, a.updated_at, a.assigned_to, a.current_version,
                  p.name AS proj_name, p.code AS proj_code,
                  (a.assigned_to = $1) AS is_assigned_to_me
           FROM adrs a
           JOIN projects p ON p.id = a.project_id
           WHERE a.status = 'under_review'
             AND (
               $2 = true OR EXISTS (
                 SELECT 1 FROM project_members pm
                 WHERE pm.project_id = p.id AND pm.user_id = $1 AND pm.role <> 'intern'
               )
             )
             AND NOT EXISTS (
               SELECT 1 FROM approvals ap
               WHERE ap.adr_id = a.id AND ap.user_id = $1 AND ap.decision = 'approve'
             )
           ORDER BY (a.assigned_to = $1) DESC, a.updated_at DESC
           LIMIT 10`,
          [userId, isAdmin],
        ),
        pgQuery(
          `SELECT c.id, c.body, c.resolved_at, c.adr_id, a.full_id, a.title AS adr_title,
                  res_pr.full_name AS resolved_by_name, pr.full_name AS author_name
           FROM comments c
           JOIN adrs a ON a.id = c.adr_id
           JOIN projects p ON p.id = a.project_id
           LEFT JOIN profiles res_pr ON res_pr.id = c.resolved_by
           LEFT JOIN profiles pr ON pr.id = c.user_id
           WHERE c.is_resolved = true
             AND (
               $2 = true OR EXISTS (
                 SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1
               )
             )
           ORDER BY c.resolved_at DESC
           LIMIT 5`,
          [userId, isAdmin],
        ),
        pgOne<{ count: string }>(
          `SELECT COUNT(*) AS count
           FROM comments c
           JOIN adrs a ON a.id = c.adr_id
           JOIN projects p ON p.id = a.project_id
           WHERE c.is_resolved = true
             AND (
               $2 = true OR EXISTS (
                 SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1
               )
             )`,
          [userId, isAdmin],
        ),
        pgOne<{ count: string }>(
          "SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false",
          [userId],
        ),
      ]);

    const adrs = (adrsRow.rows ?? []).map((a: any) => ({
      ...a,
      projects: { name: a.proj_name, code: a.proj_code },
      assigned_to_profile: a.assigned_to
        ? { id: a.assigned_to, full_name: a.assigned_to_name, username: a.assigned_to_username }
        : null,
    }));
    const counts = {
      total: 0,
      draft: 0,
      under_review: 0,
      approved: 0,
      published: 0,
      superseded: 0,
      rejected: 0,
    };
    adrs.forEach((a: any) => {
      counts.total++;
      if (a.status in counts) counts[a.status as keyof typeof counts]++;
    });

    return {
      recent: adrs,
      counts,
      projectsCount: (projectsRow.rows ?? []).length,
      reviewRequired: reviewRequiredRow.rows ?? [],
      resolvedComments: resolvedCommentsRow.rows ?? [],
      resolvedCommentsCount: Number(resolvedCountRow?.count ?? 0),
      unreadNotificationsCount: Number(unreadNotificationsRow?.count ?? 0),
    };
  });

// ─── updateUser (admin: edit role / name / username) ──────────────────────────

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        full_name: z.string().min(1).max(200).optional(),
        username: z
          .string()
          .trim()
          .min(3)
          .max(30)
          .regex(/^[a-zA-Z0-9._-]+$/)
          .nullable()
          .optional(),
        role: z.enum(["admin", "member"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const normalizedUsername =
      data.username === undefined
        ? undefined
        : data.username
          ? data.username.toLowerCase().trim()
          : null;

    const isAdmin = !!(await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    ));
    if (!isAdmin) throw new Error("Only platform admins can edit users.");

    if (normalizedUsername) {
      const existing = await pgOne(
        `SELECT 1 FROM profiles WHERE lower(username) = $1 AND id <> $2
         UNION ALL
         SELECT 1 FROM local_users WHERE lower(username) = $1 AND id <> $2
         LIMIT 1`,
        [normalizedUsername, data.user_id],
      );
      if (existing) {
        throw new Error("Username is already taken.");
      }
    }

    if (data.full_name) {
      await pgQuery("UPDATE profiles SET full_name = $1 WHERE id = $2", [
        data.full_name,
        data.user_id,
      ]);
      await pgQuery("UPDATE local_users SET full_name = $1 WHERE id = $2", [
        data.full_name,
        data.user_id,
      ]);
    }
    if (normalizedUsername !== undefined) {
      await pgQuery("UPDATE profiles SET username = $1 WHERE id = $2", [
        normalizedUsername,
        data.user_id,
      ]);
      await pgQuery("UPDATE local_users SET username = $1 WHERE id = $2", [
        normalizedUsername,
        data.user_id,
      ]);
    }
    if (data.role) {
      // Replace all platform roles for this user
      await pgQuery("DELETE FROM user_roles WHERE user_id = $1 AND role IN ('admin','member')", [
        data.user_id,
      ]);
      await pgQuery("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [
        data.user_id,
        data.role,
      ]);
      await pgQuery("UPDATE local_users SET role = $1 WHERE id = $2", [data.role, data.user_id]);
    }
    return { ok: true };
  });

// ─── updateProfile (self: edit own name / avatar_url) ────────────────────────

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        full_name: z.string().min(1).max(200),
        username: z
          .string()
          .trim()
          .min(3)
          .max(30)
          .regex(/^[a-zA-Z0-9._-]+$/)
          .nullable()
          .optional(),
        avatar_url: z.string().url().optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;
    const username =
      data.username === undefined ? undefined : (data.username?.toLowerCase() ?? null);

    if (username) {
      const existing = await pgOne(
        `SELECT 1 FROM profiles WHERE lower(username) = $1 AND id <> $2
         UNION ALL
         SELECT 1 FROM local_users WHERE lower(username) = $1 AND id <> $2
         LIMIT 1`,
        [username, userId],
      );
      if (existing) throw new Error("That username is already in use.");
    }
    if (username === undefined) {
      await pgQuery("UPDATE profiles SET full_name = $1, avatar_url = $2 WHERE id = $3", [
        data.full_name,
        data.avatar_url || null,
        userId,
      ]);
      await pgQuery("UPDATE local_users SET full_name = $1 WHERE id = $2", [
        data.full_name,
        userId,
      ]);
    } else {
      await pgQuery(
        "UPDATE profiles SET full_name = $1, username = $2, avatar_url = $3 WHERE id = $4",
        [data.full_name, username, data.avatar_url || null, userId],
      );
      await pgQuery("UPDATE local_users SET full_name = $1, username = $2 WHERE id = $3", [
        data.full_name,
        username,
        userId,
      ]);
    }
    return { ok: true };
  });

// ─── changePassword (local mode only) ────────────────────────────────────────

export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        current_password: z.string().min(1),
        new_password: z.string().min(8),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const user = await pgOne<{ password_hash: string; email: string }>(
      "SELECT password_hash, email FROM local_users WHERE id = $1",
      [userId],
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
    const { createLocalUser: _, ...authHelpers } =
      await import("@/integrations/database/local-auth.server");
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
    z
      .object({
        target_user_id: z.string().uuid(),
        new_password: z.string().min(8),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    const isAdmin = !!(await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    ));
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

    await pgQuery("UPDATE local_users SET password_hash = $1 WHERE id = $2", [
      newHash,
      data.target_user_id,
    ]);
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

export async function updateAdrService(userId: string, data: z.infer<typeof adrFieldsSchema>) {
  // Check project_member or admin
  const adr = await pgOne<any>(
    `SELECT status, project_id, author_id, title, context, decision, consequences,
            tags, alternatives, design_changes, major_impacts, references_data, current_version
     FROM adrs WHERE id = $1`,
    [data.id],
  );
  if (!adr) throw new Error("ADR not found");
  assertDraftAdrOwner(adr, userId);

  if ((adr.current_version ?? 0) > 0 || adr.status === "published" || adr.status === "superseded") {
    throw new Error(
      "Finalized ADRs cannot be edited or overwritten. To change an architectural decision, create a new ADR that supersedes this record."
    );
  }

  const isAdmin = !!(await pgOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role='admin'", [
    userId,
  ]));
  const isProjectMember = !!(await pgOne(
    "SELECT 1 FROM project_members WHERE user_id=$1 AND project_id=$2",
    [userId, adr.project_id],
  ));
  if (!isAdmin && !isProjectMember) throw new Error("Not authorized to edit this ADR");
  assertRequiredAdrContent({
    title: data.title ?? adr.title,
    context: data.context ?? adr.context,
    decision: data.decision ?? adr.decision,
    consequences: data.consequences ?? adr.consequences,
  });

  const changedFields: string[] = [];
  if (data.title !== undefined && data.title !== adr.title) changedFields.push("Title");
  if (data.context !== undefined && data.context !== adr.context) changedFields.push("Context");
  if (data.decision !== undefined && data.decision !== adr.decision) changedFields.push("Decision");
  if (data.consequences !== undefined && data.consequences !== adr.consequences) changedFields.push("Consequences");
  if (data.alternatives !== undefined && data.alternatives !== adr.alternatives) changedFields.push("Alternatives");
  if (data.tags !== undefined && JSON.stringify(data.tags ?? []) !== JSON.stringify(adr.tags ?? [])) changedFields.push("Tags");
  if (data.design_changes !== undefined && JSON.stringify(data.design_changes ?? {}) !== JSON.stringify(adr.design_changes ?? {})) changedFields.push("Design Changes");
  if (data.major_impacts !== undefined && JSON.stringify(data.major_impacts ?? {}) !== JSON.stringify(adr.major_impacts ?? {})) changedFields.push("Major Impacts");
  if (data.references_data !== undefined && JSON.stringify(data.references_data ?? {}) !== JSON.stringify(adr.references_data ?? {})) changedFields.push("References");

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

  let nextStatus: string | null = null;
  if (adr.status === "rejected") {
    fields.push(`status = $${p++}`);
    vals.push("draft");
    nextStatus = "draft";
  } else if (adr.status === "approved") {
    fields.push(`status = $${p++}`);
    vals.push("under_review");
    nextStatus = "under_review";
  }

  if (!fields.length) return { ok: true, nextStatus: null };
  vals.push(data.id);
  await pgQuery(`UPDATE adrs SET ${fields.join(", ")} WHERE id = $${p}`, vals);

  // Revoke approvals because the ADR content was edited/updated,
  // allowing reviewers to re-verify the new edits and approve again.
  await pgQuery("DELETE FROM approvals WHERE adr_id = $1 AND decision = 'approve'", [data.id]);

  if (changedFields.length > 0) {
    const summary =
      nextStatus && nextStatus !== adr.status
        ? `Edited ${changedFields.join(", ")} (status moved to ${nextStatus.replace("_", " ")})`
        : `Edited ${changedFields.join(", ")}`;

    await recordAdrTimelineEvent({
      adr_id: data.id,
      user_id: userId,
      event_type: "edited",
      summary,
      changes: {
        changed_fields: changedFields,
        previous_status: adr.status,
        next_status: nextStatus ?? adr.status,
      },
    });
  }

  return { ok: true, nextStatus };
}

export const updateAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => adrFieldsSchema.parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const result = await updateAdrService(context.userId, data);
    if (result.nextStatus) {
      await publishAdrCollaborationSignal(context, data.id, "status", result.nextStatus);
    }
    return { ok: true };
  });

// ─── searchAdrs ───────────────────────────────────────────────────────────────

export const searchAdrs = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().min(1).max(300),
        status: z.string().optional(),
        project_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;
    const like = `%${data.q.toLowerCase()}%`;

    const isAdminRow = await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    );
    const isAdmin = !!isAdminRow;

    let sql = `
      SELECT a.id, a.full_id, a.title, a.status, a.tags, a.updated_at, a.project_id, a.current_version,
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

    if (data.status) {
      sql += ` AND a.status = $${p++}`;
      params.push(data.status);
    }
    if (data.project_id) {
      sql += ` AND a.project_id = $${p++}`;
      params.push(data.project_id);
    }
    const visibilityParamIndex = p++;
    params.push(userId);
    sql += ` AND (a.status <> 'draft' OR a.author_id = $${visibilityParamIndex})`;
    sql += " ORDER BY a.updated_at DESC LIMIT 50";
    const result = await pgQuery(sql, params);
    return (result.rows ?? []).map((a: any) => ({
      ...a,
      projects: { name: a.proj_name, code: a.proj_code },
    }));
  });

// ─── getAdrRelationships ──────────────────────────────────────────────────────

export const getAdrRelationships = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ adr_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;
    await assertDraftAdrVisible(context, data.adr_id);

    const result = await pgQuery(
      `SELECT r.*, sa.full_id AS source_full_id, sa.title AS source_title,
              ta.full_id AS target_full_id, ta.title AS target_title,
              ta.status AS target_status
       FROM adr_relationships r
       JOIN adrs sa ON sa.id = r.source_adr_id
       JOIN adrs ta ON ta.id = r.target_adr_id
       WHERE (r.source_adr_id = $1 OR r.target_adr_id = $1)
         AND (sa.status <> 'draft' OR sa.author_id = $2)
         AND (ta.status <> 'draft' OR ta.author_id = $2)`,
      [data.adr_id, userId],
    );
    return result.rows ?? [];
  });

// ─── addAdrRelationship ───────────────────────────────────────────────────────

export const addAdrRelationship = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        source_adr_id: z.string().uuid(),
        target_adr_id: z.string().uuid(),
        rel_type: z.enum([
          "depends_on",
          "related_to",
          "supersedes",
          "superseded_by",
          "conflicts_with",
          "affects",
        ]),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;
    await Promise.all([
      assertAdrCollaborationAccess(context, data.source_adr_id),
      assertAdrCollaborationAccess(context, data.target_adr_id),
    ]);

    await pgQuery(
      `INSERT INTO adr_relationships (source_adr_id, target_adr_id, rel_type, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_adr_id, target_adr_id, rel_type) DO NOTHING`,
      [data.source_adr_id, data.target_adr_id, data.rel_type, userId],
    );

    // Automatic status update for superseded ADRs
    if (data.rel_type === "supersedes") {
      const source = await pgOne<{ full_id: string; title: string }>(
        "SELECT full_id, title FROM adrs WHERE id = $1",
        [data.source_adr_id],
      );
      const target = await pgOne<{ status: string }>(
        "SELECT status FROM adrs WHERE id = $1",
        [data.target_adr_id],
      );
      if (target && target.status !== "superseded") {
        await pgQuery("UPDATE adrs SET status = 'superseded' WHERE id = $1", [data.target_adr_id]);
        await recordAdrTimelineEvent({
          adr_id: data.target_adr_id,
          user_id: userId,
          event_type: "status_changed",
          summary: `Status updated to Superseded by ${source?.full_id ?? "new ADR"} ("${source?.title ?? ""}")`,
          changes: {
            previous_status: target.status,
            new_status: "superseded",
            superseded_by_id: data.source_adr_id,
            superseded_by_full_id: source?.full_id,
          },
        });
      }
    } else if (data.rel_type === "superseded_by") {
      const target = await pgOne<{ full_id: string; title: string }>(
        "SELECT full_id, title FROM adrs WHERE id = $1",
        [data.target_adr_id],
      );
      const source = await pgOne<{ status: string }>(
        "SELECT status FROM adrs WHERE id = $1",
        [data.source_adr_id],
      );
      if (source && source.status !== "superseded") {
        await pgQuery("UPDATE adrs SET status = 'superseded' WHERE id = $1", [data.source_adr_id]);
        await recordAdrTimelineEvent({
          adr_id: data.source_adr_id,
          user_id: userId,
          event_type: "status_changed",
          summary: `Status updated to Superseded by ${target?.full_id ?? "new ADR"} ("${target?.title ?? ""}")`,
          changes: {
            previous_status: source.status,
            new_status: "superseded",
            superseded_by_id: data.target_adr_id,
            superseded_by_full_id: target?.full_id,
          },
        });
      }
    }

    await Promise.all([
      publishAdrCollaborationSignal(
        context,
        data.source_adr_id,
        "relationshipsRevision",
        new Date().toISOString(),
      ),
      publishAdrCollaborationSignal(
        context,
        data.target_adr_id,
        "relationshipsRevision",
        new Date().toISOString(),
      ),
    ]);
    return { ok: true };
  });

// ─── removeAdrRelationship ────────────────────────────────────────────────────

export const removeAdrRelationship = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);

    const relationship = await pgOne<{ source_adr_id: string; target_adr_id: string; rel_type: string }>(
      "SELECT source_adr_id, target_adr_id, rel_type FROM adr_relationships WHERE id = $1",
      [data.id],
    );
    if (!relationship) return { ok: true };
    await Promise.all([
      assertAdrCollaborationAccess(context, relationship.source_adr_id),
      assertAdrCollaborationAccess(context, relationship.target_adr_id),
    ]);
    await pgQuery("DELETE FROM adr_relationships WHERE id = $1", [data.id]);

    const supersededAdrId =
      relationship.rel_type === "supersedes"
        ? relationship.target_adr_id
        : relationship.rel_type === "superseded_by"
          ? relationship.source_adr_id
          : null;

    if (supersededAdrId) {
      const stillSuperseded = await pgOne(
        `SELECT 1 FROM adr_relationships
         WHERE (target_adr_id = $1 AND rel_type = 'supersedes')
            OR (source_adr_id = $1 AND rel_type = 'superseded_by')
         LIMIT 1`,
        [supersededAdrId],
      );
      if (!stillSuperseded) {
        const adrInfo = await pgOne<{ current_version: number }>(
          "SELECT current_version FROM adrs WHERE id = $1",
          [supersededAdrId],
        );
        const hasRejections = await pgOne(
          "SELECT 1 FROM approvals WHERE adr_id = $1 AND decision = 'request_changes' LIMIT 1",
          [supersededAdrId],
        );
        const restoredStatus =
          (adrInfo?.current_version ?? 0) > 0
            ? hasRejections
              ? "rejected"
              : "published"
            : "approved";

        await pgQuery("UPDATE adrs SET status = $1 WHERE id = $2", [restoredStatus, supersededAdrId]);
        await recordAdrTimelineEvent({
          adr_id: supersededAdrId,
          user_id: context.userId,
          event_type: "status_changed",
          summary: `Status restored to ${restoredStatus} after supersede relationship was removed`,
          changes: { previous_status: "superseded", new_status: restoredStatus },
        });
      }
    }

    await Promise.all([
      publishAdrCollaborationSignal(
        context,
        relationship.source_adr_id,
        "relationshipsRevision",
        new Date().toISOString(),
      ),
      publishAdrCollaborationSignal(
        context,
        relationship.target_adr_id,
        "relationshipsRevision",
        new Date().toISOString(),
      ),
    ]);
    return { ok: true };
  });

// ─── updateAdrRelationship ────────────────────────────────────────────────────

export async function updateAdrRelationshipService(
  userId: string,
  data: {
    id: string;
    rel_type: "depends_on" | "related_to" | "supersedes" | "superseded_by" | "conflicts_with" | "affects";
    source_adr_id?: string;
    target_adr_id?: string;
  },
  context?: AuthContext,
) {
  const relationship = await pgOne<{ source_adr_id: string; target_adr_id: string }>(
    "SELECT source_adr_id, target_adr_id FROM adr_relationships WHERE id = $1",
    [data.id],
  );
  if (!relationship) throw new Error("Relationship not found");
  if (context) {
    await Promise.all([
      assertAdrCollaborationAccess(context, relationship.source_adr_id),
      assertAdrCollaborationAccess(context, relationship.target_adr_id),
    ]);
  }

  const nextSource = data.source_adr_id ?? relationship.source_adr_id;
  const nextTarget = data.target_adr_id ?? relationship.target_adr_id;

  await pgQuery(
    `UPDATE adr_relationships
     SET rel_type = $1, source_adr_id = $2, target_adr_id = $3
     WHERE id = $4`,
    [data.rel_type, nextSource, nextTarget, data.id],
  );

  if (context) {
    await Promise.all([
      publishAdrCollaborationSignal(
        context,
        nextSource,
        "relationshipsRevision",
        new Date().toISOString(),
      ),
      publishAdrCollaborationSignal(
        context,
        nextTarget,
        "relationshipsRevision",
        new Date().toISOString(),
      ),
    ]);
  }
  return { ok: true };
}

export const updateAdrRelationship = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        rel_type: z.enum([
          "depends_on",
          "related_to",
          "supersedes",
          "superseded_by",
          "conflicts_with",
          "affects",
        ]),
        source_adr_id: z.string().uuid().optional(),
        target_adr_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return updateAdrRelationshipService(context.userId, data, context);
  });

// ─── publishAdr ───────────────────────────────────────────────────────────────

export async function publishAdrService(
  userId: string,
  data: { adr_id: string; publish_as?: "published" | "rejected" },
) {
  // Fetch the ADR
  const adr = await pgOne<any>(
    `SELECT a.*, p.code AS proj_code, p.name AS proj_name, p.repo_url, p.branch, p.adr_path, p.git_pat
     FROM adrs a JOIN projects p ON p.id = a.project_id WHERE a.id = $1`,
    [data.adr_id],
  );
  if (!adr) throw new Error("ADR not found");
  assertDraftAdrOwner(adr, userId);

  const isAdmin = !!(await pgOne(
    "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
    [userId],
  ));
  const member = await pgOne<{ role: string }>(
    "SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2",
    [userId, adr.project_id],
  );
  if (!isAdmin && member?.role !== "project_admin") {
    throw new Error("Only project admins or platform admins can publish ADRs.");
  }

  if ((adr.current_version ?? 0) > 0 || adr.status === "published" || adr.status === "superseded") {
    throw new Error(
      "This ADR has already been published. A finalized ADR cannot be republished or overwritten. Create a new ADR to supersede it."
    );
  }

  // Check if ADR was rejected by users (has request_changes decision) or status is rejected
  const rejections = await pgQuery<any>(
    "SELECT 1 FROM approvals WHERE adr_id = $1 AND decision = 'request_changes'",
    [data.adr_id],
  );
  const hasRejections = (rejections.rows ?? []).length > 0;

  // Determine whether publishing as accepted or rejected
  const finalStatus: "published" | "rejected" =
    data.publish_as ??
    (adr.status === "rejected" || (adr.status !== "approved" && hasRejections)
      ? "rejected"
      : "published");

  // Generate Markdown with the target status in header
  const { generateAdrMarkdown } = await import("@/lib/adr-markdown");
  const markdown = generateAdrMarkdown({ ...adr, status: finalStatus });

  // Attempt Git push (non-blocking if no repo configured)
  let gitCommitHash: string | undefined;
  let repositoryPath: string | undefined;
  if (adr.repo_url) {
    try {
      const { pushAdrToGit } = await import("@/lib/api/git.server");
      const pushResult = await pushAdrToGit({
        adr: { ...adr, status: finalStatus },
        markdown,
        publisherUserId: userId,
      });
      gitCommitHash = pushResult.commitHash;
      repositoryPath = pushResult.repositoryPath;
    } catch (err: any) {
      console.warn("Git push failed:", err);
      throw new Error(`Git push failed: ${err.message}`);
    }
  }

  // Get next version number
  const vRow = await pgOne<{ max: number }>(
    "SELECT COALESCE(MAX(version_number), 0) + 1 AS max FROM published_versions WHERE adr_id = $1",
    [data.adr_id],
  );
  const nextVersion = vRow?.max ?? 1;

  // Insert published version + update ADR status
  await pgQuery(
    `INSERT INTO published_versions (adr_id, version_number, markdown, git_commit_hash, published_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.adr_id, nextVersion, markdown, gitCommitHash ?? null, userId],
  );
  await pgQuery(
    `UPDATE adrs SET status = $1, current_version = $2,
     repository_path = COALESCE($3, repository_path), repository_deleted_at = NULL
     WHERE id = $4`,
    [finalStatus, nextVersion, repositoryPath ?? null, data.adr_id],
  );
  await recordAdrTimelineEvent({
    adr_id: data.adr_id,
    user_id: userId,
    event_type: "published",
    summary:
      finalStatus === "rejected"
        ? `Published rejected decision as v${nextVersion}${gitCommitHash ? ` (${gitCommitHash.slice(0, 7)})` : ""}`
        : `Published version v${nextVersion}${gitCommitHash ? ` (${gitCommitHash.slice(0, 7)})` : ""}`,
    changes: {
      status: finalStatus,
      version: nextVersion,
      git_commit_hash: gitCommitHash ?? null,
      repository_path: repositoryPath ?? adr.repository_path ?? null,
    },
  });

  return { version: nextVersion, gitCommitHash, markdown, status: finalStatus };
}

export const publishAdr = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        adr_id: z.string().uuid(),
        publish_as: z.enum(["published", "rejected"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const result = await publishAdrService(context.userId, data);
    await publishAdrCollaborationSignal(context, data.adr_id, "status", result.status);
    return result;
  });

// ─── findSimilarAdrs ──────────────────────────────────────────────────────────

export const findSimilarAdrs = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        title: z.string(),
        context: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    const { userId } = context;

    // Extract keywords (longer than 4 chars)
    const text = `${data.title} ${data.context}`.toLowerCase();
    const words = Array.from(new Set(text.split(/\W+/).filter((w) => w.length > 4))).slice(0, 5);

    if (words.length === 0) return [];

    const isAdminRow = await pgOne(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
      [userId],
    );
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
    words.forEach((w) => params.push(`%${w}%`));

    const conditions = words.map(
      (_, i) =>
        `(lower(a.title) LIKE $${offset + i + 1} OR lower(a.context) LIKE $${offset + i + 1})`,
    );
    const visibilityParamIndex = params.length + 1;
    params.push(userId);
    sql += ` WHERE (a.status <> 'draft' OR a.author_id = $${visibilityParamIndex})
             AND (${conditions.join(" OR ")}) LIMIT 20`;

    const result = await pgQuery(sql, params);

    const scored = (result.rows ?? []).map((r) => {
      const str = `${r.title} ${r.context}`.toLowerCase();
      let score = 0;
      words.forEach((w) => {
        if (str.includes(w)) score++;
      });
      return { ...r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((r) => ({ id: r.id, full_id: r.full_id, title: r.title }));
  });

// ─── getProjectForGraph ───────────────────────────────────────────────────────

export async function getProjectForGraphService(userId: string, data: { project_id: string }) {
  const [adrsRow, relsRow, projectRow] = await Promise.all([
    pgQuery(
      `SELECT DISTINCT a.id, a.full_id, a.title, a.status, a.current_version, a.repository_path
       FROM adrs a
       WHERE (a.status <> 'draft' OR a.author_id = $2)
         AND (a.project_id = $1
           OR a.id IN (SELECT source_adr_id FROM adr_relationships r JOIN adrs ta ON ta.id = r.target_adr_id WHERE ta.project_id = $1)
           OR a.id IN (SELECT target_adr_id FROM adr_relationships r JOIN adrs sa ON sa.id = r.source_adr_id WHERE sa.project_id = $1))`,
      [data.project_id, userId],
    ),
    pgQuery(
      `SELECT r.id, r.source_adr_id, r.target_adr_id, r.rel_type
       FROM adr_relationships r
       JOIN adrs sa ON sa.id = r.source_adr_id
       JOIN adrs ta ON ta.id = r.target_adr_id
       WHERE (r.source_adr_id IN (SELECT id FROM adrs WHERE project_id = $1)
          OR r.target_adr_id IN (SELECT id FROM adrs WHERE project_id = $1))
         AND (sa.status <> 'draft' OR sa.author_id = $2)
         AND (ta.status <> 'draft' OR ta.author_id = $2)`,
      [data.project_id, userId],
    ),
    pgOne<{ graph_layout: Record<string, { x: number; y: number }> }>(
      "SELECT graph_layout FROM projects WHERE id = $1",
      [data.project_id],
    ),
  ]);
  return {
    adrs: adrsRow.rows ?? [],
    relationships: relsRow.rows ?? [],
    graph_layout: projectRow?.graph_layout ?? {},
  };
}

export const getProjectForGraph = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return getProjectForGraphService(context.userId, data);
  });

// ─── saveProjectGraphLayout ───────────────────────────────────────────────────

export async function saveProjectGraphLayoutService(
  userId: string,
  data: { project_id: string; layout: Record<string, { x: number; y: number }> },
) {
  const isAdmin = !!(await pgOne(
    "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'",
    [userId],
  ));
  const isMember = !!(await pgOne(
    "SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2",
    [userId, data.project_id],
  ));
  if (!isAdmin && !isMember) {
    throw new Error("Unauthorized to edit project graph layout");
  }

  await pgQuery("UPDATE projects SET graph_layout = $1::jsonb WHERE id = $2", [
    JSON.stringify(data.layout),
    data.project_id,
  ]);
  return { ok: true };
}

export const saveProjectGraphLayout = createServerFn({ method: "POST" })
  .middleware([requireFlexibleAuth])
  .validator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        layout: z.record(z.object({ x: z.number(), y: z.number() })),
      })
      .parse(d),
  )
  .handler(async ({ context: rawCtx, data }) => {
    const context = ctx(rawCtx);
    return saveProjectGraphLayoutService(context.userId, data);
  });
