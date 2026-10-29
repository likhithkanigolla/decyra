import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  publishAdrService,
  updateAdrService,
} from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("Publishing Rejected ADRs", () => {
  const adminUserId = "11111111-1111-1111-1111-111111111111";
  const projectAdminUserId = "22222222-2222-2222-2222-222222222222";
  const regularUserId = "33333333-3333-3333-3333-333333333333";
  const adrId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes an ADR with status 'rejected' when explicitly requested", async () => {
    let insertedVersionNumber = 0;
    let insertedMarkdown = "";
    let updatedAdrStatus = "";
    let updatedVersion = 0;

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs a JOIN projects p")) {
        return {
          id: adrId,
          full_id: "DEC-005",
          title: "Adopt SOAP XML Services",
          status: "under_review",
          author_id: adminUserId,
          project_id: projectId,
          proj_code: "DEC",
          proj_name: "Decyra Platform",
          repo_url: null, // No git push needed for unit test
          branch: "main",
          adr_path: "docs/adrs",
          git_pat: null,
          context: "Need integration with legacy systems.",
          decision: "Use SOAP XML protocol.",
          consequences: "High overhead.",
          alternatives: "REST with JSON.",
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return { 1: 1 };
      }
      if (sql.includes("SELECT COALESCE(MAX(version_number), 0) + 1")) {
        return { max: 1 };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("FROM approvals WHERE adr_id = $1 AND decision = 'request_changes'")) {
        return { rows: [{ 1: 1 }] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("INSERT INTO published_versions")) {
        insertedVersionNumber = params?.[1] as number;
        insertedMarkdown = params?.[2] as string;
      }
      if (sql.includes("UPDATE adrs SET status = $1, current_version = $2")) {
        updatedAdrStatus = params?.[0] as string;
        updatedVersion = params?.[1] as number;
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });

    const result = await publishAdrService(adminUserId, {
      adr_id: adrId,
      publish_as: "rejected",
    });

    expect(result.version).toBe(1);
    expect(result.status).toBe("rejected");
    expect(insertedVersionNumber).toBe(1);
    expect(updatedAdrStatus).toBe("rejected");
    expect(updatedVersion).toBe(1);
    expect(insertedMarkdown).toContain("**Status:** rejected");
    expect(insertedMarkdown).toContain("# DEC-005: Adopt SOAP XML Services");
  });

  it("automatically publishes as rejected when the ADR is in 'rejected' status", async () => {
    let updatedAdrStatus = "";
    let insertedMarkdown = "";

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs a JOIN projects p")) {
        return {
          id: adrId,
          full_id: "DEC-006",
          title: "Use XML Database",
          status: "rejected",
          author_id: projectAdminUserId,
          project_id: projectId,
          proj_code: "DEC",
          proj_name: "Decyra Platform",
          repo_url: null,
          branch: "main",
          adr_path: "docs/adrs",
          git_pat: null,
          context: "Exploring XML store.",
          decision: "Store all data in native XML.",
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return null;
      }
      if (sql.includes("SELECT role FROM project_members")) {
        return { role: "project_admin" };
      }
      if (sql.includes("SELECT COALESCE(MAX(version_number), 0) + 1")) {
        return { max: 2 };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("FROM approvals WHERE adr_id = $1 AND decision = 'request_changes'")) {
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("INSERT INTO published_versions")) {
        insertedMarkdown = params?.[2] as string;
      }
      if (sql.includes("UPDATE adrs SET status = $1, current_version = $2")) {
        updatedAdrStatus = params?.[0] as string;
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });

    const result = await publishAdrService(projectAdminUserId, {
      adr_id: adrId,
    });

    expect(result.status).toBe("rejected");
    expect(result.version).toBe(2);
    expect(updatedAdrStatus).toBe("rejected");
    expect(insertedMarkdown).toContain("**Status:** rejected");
  });

  it("automatically publishes as rejected when reviewers have rejected the ADR during review", async () => {
    let updatedAdrStatus = "";
    let insertedMarkdown = "";

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs a JOIN projects p")) {
        return {
          id: adrId,
          full_id: "DEC-007",
          title: "Use In-Memory DB in Production",
          status: "under_review",
          author_id: projectAdminUserId,
          project_id: projectId,
          proj_code: "DEC",
          proj_name: "Decyra Platform",
          repo_url: null,
          context: "Need ultra-fast responses.",
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return null;
      }
      if (sql.includes("SELECT role FROM project_members")) {
        return { role: "project_admin" };
      }
      if (sql.includes("SELECT COALESCE(MAX(version_number), 0) + 1")) {
        return { max: 1 };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      // Reviewers requested changes / rejected this ADR
      if (sql.includes("FROM approvals WHERE adr_id = $1 AND decision = 'request_changes'")) {
        return { rows: [{ id: "req-1" }] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("INSERT INTO published_versions")) {
        insertedMarkdown = params?.[2] as string;
      }
      if (sql.includes("UPDATE adrs SET status = $1, current_version = $2")) {
        updatedAdrStatus = params?.[0] as string;
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });

    const result = await publishAdrService(projectAdminUserId, {
      adr_id: adrId,
    });

    expect(result.status).toBe("rejected");
    expect(updatedAdrStatus).toBe("rejected");
    expect(insertedMarkdown).toContain("**Status:** rejected");
  });

  it("rejects non-admin non-project_admin users from publishing rejected ADRs", async () => {
    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs a JOIN projects p")) {
        return {
          id: adrId,
          full_id: "DEC-008",
          title: "Testing Unauthorized Publish",
          status: "rejected",
          author_id: regularUserId,
          project_id: projectId,
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return null;
      }
      if (sql.includes("SELECT role FROM project_members")) {
        return { role: "engineer" };
      }
      return null;
    });

    await expect(
      publishAdrService(regularUserId, {
        adr_id: adrId,
        publish_as: "rejected",
      }),
    ).rejects.toThrow("Only project admins or platform admins can publish ADRs.");
  });

  it("reverts a rejected ADR back to draft when edited", async () => {
    let updatedStatus: string | null = null;

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs WHERE id = $1")) {
        return {
          status: "rejected",
          author_id: adminUserId,
          project_id: projectId,
          title: "Initial Title",
          context: "Sample Context",
          decision: "Sample Decision",
          consequences: "Sample Consequences",
        };
      }
      if (sql.includes("user_roles")) {
        return { 1: 1 };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("UPDATE adrs SET")) {
        // Find status parameter
        if (params?.includes("draft")) {
          updatedStatus = "draft";
        }
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });

    const res = await updateAdrService(adminUserId, {
      id: adrId,
      title: "Updated Title After Rejection",
    });

    expect(res.ok).toBe(true);
    expect(res.nextStatus).toBe("draft");
    expect(updatedStatus).toBe("draft");
  });
});
