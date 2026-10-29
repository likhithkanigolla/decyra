import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  publishAdrService,
  updateAdrService,
  submitFinalDecisionService,
  addCommentService,
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

  it("submits an admin final approved decision and records timeline and comment", async () => {
    let updatedStatus = "";
    let insertedComment = "";
    let recordedEvent: any = null;

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs WHERE id = $1")) {
        return {
          id: adrId,
          full_id: "DEC-010",
          title: "Microfrontends Architecture",
          status: "under_review",
          author_id: regularUserId,
          project_id: projectId,
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return { 1: 1 };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("UPDATE adrs SET status = $1")) {
        updatedStatus = params?.[0] as string;
      }
      if (sql.includes("INSERT INTO comments")) {
        insertedComment = params?.[2] as string;
      }
      if (sql.includes("INSERT INTO adr_timeline_events")) {
        recordedEvent = {
          eventType: params?.[2],
          summary: params?.[3],
        };
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });

    const res = await submitFinalDecisionService(adminUserId, {
      adr_id: adrId,
      decision: "approved",
      comment:
        "Approved by Root Admin after reviewing team concerns and evaluating architecture. This decision unblocks the core infrastructure milestone while addressing all team trade-offs and operational dependencies as scheduled in our technical roadmap and operational readiness review documentation for the upcoming platform release cycle.",
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("approved");
    expect(updatedStatus).toBe("approved");
    expect(insertedComment).toContain("🏛️ [Admin Final Approval] Approved by Root Admin");
    expect(recordedEvent.eventType).toBe("final_approved");
    expect(recordedEvent.summary).toContain("Final Approved by Platform Admin");
  });

  it("submits an admin final rejected decision and records timeline and comment", async () => {
    let updatedStatus = "";
    let insertedComment = "";

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs WHERE id = $1")) {
        return {
          id: adrId,
          full_id: "DEC-011",
          title: "Deprecated Framework",
          status: "under_review",
          author_id: regularUserId,
          project_id: projectId,
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return null;
      }
      if (sql.includes("SELECT role FROM project_members")) {
        return { role: "project_admin" };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("UPDATE adrs SET status = $1")) {
        updatedStatus = params?.[0] as string;
      }
      if (sql.includes("INSERT INTO comments")) {
        insertedComment = params?.[2] as string;
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });

    const res = await submitFinalDecisionService(projectAdminUserId, {
      adr_id: adrId,
      decision: "rejected",
      comment: "Rejected by Project Admin due to performance overhead.",
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("rejected");
    expect(updatedStatus).toBe("rejected");
    expect(insertedComment).toContain("🏛️ [Admin Final Rejection]");
  });

  it("records timeline reference event when an ADR is referenced using # in comments", async () => {
    const referencedAdrId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    let referencedEventRecorded = false;

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs a JOIN projects p")) {
        return {
          id: adrId,
          full_id: "DEC-020",
          title: "New Auth Service",
          status: "under_review",
          author_id: regularUserId,
          project_id: projectId,
          proj_name: "Decyra Platform",
        };
      }
      if (sql.includes("SELECT role FROM project_members")) {
        return { role: "engineer" };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return null;
      }
      if (sql.includes("INSERT INTO comments")) {
        return {
          id: "comment-1",
          created_at: new Date().toISOString(),
        };
      }
      if (sql.includes("FROM profiles WHERE id = $1")) {
        return { full_name: "Alice Reviewer", username: "alice" };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("SELECT id, full_id, title FROM adrs WHERE project_id = $1 AND UPPER(full_id) = ANY")) {
        return {
          rows: [{ id: referencedAdrId, full_id: "DEC-001", title: "Original Auth Architecture" }],
        } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("INSERT INTO adr_timeline_events") && params?.[0] === referencedAdrId) {
        referencedEventRecorded = true;
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });

    const comment = await addCommentService(regularUserId, {
      adr_id: adrId,
      body: "Please see #DEC-001 for background architecture before proceeding.",
    });

    expect(comment.id).toBe("comment-1");
    expect(referencedEventRecorded).toBe(true);
  });

  it("rejects overriding a finalized ADR with an admin decision", async () => {
    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs WHERE id = $1")) {
        return {
          status: "rejected",
          author_id: regularUserId,
          project_id: projectId,
          full_id: "DEC-004",
          title: "Tenant Migration",
          current_version: 3,
        };
      }
      return null;
    });

    await expect(
      submitFinalDecisionService(adminUserId, {
        adr_id: adrId,
        decision: "approved",
      }),
    ).rejects.toThrow("This ADR has already been finalized/published and cannot be overridden");
  });

  it("rejects republishing an already published ADR", async () => {
    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs a JOIN projects p")) {
        return {
          id: adrId,
          status: "rejected",
          author_id: regularUserId,
          project_id: projectId,
          full_id: "DEC-004",
          title: "Tenant Migration",
          current_version: 3,
          proj_code: "DEC",
          proj_name: "Decyra",
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return { 1: 1 };
      }
      return null;
    });

    await expect(
      publishAdrService(adminUserId, {
        adr_id: adrId,
        publish_as: "rejected",
      }),
    ).rejects.toThrow("This ADR has already been published. A finalized ADR cannot be republished or overwritten");
  });
});
