import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  saveProjectGraphLayoutService,
  updateAdrRelationshipService,
  getProjectForGraphService,
} from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("Graph Viewer & Editor Backend Services", () => {
  const adminUserId = "11111111-1111-1111-1111-111111111111";
  const memberUserId = "22222222-2222-2222-2222-222222222222";
  const outsiderUserId = "33333333-3333-3333-3333-333333333333";
  const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const adr1Id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const adr2Id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const relId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("saveProjectGraphLayoutService", () => {
    it("allows project members to save graph layout coordinates", async () => {
      let updatedSql = "";
      let updatedParams: unknown[] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE projects SET graph_layout")) {
          updatedSql = sql;
          updatedParams = params ?? [];
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const layout = {
        [adr1Id]: { x: 100, y: 150 },
        [adr2Id]: { x: 420, y: 300 },
      };

      const res = await saveProjectGraphLayoutService(memberUserId, {
        project_id: projectId,
        layout,
      });

      expect(res.ok).toBe(true);
      expect(updatedSql).toContain("UPDATE projects SET graph_layout = $1::jsonb WHERE id = $2");
      expect(JSON.parse(updatedParams[0] as string)).toEqual(layout);
      expect(updatedParams[1]).toBe(projectId);
    });

    it("rejects unauthorized users from updating graph layout", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async () => null);

      await expect(
        saveProjectGraphLayoutService(outsiderUserId, {
          project_id: projectId,
          layout: { [adr1Id]: { x: 10, y: 20 } },
        }),
      ).rejects.toThrow("Unauthorized to edit project graph layout");
    });
  });

  describe("updateAdrRelationshipService", () => {
    it("updates relationship type and parameters", async () => {
      let updatedSql = "";
      let updatedParams: unknown[] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adr_relationships WHERE id = $1")) {
          return { source_adr_id: adr1Id, target_adr_id: adr2Id };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE adr_relationships")) {
          updatedSql = sql;
          updatedParams = params ?? [];
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await updateAdrRelationshipService(memberUserId, {
        id: relId,
        rel_type: "supersedes",
        source_adr_id: adr2Id,
        target_adr_id: adr1Id,
      });

      expect(res.ok).toBe(true);
      expect(updatedSql).toContain("UPDATE adr_relationships");
      expect(updatedParams[0]).toBe("supersedes");
      expect(updatedParams[1]).toBe(adr2Id);
      expect(updatedParams[2]).toBe(adr1Id);
      expect(updatedParams[3]).toBe(relId);
    });
  });

  describe("getProjectForGraphService", () => {
    it("returns graph_layout alongside adrs and relationships", async () => {
      const mockLayout = { [adr1Id]: { x: 120, y: 240 } };

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("SELECT DISTINCT a.id, a.full_id")) {
          return {
            rows: [{ id: adr1Id, full_id: "DEC-ADR-001", title: "ADR 1", status: "published" }],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("SELECT r.id, r.source_adr_id")) {
          return {
            rows: [{ id: relId, source_adr_id: adr1Id, target_adr_id: adr2Id, rel_type: "depends_on" }],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("SELECT graph_layout FROM projects WHERE id = $1")) {
          return { graph_layout: mockLayout };
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        return null;
      });


      const res = await getProjectForGraphService(memberUserId, { project_id: projectId });

      expect(res.adrs).toHaveLength(1);
      expect(res.relationships).toHaveLength(1);
      expect(res.graph_layout).toEqual(mockLayout);
    });
  });
});
