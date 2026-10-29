import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  approveAdrService,
  revokeAdrApprovalService,
  updateAdrService,
} from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("ADR Approval & Revocation Services", () => {
  const adminUserId = "11111111-1111-1111-1111-111111111111";
  const projectAdminUserId = "22222222-2222-2222-2222-222222222222";
  const engineerUserId = "33333333-3333-3333-3333-333333333333";
  const internUserId = "44444444-4444-4444-4444-444444444444";
  const outsiderUserId = "55555555-5555-5555-5555-555555555555";
  const authorUserId = "66666666-6666-6666-6666-666666666666";

  const adrId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("approveAdrService", () => {
    it("allows platform admins to approve ADR", async () => {
      let inserted = false;
      let insertedParams: unknown[] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return { status: "under_review", author_id: authorUserId, project_id: projectId };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return { 1: 1 };
        }
        if (sql.includes("FROM project_members")) {
          return null;
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO approvals")) {
          inserted = true;
          insertedParams = params ?? [];
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await approveAdrService(adminUserId, {
        adr_id: adrId,
        decision: "approve",
        note: "Looks good to me",
      });

      expect(inserted).toBe(true);
      expect(insertedParams).toEqual([adrId, adminUserId, "approve", "Looks good to me"]);
      expect(res).toEqual({ ok: true });
    });

    it("allows project members to approve ADR", async () => {
      let inserted = false;
      let insertedParams: unknown[] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return { status: "under_review", author_id: authorUserId, project_id: projectId };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { role: "engineer" };
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO approvals")) {
          inserted = true;
          insertedParams = params ?? [];
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await approveAdrService(engineerUserId, {
        adr_id: adrId,
        decision: "approve",
      });

      expect(inserted).toBe(true);
      expect(insertedParams).toEqual([adrId, engineerUserId, "approve", null]);
      expect(res).toEqual({ ok: true });
    });

    it("rejects unauthorized users from reviewing ADR", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return { status: "under_review", author_id: authorUserId, project_id: projectId };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return null;
        return null;
      });

      await expect(
        approveAdrService(outsiderUserId, { adr_id: adrId, decision: "approve" }),
      ).rejects.toThrow("Only project members or platform admins can review ADRs.");
    });

    it("rejects interns from approving ADRs", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return { status: "under_review", author_id: authorUserId, project_id: projectId };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { role: "intern" };
        return null;
      });

      await expect(
        approveAdrService(internUserId, { adr_id: adrId, decision: "approve" }),
      ).rejects.toThrow("Interns cannot approve ADRs.");
    });

    it("rejects non-existent ADR", async () => {
      vi.spyOn(postgres, "queryOne").mockResolvedValue(null);

      await expect(
        approveAdrService(adminUserId, { adr_id: adrId, decision: "approve" }),
      ).rejects.toThrow("ADR not found.");
    });
  });

  describe("revokeAdrApprovalService", () => {
    it("deletes user approval for an under_review ADR", async () => {
      let deleteParams: unknown[] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return { status: "under_review", author_id: authorUserId, project_id: projectId };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { role: "engineer" };
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("DELETE FROM approvals WHERE adr_id = $1 AND user_id = $2")) {
          deleteParams = params ?? [];
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await revokeAdrApprovalService(engineerUserId, adrId);

      expect(deleteParams).toEqual([adrId, engineerUserId]);
      expect(res).toEqual({ ok: true, statusReverted: false });
    });

    it("reverts status from approved to under_review when an approval is revoked", async () => {
      let statusUpdated = false;
      let deleteParams: unknown[] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return { status: "approved", author_id: authorUserId, project_id: projectId };
        }
        if (sql.includes("FROM user_roles")) return { 1: 1 };
        if (sql.includes("FROM project_members")) return null;
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("DELETE FROM approvals WHERE adr_id = $1 AND user_id = $2")) {
          deleteParams = params ?? [];
        }
        if (sql.includes("UPDATE adrs SET status = 'under_review'")) {
          statusUpdated = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await revokeAdrApprovalService(adminUserId, adrId);

      expect(deleteParams).toEqual([adrId, adminUserId]);
      expect(statusUpdated).toBe(true);
      expect(res).toEqual({ ok: true, statusReverted: true });
    });

    it("rejects revocation on published ADRs", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return { status: "published", author_id: authorUserId, project_id: projectId };
        }
        if (sql.includes("FROM user_roles")) return { 1: 1 };
        return null;
      });

      await expect(revokeAdrApprovalService(adminUserId, adrId)).rejects.toThrow(
        "Cannot revoke approval for a published ADR.",
      );
    });

    it("rejects revocation by unauthorized users", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return { status: "under_review", author_id: authorUserId, project_id: projectId };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return null;
        return null;
      });

      await expect(revokeAdrApprovalService(outsiderUserId, adrId)).rejects.toThrow(
        "Only project members or platform admins can revoke approvals.",
      );
    });
  });

  describe("updateAdrService - automatic approval revocation on ADR edits", () => {
    it("revokes existing approvals when an ADR under review is updated", async () => {
      let adrUpdated = false;
      let approvalsDeleted = false;
      let deleteParams: unknown[] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "under_review",
            project_id: projectId,
            author_id: authorUserId,
            title: "Original Title",
            context: "Original Context",
            decision: "Original Decision",
            consequences: "Original Consequences",
          };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { 1: 1 };
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE adrs SET")) {
          adrUpdated = true;
        }
        if (sql.includes("DELETE FROM approvals WHERE adr_id = $1 AND decision = 'approve'")) {
          approvalsDeleted = true;
          deleteParams = params ?? [];
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await updateAdrService(authorUserId, {
        id: adrId,
        title: "Updated ADR Title",
        context: "New context after discussions",
      });

      expect(adrUpdated).toBe(true);
      expect(approvalsDeleted).toBe(true);
      expect(deleteParams).toEqual([adrId]);
      expect(res).toEqual({ ok: true, nextStatus: null });
    });

    it("reverts approved ADR to under_review and revokes approvals when edited", async () => {
      let statusSetToUnderReview = false;
      let approvalsDeleted = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "approved",
            project_id: projectId,
            author_id: authorUserId,
            title: "Original Title",
            context: "Original Context",
            decision: "Original Decision",
            consequences: "Original Consequences",
          };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { 1: 1 };
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("UPDATE adrs SET") && sql.includes("status = $")) {
          statusSetToUnderReview = true;
        }
        if (sql.includes("DELETE FROM approvals WHERE adr_id = $1 AND decision = 'approve'")) {
          approvalsDeleted = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await updateAdrService(authorUserId, {
        id: adrId,
        decision: "Updated Decision that needs fresh review",
      });

      expect(statusSetToUnderReview).toBe(true);
      expect(approvalsDeleted).toBe(true);
      expect(res).toEqual({ ok: true, nextStatus: "under_review" });
    });

    it("rejects editing a published ADR and requires supersede workflow", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "published",
            project_id: projectId,
            author_id: authorUserId,
            title: "Original Title",
            context: "Original Context",
            decision: "Original Decision",
            consequences: "Original Consequences",
            current_version: 1,
          };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { 1: 1 };
        return null;
      });

      await expect(
        updateAdrService(authorUserId, {
          id: adrId,
          context: "New context after publish",
        }),
      ).rejects.toThrow("Finalized ADRs cannot be edited or overwritten");
    });

    it("does not delete approvals when no fields are modified", async () => {
      let approvalsDeleted = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "under_review",
            project_id: projectId,
            author_id: authorUserId,
            title: "Original Title",
            context: "Original Context",
            decision: "Original Decision",
            consequences: "Original Consequences",
          };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { 1: 1 };
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("DELETE FROM approvals")) {
          approvalsDeleted = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await updateAdrService(authorUserId, {
        id: adrId,
      });

      expect(approvalsDeleted).toBe(false);
      expect(res).toEqual({ ok: true, nextStatus: null });
    });

    it("rejects unauthorized edits from non-project members", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "under_review",
            project_id: projectId,
            author_id: authorUserId,
            title: "Original Title",
            context: "Original Context",
            decision: "Original Decision",
            consequences: "Original Consequences",
          };
        }
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return null;
        return null;
      });

      await expect(
        updateAdrService(outsiderUserId, {
          id: adrId,
          title: "Malicious Edit",
        }),
      ).rejects.toThrow("Not authorized to edit this ADR");
    });
  });
});
