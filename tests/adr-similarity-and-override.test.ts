import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  findSimilarAdrsService,
  submitFinalDecisionService,
} from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("ADR Similarity Checking & Admin Override Rationale", () => {
  const adminUserId = "11111111-1111-1111-1111-111111111111";
  const regularUserId = "22222222-2222-2222-2222-222222222222";
  const adrId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("findSimilarAdrsService", () => {
    it("returns empty array when text contains only stop words or common boilerplate", async () => {
      vi.spyOn(postgres, "queryOne").mockResolvedValue({ 1: 1 });
      const querySpy = vi.spyOn(postgres, "query").mockResolvedValue({ rows: [] } as any);

      const res = await findSimilarAdrsService(adminUserId, {
        project_id: projectId,
        title: "The context and decision options",
        context: "This is about the system architecture and record",
      });

      expect(res).toEqual([]);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it("detects similar ADR when title has strong keyword overlap within project", async () => {
      vi.spyOn(postgres, "queryOne").mockResolvedValue({ 1: 1 });
      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return {
            rows: [
              {
                id: "adr-db-1",
                full_id: "DEC-001",
                title: "Adopt PostgreSQL Database",
                context: "PostgreSQL provides relational storage.",
                decision: "Use managed PostgreSQL.",
              },
              {
                id: "adr-ui-2",
                full_id: "DEC-002",
                title: "Frontend Styling System",
                context: "Use Tailwind and CSS modules.",
                decision: "Vanilla CSS for components.",
              },
            ],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as any;
      });

      const res = await findSimilarAdrsService(adminUserId, {
        project_id: projectId,
        title: "Migrate to PostgreSQL Database Cluster",
        context: "We need high availability PostgreSQL database infrastructure.",
      });

      expect(res.length).toBe(1);
      expect(res[0].id).toBe("adr-db-1");
      expect(res[0].full_id).toBe("DEC-001");
      expect(res[0].reason).toContain("postgresql");
    });

    it("ignores unrelated ADRs that do not meet the similarity threshold", async () => {
      vi.spyOn(postgres, "queryOne").mockResolvedValue({ 1: 1 });
      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return {
            rows: [
              {
                id: "adr-redis-1",
                full_id: "DEC-003",
                title: "Redis Session Caching",
                context: "Cache user sessions in in-memory store.",
                decision: "Deploy Redis cluster.",
              },
            ],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as any;
      });

      const res = await findSimilarAdrsService(adminUserId, {
        project_id: projectId,
        title: "Kafka Event Streaming",
        context: "Produce and consume distributed log events.",
      });

      expect(res).toEqual([]);
    });
  });

  describe("submitFinalDecisionService with personal rejection preservation", () => {
    it("preserves the admin's personal rejection vote in approvals table when final approving", async () => {
      let updatedStatus = "";
      let insertedComment = "";
      let approvalsUpdated = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs")) {
          return {
            status: "under_review",
            author_id: regularUserId,
            project_id: projectId,
            full_id: "DEC-004",
            title: "Async Worker Architecture",
            current_version: 0,
            required_approvals: 3,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return { 1: 1 };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("SELECT user_id, decision FROM approvals")) {
          // Admin personally rejected (request_changes) earlier
          return {
            rows: [
              { user_id: adminUserId, decision: "request_changes" },
              { user_id: "reviewer-1", decision: "approve" },
            ],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("UPDATE adrs SET status = $1")) {
          updatedStatus = params?.[0] as string;
        }
        if (sql.includes("INTO approvals")) {
          approvalsUpdated = true;
        }
        if (sql.includes("INSERT INTO comments")) {
          insertedComment = params?.[2] as string;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await submitFinalDecisionService(adminUserId, {
        adr_id: adrId,
        decision: "approved",
        comment: "Overriding previous concerns because business deadline requires this immediately.",
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("approved");
      expect(updatedStatus).toBe("approved");
      // Critical check: approvals table must NOT have been updated or overwritten!
      expect(approvalsUpdated).toBe(false);
      // Comment reflects override
      expect(insertedComment).toContain("Overrode Personal Rejection");
    });

    it("rejects override when mandatory rationale comment is too short (< 15 characters)", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs")) {
          return {
            status: "under_review",
            author_id: regularUserId,
            project_id: projectId,
            full_id: "DEC-005",
            title: "Message Queue",
            current_version: 0,
            required_approvals: 3,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return { 1: 1 };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("SELECT user_id, decision FROM approvals")) {
          // Only 1 approval out of 3 required -> criteria not met
          return {
            rows: [{ user_id: "reviewer-1", decision: "approve" }],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as any;
      });

      await expect(
        submitFinalDecisionService(adminUserId, {
          adr_id: adrId,
          decision: "approved",
          comment: "Short note",
        }),
      ).rejects.toThrow("at least 15 characters");
    });
  });
});
