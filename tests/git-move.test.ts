import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import simpleGit from "simple-git";
import * as gitServer from "@/lib/api/git.server";

describe("Git Directory Migration: Move vs Copy", () => {
  let remoteDir: string;

  beforeEach(async () => {
    vi.restoreAllMocks();

    // Create a local bare git repo to act as the "remote"
    remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "decyra-git-remote-"));
    const gitRemote = simpleGit(remoteDir);
    await gitRemote.init(true);

    // Create an initial clone to seed files and commit to master
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), "decyra-git-seed-"));
    const seedGit = simpleGit(seedDir);
    await seedGit.init();
    await seedGit.addConfig("user.email", "test@decyra.dev");
    await seedGit.addConfig("user.name", "Decyra Test");
    await seedGit.checkout(["-b", "master"]);

    // Put an old ADR at docs/adrs/dec-0001.md
    const oldAdrDir = path.join(seedDir, "docs", "adrs");
    fs.mkdirSync(oldAdrDir, { recursive: true });
    fs.writeFileSync(
      path.join(oldAdrDir, "dec-0001.md"),
      "# DEC-0001: Initial Architecture Decision\n\nContent here.",
      "utf-8"
    );

    await seedGit.add("-A");
    await seedGit.commit("Initial commit with old ADR path");
    await seedGit.addRemote("origin", remoteDir);
    await seedGit.push("origin", "master", ["-u"]);

    fs.rmSync(seedDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(remoteDir)) {
      fs.rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  it("moves ADR files to the new directory without duplicating them", async () => {
    vi.spyOn(gitServer, "buildAuthenticatedGitUrl").mockReturnValue(remoteDir);

    const opts = {
      project: {
        id: "proj-1",
        code: "DEC",
        repo_url: `file://${remoteDir}`,
        git_pat: "fake_token_12345",
        branch: "master",
        adr_path: "architecture/decisions",
        old_adr_path: "docs/adrs",
      },
      adrs: [
        {
          id: "adr-1",
          full_id: "DEC-0001",
          markdown: "# DEC-0001: Updated Architecture Decision\n\nMigrated content.",
          old_repository_path: "docs/adrs/dec-0001.md",
        },
      ],
    };

    const result = await gitServer.migrateProjectAdrsToGit(opts);

    expect(result.migratedCount).toBe(1);
    expect(result.adrPaths).toEqual([
      { id: "adr-1", repositoryPath: "architecture/decisions/dec-0001.md" },
    ]);

    // Clone the updated remote to inspect file tree and git history
    const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "decyra-verify-"));
    const verifyGit = simpleGit(verifyDir);
    await verifyGit.clone(remoteDir, verifyDir, ["--branch", "master"]);

    const oldFilePath = path.join(verifyDir, "docs", "adrs", "dec-0001.md");
    const newFilePath = path.join(verifyDir, "architecture", "decisions", "dec-0001.md");

    // Old file MUST be removed (moved, not copied)
    expect(fs.existsSync(oldFilePath)).toBe(false);
    // New file MUST exist
    expect(fs.existsSync(newFilePath)).toBe(true);
    expect(fs.readFileSync(newFilePath, "utf-8")).toContain("Migrated content.");

    // Clean up
    fs.rmSync(verifyDir, { recursive: true, force: true });
  });
});
