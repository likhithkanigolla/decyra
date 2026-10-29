import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import { dashboardStatsService } from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("Dashboard Review Required Query", () => {
  const userId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies the reviewRequired SQL query excludes rejected reviews, approved reviews, and author's own ADRs", async () => {
    let capturedReviewSql = "";
    let capturedReviewParams: any[] = [];

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return null;
      }
      if (sql.includes("COUNT(*) AS count FROM comments")) {
        return { count: "0" };
      }
      if (sql.includes("COUNT(*) AS count FROM notifications")) {
        return { count: "0" };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("WHERE a.status = 'under_review'")) {
        capturedReviewSql = sql;
        capturedReviewParams = params ?? [];
        return {
          rows: [
            {
              id: "adr-1",
              full_id: "DEC-001",
              title: "Needs Review",
              status: "under_review",
              updated_at: new Date().toISOString(),
              assigned_to: null,
              current_version: 0,
              proj_name: "Decyra",
              proj_code: "DEC",
              is_assigned_to_me: false,
            },
          ],
        } as unknown as QueryResult<Record<string, unknown>>;
      }
      return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
    });

    const result = await dashboardStatsService(userId);

    expect(capturedReviewSql).toContain("WHERE a.status = 'under_review'");
    // Must exclude the author's own ADR
    expect(capturedReviewSql).toContain("a.author_id <> $1");
    // Must exclude ANY existing approval/rejection by this user (not just approve)
    expect(capturedReviewSql).toContain("NOT EXISTS (\n               SELECT 1 FROM approvals ap\n               WHERE ap.adr_id = a.id AND ap.user_id = $1\n             )");
    // Must NOT have AND ap.decision = 'approve'
    expect(capturedReviewSql).not.toContain("ap.decision = 'approve'");

    expect(result.reviewRequired).toHaveLength(1);
    expect(result.reviewRequired[0].id).toBe("adr-1");
  });
});
