import { createHmac, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { parseAdrMarkdown } from "@/lib/adr-markdown";
import { normalizeRepositoryAdrPath } from "@/lib/api/git.server";

interface GitHubSyncProject {
  id: string;
  repo_url: string | null;
  branch: string | null;
  adr_path: string | null;
  git_pat: string | null;
  github_sync_enabled: boolean;
  github_webhook_secret?: string | null;
  github_sync_last_commit: string | null;
  created_by: string | null;
}

interface TrackedAdr {
  id: string;
  full_id: string;
  title: string;
  status: string;
  tags: string[];
  context: string;
  decision: string;
  consequences: string;
  alternatives: string;
  design_changes: Record<string, string>;
  major_impacts: Record<string, string>;
  references_data: Record<string, string[]>;
  repository_path: string | null;
  repository_deleted_at: string | null;
}

const pushPayloadSchema = z.object({
  ref: z.string().max(300),
  after: z.string().regex(/^[a-f0-9]{40}$/i),
  deleted: z.boolean().optional(),
  repository: z.object({ full_name: z.string().max(300) }),
});

function repositoryKey(repoUrl: string | null) {
  if (!repoUrl) return null;
  try {
    const url = new URL(repoUrl);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
    return url.pathname
      .replace(/\.git$/i, "")
      .replace(/^\/|\/$/g, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

async function localQuery<T>(sql: string, values?: unknown[]) {
  const { query } = await import("@/integrations/database/postgres");
  return query<T>(sql, values);
}

async function localQueryOne<T>(sql: string, values?: unknown[]) {
  const { queryOne } = await import("@/integrations/database/postgres");
  return queryOne<T>(sql, values);
}

async function findProject(repositoryFullName: string) {
  const rows = (
    await localQuery<GitHubSyncProject>(
      `SELECT p.id, p.repo_url, p.branch, p.adr_path, p.git_pat, p.github_sync_enabled,
              s.secret AS github_webhook_secret, p.github_sync_last_commit, p.created_by
       FROM projects p
       LEFT JOIN github_sync_secrets s ON s.project_id = p.id
       WHERE p.github_sync_enabled = TRUE`,
    )
  ).rows;

  const matching = rows.filter(
    (project) => repositoryKey(project.repo_url) === repositoryFullName.toLowerCase(),
  );
  if (matching.length > 1) throw new Error("Repository is configured for multiple projects.");
  return matching[0] ?? null;
}

function verifySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature.slice("sha256=".length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function cloneUrl(project: GitHubSyncProject) {
  if (!project.repo_url) throw new Error("The project repository is not configured.");
  const url = new URL(project.repo_url);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("GitHub sync requires an HTTPS GitHub repository URL.");
  }
  const token = project.git_pat || process.env.GIT_PAT;
  if (token) {
    url.username = "x-access-token";
    url.password = token;
  }
  return url.toString();
}

function safeBranch(project: GitHubSyncProject) {
  const branch = project.branch?.trim() || "main";
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/")
  ) {
    throw new Error("The configured Git branch name is invalid.");
  }
  return branch;
}

function resolveAdrDirectory(repoDir: string, adrPath: string) {
  const normalized = normalizeRepositoryAdrPath(adrPath);
  if (normalized.split("/").includes("..")) {
    throw new Error("The configured ADR path must stay inside the repository.");
  }
  const root = path.resolve(repoDir);
  const candidate = path.resolve(root, normalized || ".");
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("The configured ADR path must stay inside the repository.");
  }
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `The configured ADR path "${adrPath || "/"}" does not exist in the repository.`,
    );
  }
  const realRoot = fs.realpathSync(root);
  const realCandidate = fs.realpathSync(candidate);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error("The configured ADR path must stay inside the repository.");
  }
  return realCandidate;
}

function collectMarkdownFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      result.push(...collectMarkdownFiles(entryPath));
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      result.push(entryPath);
      if (result.length > 5_000) {
        throw new Error("The repository contains too many Markdown files to sync at once.");
      }
    }
  }
  return result;
}

function normalizedFullId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function sameAdrContent(existing: TrackedAdr, parsed: ReturnType<typeof parseAdrMarkdown>) {
  const sameText =
    existing.title === parsed.title &&
    existing.context === parsed.context &&
    existing.decision === parsed.decision &&
    existing.consequences === parsed.consequences &&
    existing.alternatives === parsed.alternatives;
  if (!sameText) return false;
  if (JSON.stringify(existing.tags ?? []) !== JSON.stringify(parsed.tags)) return false;
  for (const key of [
    "api_changes",
    "workflow_changes",
    "service_changes",
    "infrastructure_changes",
    "data_model_changes",
  ]) {
    if (
      (existing.design_changes?.[key] ?? "") !==
      parsed.design_changes[key as keyof typeof parsed.design_changes]
    ) {
      return false;
    }
  }
  for (const key of ["operational", "testing", "security", "documentation", "scalability"]) {
    if (
      (existing.major_impacts?.[key] ?? "") !==
      parsed.major_impacts[key as keyof typeof parsed.major_impacts]
    ) {
      return false;
    }
  }
  return JSON.stringify(existing.references_data ?? {}) === JSON.stringify(parsed.references_data);
}

