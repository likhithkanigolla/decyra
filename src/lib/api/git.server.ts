/**
 * Git integration server module.
 * Commits and pushes a published ADR to the configured repository.
 * Supports GitHub, GitLab, and Bitbucket PAT authentication.
 */

import { simpleGit } from "simple-git";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface PushOptions {
  adr: {
    full_id: string;
    title: string;
    proj_code: string;
    repo_url: string;
    branch: string;
    adr_path: string;
    git_pat?: string | null;
  };
  markdown: string;
  publisherUserId: string;
}

/**
 * Builds an authenticated HTTPS git URL with the appropriate username/password for GitHub, GitLab, etc.
 */
export function buildAuthenticatedGitUrl(rawUrl: string, token: string): string {
  const trimmed = rawUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid repository URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS repository URLs are supported.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "github.com" || hostname.endsWith(".github.com")) {
    url.username = "x-access-token";
  } else if (hostname === "gitlab.com" || hostname.endsWith(".gitlab.com")) {
    url.username = "oauth2";
  } else {
    url.username = "x-token-auth";
  }
  url.password = token.trim();
  return url.toString();
}

export function sanitizeGitError(err: unknown, token?: string | null): Error {
  const msg = err instanceof Error ? err.message : String(err);
  let sanitized = msg;
  if (token) {
    sanitized = sanitized.split(token).join("***");
  }
  sanitized = sanitized.replace(/(https?:\/\/[^:]+:)[^@]+(@)/g, "$1***$2");
  return new Error(sanitized);
}

/**
 * Clone repo, write ADR file, commit, push, return commit hash.
 * Requires GIT_PAT env var (GitHub Personal Access Token) or project git_pat.
 */
