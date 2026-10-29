import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  requestAdrReviewService,
  revokeAdrReviewRequestService,
  submitFinalDecisionService,
  publishAdrService,
  approveAdrService,
} from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("ADR Multiple Review Requests and Blocking", () => {
  const adminUserId = "11111111-1111-1111-1111-111111111111";
  const projectAdminUserId = "22222222-2222-2222-2222-222222222222";
  const engineer1UserId = "33333333-3333-3333-3333-333333333333";
  const engineer2UserId = "44444444-4444-4444-4444-444444444444";
  const internUserId = "55555555-5555-5555-5555-555555555555";
  const outsiderUserId = "66666666-6666-6666-6666-666666666666";

  const adrId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("requestAdrReviewService", () => {
    it("successfully requests a review from a project engineer and inserts into adr_review_requests", async () => {
      let insertedRequest = false;
      let insertedTimeline = false;
      let insertedComment = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM adrs a WHERE a.id = $1")) {
          return {
            id: adrId,
            full_id: "ADR-001",
            title: "Test ADR",
            project_id: projectId,
            author_id: engineer1UserId,
            status: "under_review",
            current_version: 0,
            assigned_to: null,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          const uid = (params as any[])[0];
          if (uid === engineer1UserId || uid === engineer2UserId) {
            return { role: "engineer" };
          }
          return null;
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          const uid = (params as any[])[0];
          if (uid === engineer1UserId) return { full_name: "Engineer One", username: "eng1" };
          if (uid === engineer2UserId) return { full_name: "Engineer Two", username: "eng2" };
          return null;
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("INSERT INTO adr_review_requests")) {
          insertedRequest = true;
        }
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          insertedTimeline = true;
        }
        if (sql.includes("INSERT INTO comments")) {
          insertedComment = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await requestAdrReviewService(engineer1UserId, {
        adr_id: adrId,
        reviewer_id: engineer2UserId,
      });

      expect(res).toEqual({ ok: true });
      expect(insertedRequest).toBe(true);
      expect(insertedTimeline).toBe(true);
      expect(insertedComment).toBe(true);
    });

    it("rejects requesting review on a published ADR", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a WHERE a.id = $1")) {
          return {
            id: adrId,
            full_id: "ADR-001",
            title: "Test ADR",
            project_id: projectId,
            author_id: engineer1UserId,
            status: "published",
            current_version: 1,
          };
        }
        return null;
      });

      await expect(
        requestAdrReviewService(engineer1UserId, {
          adr_id: adrId,
          reviewer_id: engineer2UserId,
        }),
      ).rejects.toThrow("Cannot request reviews on a published or finalized ADR.");
    });

    it("rejects requesting review from an intern", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM adrs a WHERE a.id = $1")) {
          return {
            id: adrId,
            full_id: "ADR-001",
            title: "Test ADR",
            project_id: projectId,
            author_id: engineer1UserId,
            status: "under_review",
            current_version: 0,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          const uid = (params as any[])[0];
          if (uid === engineer1UserId) return { role: "engineer" };
          if (uid === internUserId) return { role: "intern" };
          return null;
        }
        return null;
      });

      await expect(
        requestAdrReviewService(engineer1UserId, {
          adr_id: adrId,
          reviewer_id: internUserId,
        }),
      ).rejects.toThrow("Interns cannot review or approve ADRs.");
    });
  });

  describe("Blocking Final Decision and Publishing while Reviews Pending", () => {
    it("blocks submitFinalDecisionService when requested reviews are pending, even for admin", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "under_review",
            author_id: engineer1UserId,
            project_id: projectId,
            full_id: "ADR-001",
            title: "Test ADR",
            current_version: 0,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return { 1: 1 };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("FROM adr_review_requests rr")) {
          return {
            rows: [
              {
                reviewer_id: engineer2UserId,
                full_name: "Engineer Two",
                username: "eng2",
              },
            ],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      await expect(
        submitFinalDecisionService(adminUserId, {
          adr_id: adrId,
          decision: "approved",
          comment: "Authoritative admin approval attempt",
        }),
      ).rejects.toThrow("Cannot make final decision: Review is still pending from requested reviewer(s): @eng2");
    });

    it("blocks publishAdrService when requested reviews are pending, even for admin", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a JOIN projects p ON p.id = a.project_id")) {
          return {
            id: adrId,
            status: "approved",
            author_id: engineer1UserId,
            project_id: projectId,
            full_id: "ADR-001",
            title: "Test ADR",
            current_version: 0,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return { 1: 1 };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("FROM adr_review_requests rr")) {
          return {
            rows: [
              {
                reviewer_id: engineer2UserId,
                full_name: "Engineer Two",
                username: "eng2",
              },
            ],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      await expect(
        publishAdrService(adminUserId, {
          adr_id: adrId,
        }),
      ).rejects.toThrow("Cannot publish ADR: Review is still pending from requested reviewer(s): @eng2");
    });
  });

  describe("Revoking Review Request & Completion", () => {
    it("allows admin or requester to revoke a review request and logs timeline event and comment", async () => {
      let requestRevoked = false;
      let timelineLogged = false;
      let commentLogged = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM adrs a WHERE a.id = $1")) {
          return {
            id: adrId,
            full_id: "ADR-001",
            title: "Test ADR",
            project_id: projectId,
            author_id: engineer1UserId,
            status: "under_review",
            current_version: 0,
            assigned_to: engineer2UserId,
          };
        }
        if (sql.includes("FROM adr_review_requests WHERE adr_id = $1 AND reviewer_id = $2")) {
          return {
            id: "req-1",
            adr_id: adrId,
            reviewer_id: engineer2UserId,
            requested_by: engineer1UserId,
            status: "pending",
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          const uid = (params as any[])[0];
          return uid === adminUserId ? { 1: 1 } : null;
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "project_admin" };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          const uid = (params as any[])[0];
          if (uid === engineer2UserId) return { full_name: "Engineer Two", username: "eng2" };
          return { full_name: "Admin User", username: "admin" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("UPDATE adr_review_requests SET status = 'revoked'")) {
          requestRevoked = true;
        }
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          timelineLogged = true;
        }
        if (sql.includes("INSERT INTO comments")) {
          commentLogged = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await revokeAdrReviewRequestService(adminUserId, {
        adr_id: adrId,
        reviewer_id: engineer2UserId,
        reason: "Reviewer is on leave, unblocking decision",
      });

      expect(res).toEqual({ ok: true });
      expect(requestRevoked).toBe(true);
      expect(timelineLogged).toBe(true);
      expect(commentLogged).toBe(true);
    });

    it("rejects unauthorized user trying to revoke someone else's review request", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM adrs a WHERE a.id = $1")) {
          return {
            id: adrId,
            full_id: "ADR-001",
            title: "Test ADR",
            project_id: projectId,
            author_id: engineer1UserId,
            status: "under_review",
            current_version: 0,
          };
        }
        if (sql.includes("FROM adr_review_requests WHERE adr_id = $1 AND reviewer_id = $2")) {
          return {
            id: "req-1",
            adr_id: adrId,
            reviewer_id: engineer2UserId,
            requested_by: engineer1UserId,
            status: "pending",
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        return null;
      });

      await expect(
        revokeAdrReviewRequestService(outsiderUserId, {
          adr_id: adrId,
          reviewer_id: engineer2UserId,
        }),
      ).rejects.toThrow("Only an admin, the review requester, the ADR author, or the reviewer can revoke this review request.");
    });

    it("marks review request completed when requested reviewer approves", async () => {
      let markedCompleted = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "under_review",
            author_id: engineer1UserId,
            project_id: projectId,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("UPDATE adr_review_requests SET status = 'completed'")) {
          markedCompleted = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await approveAdrService(engineer2UserId, {
        adr_id: adrId,
        decision: "approve",
      });

      expect(res).toEqual({ ok: true });
      expect(markedCompleted).toBe(true);
    });
  });
});
