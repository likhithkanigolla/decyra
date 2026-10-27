import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAuthenticatedGitUrl,
  pushAdrToGit,
  sanitizeGitError,
  normalizeRepositoryAdrPath,
} from "@/lib/api/git.server";

describe("git.server URL authentication and push", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("builds authenticated URL for GitHub with x-access-token and PAT", () => {
    const url = buildAuthenticatedGitUrl(
      "https://github.com/likhithkanigolla/test-adr.git",
      "ghp_testToken123456",
    );
    expect(url).toBe(
      "https://x-access-token:ghp_testToken123456@github.com/likhithkanigolla/test-adr.git",
    );
  });

  it("builds authenticated URL for GitLab with oauth2 and PAT", () => {
    const url = buildAuthenticatedGitUrl(
      "https://gitlab.com/group/project.git",
      "glpat-abcdef123456",
    );
    expect(url).toBe("https://oauth2:glpat-abcdef123456@gitlab.com/group/project.git");
  });

  it("builds authenticated URL for other providers with x-token-auth", () => {
    const url = buildAuthenticatedGitUrl("https://bitbucket.org/team/repo.git", "bbpat_123456");
    expect(url).toBe("https://x-token-auth:bbpat_123456@bitbucket.org/team/repo.git");
  });

  it("rejects non-HTTPS URLs", () => {
    expect(() => buildAuthenticatedGitUrl("http://github.com/user/repo.git", "token")).toThrow(
      "Only HTTPS repository URLs are supported.",
    );
    expect(() => buildAuthenticatedGitUrl("git@github.com:user/repo.git", "token")).toThrow(
      "Invalid repository URL.",
    );
  });

  it("throws clear error when git PAT is not configured", async () => {
    delete process.env.GIT_PAT;
    await expect(
      pushAdrToGit({
        adr: {
          full_id: "ADR-001",
          title: "Architecture Decision",
          proj_code: "PRJ",
          repo_url: "https://github.com/org/repo.git",
          branch: "main",
          adr_path: "docs/adr",
          git_pat: null,
        },
        markdown: "# Title",
        publisherUserId: "user-1",
      }),
    ).rejects.toThrow("Git PAT not configured");
  });

  it("sanitizes PAT from error messages", () => {
    const sensitiveToken = "ghp_secretTokenToRedact999";
    const rawError = new Error(
      `fatal: unable to access 'https://x-access-token:${sensitiveToken}@github.com/org/repo.git': The requested URL returned error: 403`,
    );

    const sanitized = sanitizeGitError(rawError, sensitiveToken);
    expect(sanitized.message).not.toContain(sensitiveToken);
    expect(sanitized.message).toContain("***");
    expect(sanitized.message).toContain("https://x-access-token:***@github.com");
  });

  describe("normalizeRepositoryAdrPath", () => {
    it("normalizes root paths correctly to empty string", () => {
      expect(normalizeRepositoryAdrPath("")).toBe("");
      expect(normalizeRepositoryAdrPath("/")).toBe("");
      expect(normalizeRepositoryAdrPath("./")).toBe("");
      expect(normalizeRepositoryAdrPath(".")).toBe("");
      expect(normalizeRepositoryAdrPath(null)).toBe("");
      expect(normalizeRepositoryAdrPath(undefined)).toBe("");
    });

    it("normalizes subdirectories with or without leading/trailing slashes", () => {
      expect(normalizeRepositoryAdrPath("docs/adr")).toBe("docs/adr");
      expect(normalizeRepositoryAdrPath("/docs/adr")).toBe("docs/adr");
      expect(normalizeRepositoryAdrPath("docs/adr/")).toBe("docs/adr");
      expect(normalizeRepositoryAdrPath("/docs/adr/")).toBe("docs/adr");
      expect(normalizeRepositoryAdrPath("./docs/adr/")).toBe("docs/adr");
      expect(normalizeRepositoryAdrPath("adr")).toBe("adr");
      expect(normalizeRepositoryAdrPath("/adr/")).toBe("adr");
    });
  });
});
