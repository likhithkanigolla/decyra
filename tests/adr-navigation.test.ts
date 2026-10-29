import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import { getAdrService } from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("ADR Navigation Services", () => {
  const userId = "11111111-1111-1111-1111-111111111111";
  const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  const adr1 = {
    id: "aaaaaaaa-1111-aaaa-aaaa-aaaaaaaaaaaa",
    full_id: "DEC-ADR-001",
    title: "Adopt PostgreSQL",
    status: "published",
    adr_number: 1,
  };

  const adr2 = {
    id: "aaaaaaaa-2222-aaaa-aaaa-aaaaaaaaaaaa",
    full_id: "DEC-ADR-002",
    title: "Use Redis for Sessions",
    status: "under_review",
    adr_number: 2,
  };

  const adr3 = {
    id: "aaaaaaaa-3333-aaaa-aaaa-aaaaaaaaaaaa",
    full_id: "DEC-ADR-003",
    title: "Implement GraphQL Gateway",
    status: "approved",
    adr_number: 3,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupMocks(currentAdr: typeof adr1, projectAdrsList: Array<typeof adr1>) {
    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
      if (sql.includes("FROM adrs a") && sql.includes("WHERE a.id = $1")) {
        return {
          ...currentAdr,
          project_id: projectId,
          proj_id: projectId,
          proj_name: "Decyra Platform",
          proj_code: "DEC",
          required_approvals: 2,
          author_id: userId,
          author_name: "Test User",
          author_username: "testuser",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("FROM adrs a WHERE a.project_id = $1")) {
        return { rows: projectAdrsList } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return { rows: [{ role: "admin" }] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("FROM project_members WHERE project_id = $1 AND user_id = $2")) {
        return { rows: [{ role: "project_admin" }] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("FROM approvals WHERE adr_id = $1")) {
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("FROM comments WHERE adr_id = $1")) {
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("FROM adr_versions WHERE adr_id = $1")) {
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("FROM project_members WHERE project_id = $1")) {
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      }
      if (sql.includes("FROM adr_timeline_events WHERE adr_id = $1")) {
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });
  }

  it("calculates prevAdr and nextAdr for a middle ADR in sequence", async () => {
    setupMocks(adr2, [adr1, adr2, adr3]);

    const result = await getAdrService(userId, { id: adr2.id });

    expect(result.prevAdr).toEqual(adr1);
    expect(result.nextAdr).toEqual(adr3);
    expect(result.currentIndex).toBe(2);
    expect(result.totalAdrs).toBe(3);
  });

  it("sets prevAdr to null and nextAdr to second ADR when viewing the first ADR", async () => {
    setupMocks(adr1, [adr1, adr2, adr3]);

    const result = await getAdrService(userId, { id: adr1.id });

    expect(result.prevAdr).toBeNull();
    expect(result.nextAdr).toEqual(adr2);
    expect(result.currentIndex).toBe(1);
    expect(result.totalAdrs).toBe(3);
  });

  it("sets nextAdr to null and prevAdr to second ADR when viewing the last ADR", async () => {
    setupMocks(adr3, [adr1, adr2, adr3]);

    const result = await getAdrService(userId, { id: adr3.id });

    expect(result.prevAdr).toEqual(adr2);
    expect(result.nextAdr).toBeNull();
    expect(result.currentIndex).toBe(3);
    expect(result.totalAdrs).toBe(3);
  });

  it("handles a single ADR gracefully without prev or next", async () => {
    setupMocks(adr1, [adr1]);

    const result = await getAdrService(userId, { id: adr1.id });

    expect(result.prevAdr).toBeNull();
    expect(result.nextAdr).toBeNull();
    expect(result.currentIndex).toBe(1);
    expect(result.totalAdrs).toBe(1);
  });
});
