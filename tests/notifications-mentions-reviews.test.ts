import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  addCommentService,
  assignAdrReviewerService,
  resolveCommentService,
  getNotificationsService,
  markNotificationReadService,
} from "@/lib/api/decyra.functions";
import * as postgres from "@/integrations/database/postgres";

describe("Notifications, Mentions, and Review Assignment Services", () => {
  const actorUserId = "11111111-1111-1111-1111-111111111111";
  const targetUserId = "22222222-2222-2222-2222-222222222222";
  const secondTargetUserId = "33333333-3333-3333-3333-333333333333";
  const adrId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const commentId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("addCommentService with @mentions", () => {
    it("parses @mentions and creates notifications for tagged users who are project members", async () => {
      const insertedNotifications: Array<{ sql: string; params: unknown[] }> = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Database Migration Strategy", full_id: "DEC-0001", project_id: projectId, author_id: actorUserId, status: "draft" };
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("INSERT INTO comments")) {
          return { id: commentId, created_at: new Date().toISOString() };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          return { id: actorUserId, full_name: "Alice Engineer", username: "alice" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM profiles pr") && sql.includes("JOIN project_members pm")) {
          return { rows: [{ id: targetUserId, username: "bob" }] } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("INSERT INTO notifications")) {
          insertedNotifications.push({ sql, params: params ?? [] });
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await addCommentService(actorUserId, {
        adr_id: adrId,
        body: "Hello @bob, check this out",
      });

      expect(res.id).toBe(commentId);
      expect(insertedNotifications).toHaveLength(1);
      const notif = insertedNotifications[0];
      expect(notif.sql).toContain("'mention'");
      expect(notif.params[0]).toBe(targetUserId); // recipient
      expect(notif.params[1]).toBe(actorUserId);  // actor
      expect(notif.params[2]).toBe("Mentioned in DEC-0001"); // title ($3)
      expect(notif.params[3]).toContain("mentioned you"); // message ($4)
      expect(notif.params[4]).toBe(`/adrs/${adrId}`); // link ($5)
    });

    it("does not notify or resolve users who are NOT assigned to the project", async () => {
      const insertedNotifications: unknown[][] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Database Migration Strategy", full_id: "DEC-0001", project_id: projectId, author_id: actorUserId, status: "draft" };
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("INSERT INTO comments")) {
          return { id: commentId, created_at: new Date().toISOString() };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          return { id: actorUserId, full_name: "Alice", username: "alice" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM profiles pr") && sql.includes("JOIN project_members pm")) {
          // Non-member not returned by project_members join query
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("INSERT INTO notifications")) {
          insertedNotifications.push(params ?? []);
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      await addCommentService(actorUserId, {
        adr_id: adrId,
        body: "Hello @outsider, this is a private project",
      });

      expect(insertedNotifications).toHaveLength(0);
    });

    it("rejects comments from users who are not assigned to the project or admin", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Architecture Decision", full_id: "DEC-0002", project_id: projectId, author_id: "other-user", status: "under_review" };
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return null; // Not a project member
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null; // Not an admin
        }
        return null;
      });

      await expect(
        addCommentService("unauthorized-user-id", {
          adr_id: adrId,
          body: "Trying to comment without project membership",
        }),
      ).rejects.toThrow("Only project members or platform admins can comment on ADRs.");
    });

    it("does not create a notification if the author mentions themselves", async () => {
      const insertedNotifications: unknown[][] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Architecture Decision", full_id: "DEC-0002", project_id: projectId, author_id: actorUserId, status: "draft" };
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("INSERT INTO comments")) {
          return { id: commentId, created_at: new Date().toISOString() };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          return { id: actorUserId, full_name: "Alice", username: "alice" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM profiles pr") && sql.includes("JOIN project_members pm")) {
          return { rows: [{ id: actorUserId, username: "alice" }] } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("INSERT INTO notifications")) {
          insertedNotifications.push(params ?? []);
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      await addCommentService(actorUserId, {
        adr_id: adrId,
        body: "Notes for @alice self-mention",
      });

      expect(insertedNotifications).toHaveLength(0);
    });

    it("notifies multiple tagged users in a single comment", async () => {
      const insertedNotifications: unknown[][] = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Multi tag test", full_id: "DEC-0003", project_id: projectId, author_id: actorUserId, status: "draft" };
        }
        if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
          return { role: "engineer" };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("INSERT INTO comments")) {
          return { id: commentId, created_at: new Date().toISOString() };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          return { id: actorUserId, full_name: "Alice", username: "alice" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM profiles pr") && sql.includes("JOIN project_members pm")) {
          return {
            rows: [
              { id: targetUserId, username: "bob" },
              { id: secondTargetUserId, username: "carol" },
            ],
          } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("INSERT INTO notifications")) {
          insertedNotifications.push(params ?? []);
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      await addCommentService(actorUserId, {
        adr_id: adrId,
        body: "CC @bob and @carol please review",
      });

      expect(insertedNotifications).toHaveLength(2);
      const recipientIds = insertedNotifications.map((n) => n[0]);
      expect(recipientIds).toContain(targetUserId);
      expect(recipientIds).toContain(secondTargetUserId);
    });
  });

  describe("assignAdrReviewerService", () => {
    it("updates assigned_to, adds timeline event, and notifies assigned reviewer", async () => {
      let updatedAssignedTo = false;
      let timelineCommentInserted = false;
      const insertedNotifications: Array<{ sql: string; params: unknown[] }> = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Async Queue Pattern", full_id: "DEC-0004", project_id: projectId, author_id: actorUserId, status: "under_review" };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          return { id: targetUserId, full_name: "Bob Reviewer", username: "bob" };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members")) {
          return { role: "developer" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE adrs SET assigned_to = $1")) {
          updatedAssignedTo = true;
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("INSERT INTO comments")) {
          timelineCommentInserted = true;
          expect(params?.[2]).toContain("📋 Assigned @bob to review this ADR");
          return { rows: [{ id: "comment-1" }] } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("INSERT INTO notifications")) {
          insertedNotifications.push({ sql, params: params ?? [] });
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await assignAdrReviewerService(actorUserId, {
        adr_id: adrId,
        reviewer_id: targetUserId,
      });

      expect(res.ok).toBe(true);
      expect(updatedAssignedTo).toBe(true);
      expect(timelineCommentInserted).toBe(true);
      expect(insertedNotifications).toHaveLength(1);
      const notif = insertedNotifications[0];
      expect(notif.sql).toContain("'assignment'");
      expect(notif.params[0]).toBe(targetUserId);
    });

    it("handles unassignment cleanly with timeline comment", async () => {
      let unassigned = false;
      let timelineCommentInserted = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Async Queue Pattern", full_id: "DEC-0004", project_id: projectId, author_id: actorUserId, status: "under_review" };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members")) {
          return { role: "project_admin" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE adrs SET assigned_to = $1")) {
          unassigned = true;
          expect(params?.[0]).toBeNull();
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("INSERT INTO comments")) {
          timelineCommentInserted = true;
          expect(params?.[2]).toContain("📋 Unassigned reviewer from this ADR");
          return { rows: [{ id: "comment-unassigned" }] } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await assignAdrReviewerService(actorUserId, {
        adr_id: adrId,
        reviewer_id: null,
      });

      expect(res.ok).toBe(true);
      expect(unassigned).toBe(true);
      expect(timelineCommentInserted).toBe(true);
    });

    it("rejects assigning a reviewer who is NOT a project member", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Async Queue Pattern", full_id: "DEC-0004", project_id: projectId, author_id: actorUserId, status: "under_review" };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members")) {
          if (params?.[0] === actorUserId) {
            return { role: "project_admin" }; // caller is admin of project
          }
          return null; // target reviewer is NOT a member
        }
        return null;
      });

      await expect(
        assignAdrReviewerService(actorUserId, {
          adr_id: adrId,
          reviewer_id: "non-member-user-id",
        }),
      ).rejects.toThrow("Target reviewer is not a member of this project.");
    });

    it("rejects assigning an intern as reviewer", async () => {
      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
        if (sql.includes("FROM adrs a")) {
          return { id: adrId, title: "Async Queue Pattern", full_id: "DEC-0004", project_id: projectId, author_id: actorUserId, status: "under_review" };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return null;
        }
        if (sql.includes("FROM project_members")) {
          if (params?.[0] === actorUserId) {
            return { role: "project_admin" };
          }
          return { role: "intern" }; // target reviewer is intern
        }
        return null;
      });

      await expect(
        assignAdrReviewerService(actorUserId, {
          adr_id: adrId,
          reviewer_id: "intern-user-id",
        }),
      ).rejects.toThrow("Interns cannot review or approve ADRs.");
    });
  });

  describe("resolveCommentService", () => {
    it("marks comment as resolved and notifies comment author", async () => {
      let updatedComment = false;
      const insertedNotifications: Array<{ sql: string; params: unknown[] }> = [];

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM comments c")) {
          return {
            id: commentId,
            body: "Should we use PostgreSQL or Redis?",
            user_id: targetUserId, // author of comment
            adr_id: adrId,
            title: "Database Strategy",
            full_id: "DEC-0005",
            project_id: projectId,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return { 1: 1 };
        }
        if (sql.includes("FROM project_members")) {
          return { role: "project_admin" };
        }
        if (sql.includes("FROM profiles WHERE id = $1")) {
          return { id: actorUserId, full_name: "Alice Admin", username: "alice" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE comments")) {
          updatedComment = true;
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        if (sql.includes("INSERT INTO notifications")) {
          insertedNotifications.push({ sql, params: params ?? [] });
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await resolveCommentService(actorUserId, {
        comment_id: commentId,
        is_resolved: true,
      });

      expect(res.ok).toBe(true);
      expect(updatedComment).toBe(true);
      expect(insertedNotifications).toHaveLength(1);
      const notif = insertedNotifications[0];
      expect(notif.sql).toContain("'comment_resolved'");
      expect(notif.params[0]).toBe(targetUserId); // author notified
    });

    it("reopens comment when is_resolved is false", async () => {
      let reopenedComment = false;

      vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
        if (sql.includes("FROM comments c")) {
          return {
            id: commentId,
            body: "Need clarification",
            user_id: targetUserId,
            adr_id: adrId,
            title: "Database Strategy",
            full_id: "DEC-0005",
            project_id: projectId,
          };
        }
        if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
          return { 1: 1 };
        }
        if (sql.includes("FROM project_members")) {
          return { role: "project_admin" };
        }
        return null;
      });

      vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
        if (sql.includes("UPDATE comments")) {
          reopenedComment = true;
          return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await resolveCommentService(actorUserId, {
        comment_id: commentId,
        is_resolved: false,
      });

      expect(res.ok).toBe(true);
      expect(reopenedComment).toBe(true);
    });
  });

  describe("getNotificationsService and markNotificationReadService", () => {
    it("returns list of notifications and unread count", async () => {
      vi.spyOn(postgres, "query").mockImplementation(async () => {
        return {
          rows: [
            { id: "n-1", title: "Mentioned", is_read: false },
            { id: "n-2", title: "Assigned", is_read: true },
          ],
        } as unknown as QueryResult<Record<string, unknown>>;
      });

      vi.spyOn(postgres, "queryOne").mockImplementation(async () => {
        return { unread: "1" };
      });

      const res = await getNotificationsService(actorUserId);
      expect(res.notifications).toHaveLength(2);
      expect(res.unreadCount).toBe(1);
    });

    it("marks single notification as read", async () => {
      let markedSingle = false;
      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2")) {
          markedSingle = true;
          expect(params?.[0]).toBe("n-1");
          expect(params?.[1]).toBe(actorUserId);
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await markNotificationReadService(actorUserId, { id: "n-1" });
      expect(res.ok).toBe(true);
      expect(markedSingle).toBe(true);
    });

    it("marks all notifications for user as read", async () => {
      let markedAll = false;
      vi.spyOn(postgres, "query").mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE notifications SET is_read = true WHERE user_id = $1")) {
          markedAll = true;
          expect(params?.[0]).toBe(actorUserId);
        }
        return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
      });

      const res = await markNotificationReadService(actorUserId, { all: true });
      expect(res.ok).toBe(true);
      expect(markedAll).toBe(true);
    });
  });
});