export async function pushAdrToGit(
  opts: PushOptions,
): Promise<{ commitHash: string; repositoryPath: string }> {
  const { adr, markdown } = opts;

  const gitPat = adr.git_pat?.trim() || process.env.GIT_PAT?.trim();
  if (!gitPat) {
    throw new Error(
      "Git PAT not configured. Please configure a GitHub Personal Access Token in the project settings.",
    );
  }

  const repoUrl = buildAuthenticatedGitUrl(adr.repo_url, gitPat);
  const branch = adr.branch?.trim() || "main";

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "decyra-git-"));

  try {
    const git = simpleGit({
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    // Clone (shallow) the target branch
    await git.clone(repoUrl, tmpDir, ["--branch", branch, "--depth", "1"]);

    const repoGit = simpleGit({
      baseDir: tmpDir,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    await repoGit.addConfig("user.email", "decyra-bot@decyra.dev");
    await repoGit.addConfig("user.name", "Decyra Bot");

    const normalizedAdrPath = normalizeRepositoryAdrPath(adr.adr_path);
    if (normalizedAdrPath.split("/").includes("..")) {
      throw new Error("The configured ADR path must stay inside the repository.");
    }
    const repositoryRoot = path.resolve(tmpDir);
    const adrDir = path.resolve(repositoryRoot, normalizedAdrPath || ".");
    if (adrDir !== repositoryRoot && !adrDir.startsWith(`${repositoryRoot}${path.sep}`)) {
      throw new Error("The configured ADR path must stay inside the repository.");
    }

    // Write the ADR markdown file
    fs.mkdirSync(adrDir, { recursive: true });
    const fileName = `${adr.full_id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.md`;
    const filePath = path.join(adrDir, fileName);
    fs.writeFileSync(filePath, markdown, "utf-8");

    // Commit and push
    await repoGit.add(filePath);
    const commitMsg = `${adr.full_id}: ${adr.title}`;
    await repoGit.commit(commitMsg);
    await repoGit.push("origin", branch);

    // Get the commit hash
    const log = await repoGit.log({ maxCount: 1 });
    return {
      commitHash: log.latest?.hash ?? "unknown",
      repositoryPath: path.relative(repositoryRoot, filePath).split(path.sep).join("/"),
    };
  } catch (err: unknown) {
    throw sanitizeGitError(err, gitPat);
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignored: best-effort temp directory cleanup
    }
  }
}

export interface MigrateProjectOptions {
  project: {
    id: string;
    code: string;
    name: string;
    repo_url: string;
    branch: string;
    adr_path: string;
    git_pat: string;
  };
  adrs: Array<{
    id: string;
    full_id: string;
    title: string;
    markdown: string;
  }>;
}

/**
 * Migrates all published ADRs of a project into a new repository, branch, or folder.
 * Clones the target repo, commits all ADR markdown files, and pushes to remote.
 */
export async function migrateProjectAdrsToGit(opts: MigrateProjectOptions): Promise<{
  migratedCount: number;
  adrPaths: Array<{ id: string; repositoryPath: string }>;
  commitHash?: string;
}> {
  const { project, adrs } = opts;
  const token = project.git_pat.trim();
  const repoUrl = buildAuthenticatedGitUrl(project.repo_url, token);
  const branch = project.branch?.trim() || "main";

  const git = simpleGit({
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });

  if (adrs.length === 0) {
    try {
      await git.listRemote([repoUrl]);
      return { migratedCount: 0, adrPaths: [] };
    } catch (err: unknown) {
      throw sanitizeGitError(err, token);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "decyra-git-migrate-"));

  try {
    let branchExists = true;
    try {
      await git.clone(repoUrl, tmpDir, ["--branch", branch, "--depth", "1"]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes("Remote branch") ||
        errMsg.includes("not found") ||
        errMsg.includes("couldn't find remote ref")
      ) {
        branchExists = false;
        await git.clone(repoUrl, tmpDir, ["--depth", "1"]);
      } else {
        throw err;
      }
    }

    const repoGit = simpleGit({
      baseDir: tmpDir,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    if (!branchExists) {
      await repoGit.checkout(["-B", branch]);
    }

    await repoGit.addConfig("user.email", "decyra-bot@decyra.dev");
    await repoGit.addConfig("user.name", "Decyra Bot");

    const normalizedAdrPath = normalizeRepositoryAdrPath(project.adr_path);
    if (normalizedAdrPath.split("/").includes("..")) {
      throw new Error("The configured ADR path must stay inside the repository.");
    }
    const repositoryRoot = path.resolve(tmpDir);
    const adrDir = path.resolve(repositoryRoot, normalizedAdrPath || ".");
    if (adrDir !== repositoryRoot && !adrDir.startsWith(`${repositoryRoot}${path.sep}`)) {
      throw new Error("The configured ADR path must stay inside the repository.");
    }

    fs.mkdirSync(adrDir, { recursive: true });

    const adrPaths: Array<{ id: string; repositoryPath: string }> = [];

    for (const adr of adrs) {
      const fileName = `${adr.full_id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.md`;
      const filePath = path.join(adrDir, fileName);
      fs.writeFileSync(filePath, adr.markdown, "utf-8");
      const repositoryPath = path.relative(repositoryRoot, filePath).split(path.sep).join("/");
      adrPaths.push({ id: adr.id, repositoryPath });
    }

    await repoGit.add(".");
    const status = await repoGit.status();

    let commitHash: string | undefined;
    if (status.files.length > 0) {
      const commitMsg = `Migrate ${adrs.length} ADRs to ${normalizedAdrPath} [skip ci]`;
      await repoGit.commit(commitMsg);
      await repoGit.push("origin", branch, ["--set-upstream"]);
      const log = await repoGit.log({ maxCount: 1 });
      commitHash = log.latest?.hash;
    }

    return {
      migratedCount: adrs.length,
      adrPaths,
      commitHash,
    };
  } catch (err: unknown) {
    throw sanitizeGitError(err, token);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignored: best-effort temp directory cleanup
    }
  }
}

export interface CloneAndReadAdrsOptions {
  repoUrl: string;
  gitPat?: string | null;
  branch: string;
  adrPath: string;
}

export interface AdrFileContent {
  fileName: string;
  filePath: string;
  markdown: string;
}

export function normalizeRepositoryAdrPath(adrPath?: string | null): string {
  if (!adrPath) return "";
  let p = adrPath.trim().replaceAll("\\", "/");
  p = p.replace(/^(\.\/|\/)+/, "");
  p = p.replace(/\/+$/, "");
  if (p === "." || p === "") return "";
  return p;
}

function collectMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      files.push(...collectMarkdownFiles(fullPath));
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      files.push(fullPath);
      if (files.length > 5_000) {
        throw new Error("The repository contains too many Markdown files to import at once.");
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function resolveRepositoryAdrPath(repoDir: string, adrPath: string) {
  const normalizedPath = normalizeRepositoryAdrPath(adrPath);
  if (normalizedPath.split("/").includes("..")) {
    throw new Error("ADR path must be a directory inside the repository.");
  }

  const resolvedRepo = path.resolve(repoDir);
  const resolvedAdrPath = path.resolve(resolvedRepo, normalizedPath || ".");
  if (
    resolvedAdrPath !== resolvedRepo &&
    !resolvedAdrPath.startsWith(`${resolvedRepo}${path.sep}`)
  ) {
    throw new Error("ADR path must be a directory inside the repository.");
  }

  if (!fs.existsSync(resolvedAdrPath)) {
    throw new Error(`ADR path "${adrPath || "/"}" does not exist in the repository.`);
  }

  const realRepoPath = fs.realpathSync(resolvedRepo);
  const realAdrPath = fs.realpathSync(resolvedAdrPath);
  if (realAdrPath !== realRepoPath && !realAdrPath.startsWith(`${realRepoPath}${path.sep}`)) {
    throw new Error("ADR path must be a directory inside the repository.");
  }
  return realAdrPath;
}

export async function cloneAndReadRepositoryAdrs(
  opts: CloneAndReadAdrsOptions,
): Promise<{ files: AdrFileContent[]; skippedFiles: string[] }> {
  const { repoUrl, gitPat, branch, adrPath } = opts;
  const token = gitPat?.trim();
  const workingRepoUrl = buildAuthenticatedGitUrl(repoUrl, token);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "decyra-import-"));
  try {
    const client = simpleGit({
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    await client.clone(workingRepoUrl, tmpDir, ["--branch", branch, "--depth", "1"]);

    const resolvedDir = resolveRepositoryAdrPath(tmpDir, adrPath);
    const markdownFiles = collectMarkdownFiles(resolvedDir);
    if (markdownFiles.length === 0) {
      throw new Error(`No markdown ADR files were found in ${adrPath || "the repository root"}.`);
    }

    const files: AdrFileContent[] = [];
    const skippedFiles: string[] = [];

    for (const filePath of markdownFiles) {
      if (fs.statSync(filePath).size > 1_000_000) {
        skippedFiles.push(path.basename(filePath));
        continue;
      }
      const markdown = fs.readFileSync(filePath, "utf-8");
      files.push({
        fileName: path.basename(filePath),
        filePath,
        markdown,
      });
    }

    return { files, skippedFiles };
  } catch (err: unknown) {
    throw sanitizeGitError(err, token);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignored: best-effort temp directory cleanup
    }
  }
}
