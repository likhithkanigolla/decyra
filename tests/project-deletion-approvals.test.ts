import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  approveProjectDeletionService,
  revokeProjectDeletionApprovalService,
  deleteProjectService,
} from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("Project Deletion Approvals & Revocation", () => {
  const adminUserId = "11111111-1111-1111-1111-111111111111";
  const projectAdminUserId = "22222222-2222-2222-2222-222222222222";
  const engineerUserId = "33333333-3333-3333-3333-333333333333";
  const internUserId = "44444444-4444-4444-4444-444444444444";
  const outsiderUserId = "55555555-5555-5555-5555-555555555555";
  const projectId = "99999999-9999-9999-9999-999999999999";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("approveProjectDeletionService", () => {
    it("rejects unauthorized users who are neither platform admins nor project members", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return null;
        return null;
      });

      await expect(approveProjectDeletionService(outsiderUserId, projectId)).rejects.toThrow(
        "Only project members or platform admins can approve project deletion.",
      );
    });

    it("rejects interns from approving project deletion", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { role: "intern" };
        return null;
      });

      await expect(approveProjectDeletionService(internUserId, projectId)).rejects.toThrow(
        "Interns cannot approve project deletion.",
      );
    });

    it("allows platform admins to approve deletion", async () => {
      let inserted = false;
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return { 1: 1 };
        if (sql.includes("COUNT(*)")) return { count: "1" };
        return null;
      });
      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("INSERT INTO project_deletion_approvals")) {
          inserted = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const result = await approveProjectDeletionService(adminUserId, projectId);
      expect(inserted).toBe(true);
      expect(result).toEqual({ ok: true, count: 1, hasApproved: true });
    });

    it("allows project members (engineers) to approve deletion", async () => {
      let inserted = false;
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { role: "engineer" };
        if (sql.includes("COUNT(*)")) return { count: "2" };
        return null;
      });
      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("INSERT INTO project_deletion_approvals")) {
          inserted = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const result = await approveProjectDeletionService(engineerUserId, projectId);
      expect(inserted).toBe(true);
      expect(result).toEqual({ ok: true, count: 2, hasApproved: true });
    });
  });

  describe("revokeProjectDeletionApprovalService", () => {
    it("deletes user approval and returns updated count", async () => {
      let deletedParams: unknown[] = [];
      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("DELETE FROM project_deletion_approvals")) {
          deletedParams = params ?? [];
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("COUNT(*)")) return { count: "1" };
        return null;
      });

      const result = await revokeProjectDeletionApprovalService(engineerUserId, projectId);
      expect(deletedParams).toEqual([projectId, engineerUserId]);
      expect(result).toEqual({ ok: true, count: 1, hasApproved: false });
    });
  });

  describe("deleteProjectService", () => {
    it("rejects non-admin and non-project-admin users", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return null;
        return null;
      });

      await expect(deleteProjectService(engineerUserId, projectId)).rejects.toThrow(
        "Only platform admins or project admins can delete projects.",
      );
    });

    it("rejects deletion when approvals are fewer than 3", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return { 1: 1 };
        if (sql.includes("COUNT(*)")) return { count: "2" };
        return null;
      });

      await expect(deleteProjectService(adminUserId, projectId)).rejects.toThrow(
        "Deleting a project requires at least 3 approvals. Current approvals: 2/3. Please gather the required approvals before deleting.",
      );
    });

    it("rejects deletion when 0 approvals exist", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { 1: 1 };
        if (sql.includes("COUNT(*)")) return { count: "0" };
        return null;
      });

      await expect(deleteProjectService(projectAdminUserId, projectId)).rejects.toThrow(
        "Deleting a project requires at least 3 approvals. Current approvals: 0/3. Please gather the required approvals before deleting.",
      );
    });

    it("successfully deletes the project when 3 or more approvals are reached", async () => {
      let deletedProject = false;
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return { 1: 1 };
        if (sql.includes("COUNT(*)")) return { count: "3" };
        return null;
      });
      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("DELETE FROM projects WHERE id = $1")) {
          deletedProject = true;
          expect(params).toEqual([projectId]);
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const result = await deleteProjectService(adminUserId, projectId);
      expect(deletedProject).toBe(true);
      expect(result).toEqual({ ok: true });
    });

    it("allows project_admin to delete when 3 or more approvals are reached", async () => {
      let deletedProject = false;
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles")) return null;
        if (sql.includes("FROM project_members")) return { 1: 1 };
        if (sql.includes("COUNT(*)")) return { count: "4" };
        return null;
      });
      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("DELETE FROM projects WHERE id = $1")) {
          deletedProject = true;
          expect(params).toEqual([projectId]);
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const result = await deleteProjectService(projectAdminUserId, projectId);
      expect(deletedProject).toBe(true);
      expect(result).toEqual({ ok: true });
    });
  });
});