async function getSyncAuthor(project: GitHubSyncProject) {
  if (project.created_by) return project.created_by;
  const member = await localQueryOne<{ user_id: string }>(
    `SELECT user_id FROM project_members
     WHERE project_id = $1 ORDER BY (role = 'project_admin') DESC LIMIT 1`,
    [project.id],
  );
  if (member) return member.user_id;
  const admin = await localQueryOne<{ user_id: string }>(
    "SELECT user_id FROM user_roles WHERE role = 'admin' LIMIT 1",
  );
  if (admin) return admin.user_id;
  throw new Error("Add a project admin before enabling repository sync.");
}

async function getTrackedAdrs(projectId: string) {
  const result = await localQuery<TrackedAdr>(
    `SELECT id, full_id, title, status, tags, context, decision, consequences, alternatives,
            design_changes, major_impacts, references_data, repository_path, repository_deleted_at
     FROM adrs WHERE project_id = $1`,
    [projectId],
  );
  return result.rows;
}

async function insertAdr(
  project: GitHubSyncProject,
  authorId: string,
  repositoryPath: string,
  parsed: ReturnType<typeof parseAdrMarkdown>,
) {
  const inserted = await localQueryOne<{ id: string }>(
    `INSERT INTO adrs
     (project_id, title, tags, context, decision, consequences, alternatives,
      design_changes, major_impacts, references_data, author_id, status, repository_path)
     VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, 'under_review', $12)
     RETURNING id`,
    [
      project.id,
      parsed.title,
      parsed.tags,
      parsed.context,
      parsed.decision,
      parsed.consequences,
      parsed.alternatives,
      JSON.stringify(parsed.design_changes),
      JSON.stringify(parsed.major_impacts),
      JSON.stringify(parsed.references_data),
      authorId,
      repositoryPath,
    ],
  );
  if (!inserted) throw new Error(`Could not import repository ADR at ${repositoryPath}.`);
  return inserted.id;
}

async function updateTrackedAdr(
  adr: TrackedAdr,
  repositoryPath: string,
  parsed: ReturnType<typeof parseAdrMarkdown>,
  contentChanged: boolean,
) {
  const shouldReturnToReview =
    (contentChanged || adr.repository_deleted_at) &&
    (adr.status === "published" || adr.status === "approved");
  const nextStatus = shouldReturnToReview ? "under_review" : adr.status;
  const values = {
    title: parsed.title,
    tags: parsed.tags,
    context: parsed.context,
    decision: parsed.decision,
    consequences: parsed.consequences,
    alternatives: parsed.alternatives,
    design_changes: parsed.design_changes,
    major_impacts: parsed.major_impacts,
    references_data: parsed.references_data,
    repository_path: repositoryPath,
    repository_deleted_at: null,
    status: nextStatus,
  };
  await localQuery(
    `UPDATE adrs SET title = $1, tags = $2::text[], context = $3, decision = $4,
     consequences = $5, alternatives = $6, design_changes = $7::jsonb, major_impacts = $8::jsonb,
     references_data = $9::jsonb, repository_path = $10, repository_deleted_at = NULL, status = $11
     WHERE id = $12`,
    [
      values.title,
      values.tags,
      values.context,
      values.decision,
      values.consequences,
      values.alternatives,
      JSON.stringify(values.design_changes),
      JSON.stringify(values.major_impacts),
      JSON.stringify(values.references_data),
      values.repository_path,
      values.status,
      adr.id,
    ],
  );
  if (contentChanged) {
    await localQuery("DELETE FROM approvals WHERE adr_id = $1 AND decision = 'approve'", [adr.id]);
  }
}

async function syncMarkdownFile(
  project: GitHubSyncProject,
  repoDir: string,
  file: string,
  byPath: Map<string, TrackedAdr>,
  byFilename: Map<string, TrackedAdr>,
  importAuthor: string | undefined,
) {
  if (fs.statSync(file).size > 1_000_000) {
    return { outcome: "skipped" as const, importAuthor };
  }

  const parsed = parseAdrMarkdown(fs.readFileSync(file, "utf8"));
  if (
    !parsed.title.trim() ||
    !parsed.context.trim() ||
    !parsed.decision.trim() ||
    !parsed.consequences.trim()
  ) {
    return { outcome: "skipped" as const, importAuthor };
  }

  const repositoryPath = path.relative(repoDir, file).split(path.sep).join("/");
  const fileName = path.basename(file).toLowerCase();
  const existingAdr = byPath.get(repositoryPath) ?? byFilename.get(fileName);
  if (existingAdr) {
    const contentChanged = !sameAdrContent(existingAdr, parsed);
    if (
      contentChanged ||
      existingAdr.repository_path !== repositoryPath ||
      existingAdr.repository_deleted_at
    ) {
      await updateTrackedAdr(existingAdr, repositoryPath, parsed, contentChanged);
      if (
        (contentChanged || existingAdr.repository_deleted_at) &&
        (existingAdr.status === "published" || existingAdr.status === "approved")
      ) {
        existingAdr.status = "under_review";
      }
      existingAdr.repository_path = repositoryPath;
      existingAdr.repository_deleted_at = null;
      byPath.set(repositoryPath, existingAdr);
      byFilename.set(fileName, existingAdr);
      return { outcome: "updated" as const, importAuthor };
    }
    return { outcome: "unchanged" as const, importAuthor };
  }

  const authorId = importAuthor ?? (await getSyncAuthor(project));
  const adrId = await insertAdr(project, authorId, repositoryPath, parsed);
  const trackedAdr: TrackedAdr = {
    id: adrId,
    full_id: "",
    title: parsed.title,
    status: "under_review",
    tags: parsed.tags,
    context: parsed.context,
    decision: parsed.decision,
    consequences: parsed.consequences,
    alternatives: parsed.alternatives,
    design_changes: parsed.design_changes,
    major_impacts: parsed.major_impacts,
    references_data: parsed.references_data,
    repository_path: repositoryPath,
    repository_deleted_at: null,
  };
  byPath.set(repositoryPath, trackedAdr);
  byFilename.set(fileName, trackedAdr);
  return { outcome: "imported" as const, importAuthor: authorId };
}

