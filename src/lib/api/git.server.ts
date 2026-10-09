/**
 * Git integration server module.
 * Commits and pushes a published ADR to the configured repository.
 * Supports GitHub PAT authentication.
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
 * Clone repo, write ADR file, commit, push, return commit hash.
 * Requires GIT_PAT env var (GitHub Personal Access Token) or SSH.
 */
export async function pushAdrToGit(
  opts: PushOptions,
): Promise<{ commitHash: string; repositoryPath: string }> {
  const { adr, markdown } = opts;

  const gitPat = adr.git_pat || process.env.GIT_PAT;
  if (!gitPat) {
    throw new Error("Git PAT not configured. Please configure a GitHub Personal Access Token in the project settings.");
  }

  // Inject PAT into clone URL (works for HTTPS repos)
  let repoUrl = adr.repo_url;
  if (repoUrl.startsWith("https://github.com/")) {
    repoUrl = repoUrl.replace("https://", `https://${gitPat}@`);
  } else if (repoUrl.startsWith("https://")) {
    repoUrl = repoUrl.replace("https://", `https://oauth2:${gitPat}@`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "decyra-git-"));

  try {
    const git = simpleGit();

    // Clone (shallow) the target branch
    await git.clone(repoUrl, tmpDir, ["--branch", adr.branch, "--depth", "1"]);

    const repoGit = simpleGit(tmpDir);
    await repoGit.addConfig("user.email", "decyra-bot@decyra.dev");
    await repoGit.addConfig("user.name", "Decyra Bot");

    const normalizedAdrPath = (adr.adr_path || "").trim().replaceAll("\\", "/");
    if (path.posix.isAbsolute(normalizedAdrPath) || normalizedAdrPath.split("/").includes("..")) {
      throw new Error("The configured ADR path must stay inside the repository.");
    }
    const repositoryRoot = path.resolve(tmpDir);
    const adrDir = path.resolve(repositoryRoot, normalizedAdrPath);
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
    await repoGit.push("origin", adr.branch);

    // Get the commit hash
    const log = await repoGit.log({ maxCount: 1 });
    return {
      commitHash: log.latest?.hash ?? "unknown",
      repositoryPath: path.relative(repositoryRoot, filePath).split(path.sep).join("/"),
    };
  } finally {
    // Cleanup temp directory
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
