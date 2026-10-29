import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  recordAdrTimelineEvent,
  updateAdrService,
  assignAdrReviewerService,
  resolveCommentService,
} from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("ADR Timeline & Edit History Tracking", () => {
  const userId = "11111111-1111-1111-1111-111111111111";
  const reviewerId = "22222222-2222-2222-2222-222222222222";
  const adrId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("recordAdrTimelineEvent", () => {
    it("inserts event into adr_timeline_events", async () => {
      let insertedSql = "";
      let insertedParams: unknown[] = [];

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          insertedSql = sql;
          insertedParams = params ?? [];
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      await recordAdrTimelineEvent({
        adr_id: adrId,
        user_id: userId,
        event_type: "edited",
        summary: "Edited Decision, Context",
        changes: { changed_fields: ["Decision", "Context"] },
      });

      expect(insertedSql).toContain("INSERT INTO adr_timeline_events");
      expect(insertedParams[0]).toBe(adrId);
      expect(insertedParams[1]).toBe(userId);
      expect(insertedParams[2]).toBe("edited");
      expect(insertedParams[3]).toBe("Edited Decision, Context");
      expect(JSON.parse(insertedParams[4] as string)).toEqual({
        changed_fields: ["Decision", "Context"],
      });
    });
  });

  describe("updateAdrService timeline tracking", () => {
    it("detects changed fields and logs an edited timeline event", async () => {
      const timelineEvents: Array<{ sql: string; params: unknown[] }> = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "draft",
            project_id: projectId,
            author_id: userId,
            title: "Original Title",
            context: "Original Context",
            decision: "Original Decision",
            consequences: "Original Consequences",
            tags: ["v1"],
            alternatives: "Old alternatives",
            design_changes: {},
            major_impacts: {},
            references_data: {},
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role='admin'")) {
          return { 1: 1 };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          timelineEvents.push({ sql, params: params ?? [] });
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await updateAdrService(userId, {
        id: adrId,
        title: "Updated Title",
        decision: "New Architectural Decision",
        tags: ["v1", "v2"],
      });

      expect(res.ok).toBe(true);
      expect(timelineEvents).toHaveLength(1);
      const event = timelineEvents[0];
      expect(event.params[0]).toBe(adrId);
      expect(event.params[1]).toBe(userId);
      expect(event.params[2]).toBe("edited");
      expect(event.params[3]).toBe("Edited Title, Decision, Tags");

      const changes = JSON.parse(event.params[4] as string);
      expect(changes.changed_fields).toEqual(["Title", "Decision", "Tags"]);
      expect(changes.previous_status).toBe("draft");
      expect(changes.next_status).toBe("draft");
    });

    it("resets status to under_review if approved ADR is updated and logs status change", async () => {
      const timelineEvents: Array<{ sql: string; params: unknown[] }> = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "approved",
            project_id: projectId,
            author_id: userId,
            title: "Approved ADR",
            context: "Old context",
            decision: "Old decision",
            consequences: "Old consequences",
            tags: [],
            alternatives: "",
            design_changes: {},
            major_impacts: {},
            references_data: {},
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role='admin'")) {
          return { 1: 1 };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          timelineEvents.push({ sql, params: params ?? [] });
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await updateAdrService(userId, {
        id: adrId,
        context: "New updated context",
      });

      expect(res.ok).toBe(true);
      expect(res.nextStatus).toBe("under_review");
      expect(timelineEvents).toHaveLength(1);
      const changes = JSON.parse(timelineEvents[0].params[4] as string);
      expect(changes.changed_fields).toEqual(["Context"]);
      expect(changes.previous_status).toBe("approved");
      expect(changes.next_status).toBe("under_review");
    });

    it("does not create edited timeline event or revoke approvals when content has not changed", async () => {
      const timelineEvents: Array<{ sql: string; params: unknown[] }> = [];
      let deletedApprovals = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "draft",
            project_id: projectId,
            author_id: userId,
            title: "Original Title",
            context: "Original Context\n",
            decision: "Original Decision",
            consequences: "Original Consequences",
            tags: ["v1"],
            alternatives: null,
            design_changes: null,
            major_impacts: null,
            references_data: null,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role='admin'")) {
          return { 1: 1 };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          timelineEvents.push({ sql, params: params ?? [] });
        }
        if (sql.includes("DELETE FROM approvals")) {
          deletedApprovals = true;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      // User submits the form where unchanged fields submit empty default objects and nulls
      const res = await updateAdrService(userId, {
        id: adrId,
        title: "Original Title",
        context: "Original Context\r\n",
        decision: "Original Decision",
        consequences: "Original Consequences",
        alternatives: "",
        tags: ["v1"],
        design_changes: {
          api_changes: "",
          workflow_changes: "",
          service_changes: "",
          infrastructure_changes: "",
          data_model_changes: "",
        },
        major_impacts: {
          operational: "",
          testing: "",
          security: "",
          documentation: "",
          scalability: "",
        },
        references_data: {
          pull_requests: [],
          git_commits: [],
          design_docs: [],
          wiki_pages: [],
          external: [],
        },
      });

      expect(res.ok).toBe(true);
      expect(timelineEvents).toHaveLength(0);
      expect(deletedApprovals).toBe(false);
    });

    it("only marks the truly modified section without assigning empty sections", async () => {
      const timelineEvents: Array<{ sql: string; params: unknown[] }> = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs WHERE id = $1")) {
          return {
            status: "draft",
            project_id: projectId,
            author_id: userId,
            title: "Original Title",
            context: "Original Context",
            decision: "Original Decision",
            consequences: "Original Consequences",
            tags: ["v1"],
            alternatives: null,
            design_changes: null,
            major_impacts: null,
            references_data: null,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role='admin'")) {
          return { 1: 1 };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          timelineEvents.push({ sql, params: params ?? [] });
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      // User ONLY changed Decision
      const res = await updateAdrService(userId, {
        id: adrId,
        title: "Original Title",
        context: "Original Context",
        decision: "Updated Decision with new caching layer",
        consequences: "Original Consequences",
        alternatives: "",
        tags: ["v1"],
        design_changes: {
          api_changes: "",
          workflow_changes: "",
          service_changes: "",
          infrastructure_changes: "",
          data_model_changes: "",
        },
        major_impacts: {
          operational: "",
          testing: "",
          security: "",
          documentation: "",
          scalability: "",
        },
        references_data: {
          pull_requests: [],
          git_commits: [],
          design_docs: [],
          wiki_pages: [],
          external: [],
        },
      });

      expect(res.ok).toBe(true);
      expect(timelineEvents).toHaveLength(1);
      const changes = JSON.parse(timelineEvents[0].params[4] as string);
      // MUST ONLY be Decision! No false "Design Changes", "Major Impacts", "References", "Alternatives"
      expect(changes.changed_fields).toEqual(["Decision"]);
      expect(timelineEvents[0].params[3]).toBe("Edited Decision");
    });
  });

  describe("assignAdrReviewerService timeline tracking", () => {
    it("records reviewer assignment timeline event", async () => {
      const timelineEvents: Array<{ sql: string; params: unknown[] }> = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM adrs a")) {
          return {
            id: adrId,
            title: "ADR to review",
            author_id: userId,
            project_id: projectId,
            assigned_to: null,
          };
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          if (params?.[0] === reviewerId) {
            return { full_name: "Jane Reviewer", username: "janer" };
          }
          return { full_name: "John Author", username: "johna" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          timelineEvents.push({ sql, params: params ?? [] });
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await assignAdrReviewerService(userId, {
        adr_id: adrId,
        reviewer_id: reviewerId,
      });

      expect(res.ok).toBe(true);
      expect(timelineEvents).toHaveLength(1);
      const event = timelineEvents[0];
      expect(event.params[2]).toBe("reviewer_assigned");
      expect(event.params[3]).toBe("Assigned @janer to review this ADR");
    });
  });

  describe("resolveCommentService timeline tracking", () => {
    it("records comment resolution timeline event", async () => {
      const timelineEvents: Array<{ sql: string; params: unknown[] }> = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM comments c")) {
          return {
            id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            adr_id: adrId,
            user_id: reviewerId,
            body: "Need to clarify memory usage",
            project_id: projectId,
            adr_author_id: userId,
            adr_title: "ADR Title",
          };
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          return { full_name: "John Author", username: "johna" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO adr_timeline_events")) {
          timelineEvents.push({ sql, params: params ?? [] });
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await resolveCommentService(userId, {
        comment_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        is_resolved: true,
      });

      expect(res.ok).toBe(true);
      expect(timelineEvents).toHaveLength(1);
      expect(timelineEvents[0].params[2]).toBe("comment_resolved");
      expect(timelineEvents[0].params[3]).toBe('Marked comment as resolved: "Need to clarify memory usage"');
    });
  });
});