async function archiveDeletedAdrs(adrIds: string[]) {
  if (adrIds.length === 0) return;
  await localQuery(
    "UPDATE adrs SET repository_deleted_at = now() WHERE id = ANY($1::uuid[]) AND repository_deleted_at IS NULL",
    [adrIds],
  );
}

async function updateLastCommit(projectId: string, commit: string) {
  await localQuery("UPDATE projects SET github_sync_last_commit = $1 WHERE id = $2", [
    commit,
    projectId,
  ]);
}

async function syncRepository(project: GitHubSyncProject, after: string) {
  const branch = safeBranch(project);
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "decyra-github-sync-"));
  try {
    const git = simpleGit({
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    await git.clone(cloneUrl(project), tempDirectory, ["--branch", branch, "--depth", "1"]);
    const repositoryGit = simpleGit({
      baseDir: tempDirectory,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const head = (await repositoryGit.revparse(["HEAD"])).trim();
    if (head.toLowerCase() !== after.toLowerCase()) {
      return { synced: false, reason: "stale-push" as const };
    }

    const adrDirectory = resolveAdrDirectory(tempDirectory, project.adr_path ?? "docs/adr");
    const files = collectMarkdownFiles(adrDirectory);
    if (files.length === 0) {
      throw new Error("No Markdown ADRs found; repository sync was aborted.");
    }

    const existing = await getTrackedAdrs(project.id);
    const byPath = new Map(
      existing.filter((adr) => adr.repository_path).map((adr) => [adr.repository_path!, adr]),
    );
    const byFilename = new Map(existing.map((adr) => [`${normalizedFullId(adr.full_id)}.md`, adr]));
    const seenPaths = new Set(
      files.map((file) => path.relative(tempDirectory, file).split(path.sep).join("/")),
    );
    const totals = { imported: 0, updated: 0, skipped: 0 };
    let importAuthor: string | undefined;

    await files.reduce<Promise<void>>(async (previous, file) => {
      await previous;
      const result = await syncMarkdownFile(
        project,
        tempDirectory,
        file,
        byPath,
        byFilename,
        importAuthor,
      );
      importAuthor = result.importAuthor;
      if (result.outcome === "imported") totals.imported++;
      else if (result.outcome === "updated") totals.updated++;
      else if (result.outcome === "skipped") totals.skipped++;
    }, Promise.resolve());

    const missingAdrs = existing.filter(
      (adr) =>
        adr.repository_path && !seenPaths.has(adr.repository_path) && !adr.repository_deleted_at,
    );
    await archiveDeletedAdrs(missingAdrs.map((adr) => adr.id));
    const archived = missingAdrs.length;

    await updateLastCommit(project.id, after);
    return { synced: true, ...totals, archived };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

export async function processGitHubWebhook(
  rawBody: string,
  eventType: string | null,
  signature: string | null,
) {
  if (eventType !== "push") {
    return { status: 202, body: { ok: true, skipped: "unsupported-event" } };
  }

  let payload: z.infer<typeof pushPayloadSchema>;
  try {
    payload = pushPayloadSchema.parse(JSON.parse(rawBody));
  } catch {
    return { status: 400, body: { error: "Invalid GitHub push payload." } };
  }

  const project = await findProject(payload.repository.full_name);
  if (!project?.github_webhook_secret) {
    return { status: 404, body: { error: "Repository sync is not enabled." } };
  }
  if (!verifySignature(rawBody, signature, project.github_webhook_secret)) {
    return { status: 401, body: { error: "Invalid webhook signature." } };
  }

  const expectedRef = `refs/heads/${project.branch?.trim() || "main"}`;
  if (
    payload.deleted ||
    payload.ref !== expectedRef ||
    /^0{40}$/i.test(payload.after) ||
    payload.after === project.github_sync_last_commit
  ) {
    return { status: 202, body: { ok: true, skipped: "unrelated-push" } };
  }

  const result = await syncRepository(project, payload.after);
  return { status: 200, body: { ok: true, ...result } };
}
