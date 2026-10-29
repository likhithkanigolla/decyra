import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import { updateProjectService, migrateAdrsFromRepositoryService } from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";
import * as gitServer from "@/lib/api/git.server";

describe("updateProjectService - Git token validation and ADR repository migration", () => {
  const userId = "11111111-1111-1111-1111-111111111111";
  const projectId = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws mandatory git token error when git_pat is undefined", async () => {
    await expect(
      updateProjectService(userId, {
        id: projectId,
        name: "Renamed Project",
      }),
    ).rejects.toThrow("Editing project info requires the git token is mandatory.");
  });

  it("throws mandatory git token error when git_pat is null or empty string or whitespace", async () => {
    await expect(
      updateProjectService(userId, {
        id: projectId,
        name: "Renamed Project",
        git_pat: null,
      }),
    ).rejects.toThrow("Editing project info requires the git token is mandatory.");

    await expect(
      updateProjectService(userId, {
        id: projectId,
        name: "Renamed Project",
        git_pat: "   ",
      }),
    ).rejects.toThrow("Editing project info requires the git token is mandatory.");
  });

  it("throws permission error if user is neither admin nor project admin", async () => {
    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM user_roles")) return null;
      if (sql.includes("FROM project_members")) return null;
      return null;
    });

    await expect(
      updateProjectService(userId, {
        id: projectId,
        name: "Renamed Project",
        git_pat: "ghp_validToken123",
      }),
    ).rejects.toThrow("Only admins or project admins can edit projects.");
  });

  it("updates project without triggering migration if git details did not change", async () => {
    const existingProject = {
      id: projectId,
      name: "Original Name",
      description: "Original Description",
      repo_url: "https://github.com/org/repo.git",
      branch: "main",
      adr_path: "docs/adr",
      git_pat: "ghp_oldToken",
    };

    const queryOneSpy = vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM user_roles")) return { 1: 1 };
      if (sql.includes("FROM projects WHERE id = $1")) return existingProject;
      if (sql.includes("UPDATE projects SET")) {
        return {
          ...existingProject,
          name: "Updated Name",
          description: "New description",
          git_pat: "ghp_newToken123",
        };
      }
      return null;
    });

    const migrateSpy = vi.spyOn(gitServer, "migrateProjectAdrsToGit");

    const result = await updateProjectService(userId, {
      id: projectId,
      name: "Updated Name",
      description: "New description",
      repo_url: "https://github.com/org/repo.git",
      branch: "main",
      adr_path: "docs/adr",
      git_pat: "ghp_newToken123",
    });

    expect(migrateSpy).not.toHaveBeenCalled();
    expect(result.name).toBe("Updated Name");
    expect(result.git_pat).toBeUndefined(); // git_pat stripped before returning

    queryOneSpy.mockRestore();
  });

  it("triggers complete migration when git repo, branch, or folder changes", async () => {
    const existingProject = {
      id: projectId,
      name: "Decyra Service",
      description: "Service ADRs",
      repo_url: "https://github.com/old-org/old-repo.git",
      branch: "main",
      adr_path: "docs/adr",
      git_pat: "ghp_oldToken",
    };

    const publishedAdrs = [
      {
        id: "33333333-3333-3333-3333-333333333333",
        full_id: "ADR-001",
        title: "Use PostgreSQL",
        status: "published",
        proj_code: "DEC",
        latest_markdown: "# ADR-001: Use PostgreSQL\n\nDecision content",
      },
      {
        id: "44444444-4444-4444-4444-444444444444",
        full_id: "ADR-002",
        title: "Adopt TanStack Start",
        status: "published",
        proj_code: "DEC",
        latest_markdown: "# ADR-002: Adopt TanStack Start\n\nDecision content",
      },
    ];

    const updatedProjectRecord = {
      ...existingProject,
      repo_url: "https://github.com/new-org/new-repo.git",
      branch: "develop",
      adr_path: "architecture/decisions",
      git_pat: "ghp_migrationToken999",
    };

    const executedSqlQueries: string[] = [];

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      executedSqlQueries.push(sql);
      if (sql.includes("FROM user_roles")) return { 1: 1 };
      if (sql.includes("FROM projects WHERE id = $1")) return existingProject;
      if (sql.includes("UPDATE projects SET")) return updatedProjectRecord;
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
      executedSqlQueries.push(sql);
      if (sql.includes("SELECT a.*, p.code AS proj_code")) {
        return { rows: publishedAdrs } as unknown as QueryResult;
      }
      return { rows: [] } as unknown as QueryResult;
    });

    const migrateSpy = vi.spyOn(gitServer, "migrateProjectAdrsToGit").mockResolvedValue({
      migratedCount: 2,
      adrPaths: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          repositoryPath: "architecture/decisions/adr-001.md",
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          repositoryPath: "architecture/decisions/adr-002.md",
        },
      ],
      commitHash: "c0ffee1234567890",
    });

    const result = await updateProjectService(userId, {
      id: projectId,
      name: "Decyra Service",
      repo_url: "https://github.com/new-org/new-repo.git",
      branch: "develop",
      adr_path: "architecture/decisions",
      git_pat: "ghp_migrationToken999",
    });

    expect(migrateSpy).toHaveBeenCalledTimes(1);
    expect(migrateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({
          repo_url: "https://github.com/new-org/new-repo.git",
          branch: "develop",
          adr_path: "architecture/decisions",
          git_pat: "ghp_migrationToken999",
          old_adr_path: "docs/adr",
        }),
        adrs: expect.arrayContaining([
          expect.objectContaining({
            id: "33333333-3333-3333-3333-333333333333",
            full_id: "ADR-001",
            markdown: "# ADR-001: Use PostgreSQL\n\nDecision content",
          }),
          expect.objectContaining({
            id: "44444444-4444-4444-4444-444444444444",
            full_id: "ADR-002",
            markdown: "# ADR-002: Adopt TanStack Start\n\nDecision content",
          }),
        ]),
      }),
    );

    const updateAdrQueries = executedSqlQueries.filter((q) =>
      q.includes("UPDATE adrs SET repository_path = $1"),
    );
    expect(updateAdrQueries).toHaveLength(2);

    expect(result.repo_url).toBe("https://github.com/new-org/new-repo.git");
    expect(result.branch).toBe("develop");
    expect(result.adr_path).toBe("architecture/decisions");
    expect(result.git_pat).toBeUndefined();
  });

  it("migrateProjectAdrsToGit rejects path escaping repository root", async () => {
    await expect(
      gitServer.migrateProjectAdrsToGit({
        project: {
          repo_url: "https://github.com/org/repo.git",
          branch: "main",
          adr_path: "../../etc",
          git_pat: "ghp_token",
        },
        adrs: [
          {
            id: "1",
            full_id: "ADR-001",
            markdown: "# Test",
          },
        ],
      }),
    ).rejects.toThrow();
  });

  describe("migrateAdrsFromRepositoryService - [Project code-ADR-XXX] format and root ADR path", () => {
    it("imports only ADRs matching [Project code-ADR-XXX] and skips non-ADR or mismatched files", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM projects")) {
          return {
            id: projectId,
            code: "DEC",
            repo_url: "https://github.com/org/repo.git",
            branch: "main",
            adr_path: "/",
            git_pat: "ghp_token",
          };
        }
        if (sql.includes("FROM user_roles")) return { 1: 1 };
        if (sql.includes("FROM adrs")) return null; // no existing duplicate
        return null;
      });

      const insertedRows: Array<Record<string, unknown>> = [];
      vi.spyOn(postgres, "query").mockImplementation(async (_sql, _params) => {
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      vi.spyOn(gitServer, "cloneAndReadRepositoryAdrs").mockResolvedValue({
        files: [
          {
            fileName: "README.md",
            filePath: "/tmp/README.md",
            markdown:
              "# My Project\n\n## Context\nSome text\n\n## Decision\nSome decision\n\n## Consequences\nSome text",
          },
          {
            fileName: "other-adr-001.md",
            filePath: "/tmp/other.md",
            markdown:
              "# [OTHER-ADR-001]: Other Project\n\n## Context\nSome text\n\n## Decision\nSome decision\n\n## Consequences\nSome text",
          },
          {
            fileName: "[DEC-ADR-001].md",
            filePath: "/tmp/[DEC-ADR-001].md",
            markdown:
              "# [DEC-ADR-001]: Choose PostgreSQL\n\n## Context\nContext text\n\n## Decision\nDecision text\n\n## Consequences\nConsequences text",
          },
          {
            fileName: "dec-adr-002-react.md",
            filePath: "/tmp/dec-adr-002-react.md",
            markdown:
              "# DEC-ADR-002: Adopt React 19\n\n## Context\nContext text\n\n## Decision\nDecision text\n\n## Consequences\nConsequences text",
          },
        ],
        skippedFiles: [],
      });

      // Spy on insert
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM projects")) {
          return {
            id: projectId,
            code: "DEC",
            repo_url: "https://github.com/org/repo.git",
            branch: "main",
            adr_path: "/",
            git_pat: "ghp_token",
          };
        }
        if (sql.includes("FROM user_roles")) return { 1: 1 };
        if (sql.includes("FROM adrs")) return null;
        if (sql.includes("INSERT INTO adrs")) {
          insertedRows.push({
            title: params?.[1],
            author_id: params?.[10],
            adr_number: params?.[11],
            full_id: params?.[12],
          });
          return { id: "new-adr-id" };
        }
        return null;
      });

      const result = await migrateAdrsFromRepositoryService(userId, {
        project_id: projectId,
        adr_path: "/",
      });

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(2);
      expect(result.files).toEqual(["[DEC-ADR-001].md", "dec-adr-002-react.md"]);
      expect(result.skippedFiles).toContain("README.md");
      expect(result.skippedFiles).toContain("other-adr-001.md");

      expect(insertedRows).toEqual([
        {
          title: "Choose PostgreSQL",
          author_id: userId,
          adr_number: 1,
          full_id: "DEC-ADR-001",
        },
        {
          title: "Adopt React 19",
          author_id: userId,
          adr_number: 2,
          full_id: "DEC-ADR-002",
        },
      ]);
    });
  });
});
