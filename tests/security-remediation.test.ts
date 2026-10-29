import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getJwtSecret, signJwt, verifyJwt } from "@/integrations/database/local-auth.server";
import { isAllowedGitHost, buildAuthenticatedGitUrl } from "@/lib/api/git.server";
import { checkRateLimit, assertRateLimit, resetRateLimit } from "@/lib/rate-limiter";
import * as postgres from "@/integrations/database/postgres";

describe("SEC-03: JWT secret validation and verification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws in production mode if POSTGRES_JWT_SECRET is unset", () => {
    process.env.NODE_ENV = "production";
    delete process.env.POSTGRES_JWT_SECRET;
    expect(() => getJwtSecret()).toThrow("POSTGRES_JWT_SECRET environment variable must be set");
  });

  it("throws in production mode if POSTGRES_JWT_SECRET is the default fallback", () => {
    process.env.NODE_ENV = "production";
    process.env.POSTGRES_JWT_SECRET = "local-dev-jwt-secret-change-in-production";
    expect(() => getJwtSecret()).toThrow("Insecure default POSTGRES_JWT_SECRET detected in production");
  });

  it("throws in production mode if POSTGRES_JWT_SECRET is too short (< 32 chars)", () => {
    process.env.NODE_ENV = "production";
    process.env.POSTGRES_JWT_SECRET = "short-secret-123";
    expect(() => getJwtSecret()).toThrow("POSTGRES_JWT_SECRET must be at least 32 characters");
  });

  it("succeeds in production mode with a strong 32+ character secret", () => {
    process.env.NODE_ENV = "production";
    process.env.POSTGRES_JWT_SECRET = "super-secret-production-key-at-least-32-characters-long!";
    expect(getJwtSecret()).toBe("super-secret-production-key-at-least-32-characters-long!");
  });

  it("returns fallback secret safely in non-production environments", () => {
    process.env.NODE_ENV = "development";
    delete process.env.POSTGRES_JWT_SECRET;
    expect(getJwtSecret()).toBe("local-dev-jwt-secret-change-in-production");
  });

  it("signs and verifies tokens using constant-time verification", () => {
    process.env.POSTGRES_JWT_SECRET = "testing-jwt-secret-valid-token-verification-test";
    const token = signJwt({ sub: "user-1", email: "user@example.com", role: "admin" });
    const payload = verifyJwt(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-1");

    // Invalid signature rejection
    const [header, body] = token.split(".");
    const invalidToken = `${header}.${body}.invalidsignature123`;
    expect(verifyJwt(invalidToken)).toBeNull();
  });
});

describe("SEC-08: Git URL validation and SSRF prevention", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("allows standard git providers (github.com, gitlab.com, bitbucket.org)", () => {
    expect(isAllowedGitHost("github.com")).toBe(true);
    expect(isAllowedGitHost("gitlab.com")).toBe(true);
    expect(isAllowedGitHost("subdomain.gitlab.com")).toBe(true);
    expect(isAllowedGitHost("bitbucket.org")).toBe(true);
  });

  it("rejects private, loopback, and metadata IPs (SSRF targets)", () => {
    expect(isAllowedGitHost("localhost")).toBe(false);
    expect(isAllowedGitHost("127.0.0.1")).toBe(false);
    expect(isAllowedGitHost("::1")).toBe(false);
    expect(isAllowedGitHost("0.0.0.0")).toBe(false);
    expect(isAllowedGitHost("169.254.169.254")).toBe(false);
    expect(isAllowedGitHost("10.0.0.1")).toBe(false);
    expect(isAllowedGitHost("192.168.1.1")).toBe(false);
    expect(isAllowedGitHost("172.16.0.5")).toBe(false);
    expect(isAllowedGitHost("evil-host.com")).toBe(false);
  });

  it("allows enterprise hosts configured via GIT_ALLOWED_HOSTS", () => {
    process.env.GIT_ALLOWED_HOSTS = "git.internal.corp,github.enterprise.com";
    expect(isAllowedGitHost("git.internal.corp")).toBe(true);
    expect(isAllowedGitHost("github.enterprise.com")).toBe(true);
    expect(isAllowedGitHost("unapproved.com")).toBe(false);
  });

  it("rejects local file:// URLs in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_LOCAL_FILE_GIT;
    expect(() =>
      buildAuthenticatedGitUrl("file:///etc/passwd", "token123")
    ).toThrow("Local file:// repository URLs are not allowed.");
  });

  it("rejects non-HTTPS URLs", () => {
    expect(() =>
      buildAuthenticatedGitUrl("http://github.com/org/repo.git", "token123")
    ).toThrow("Only HTTPS repository URLs are supported.");
  });
});

describe("SEC-13: Rate limiter utility", () => {
  const key = "test-rate-limit-key";

  beforeEach(() => {
    resetRateLimit(key);
  });

  it("allows requests up to maxAttempts within window", () => {
    const res1 = checkRateLimit(key, 3, 5000);
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(2);

    const res2 = checkRateLimit(key, 3, 5000);
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = checkRateLimit(key, 3, 5000);
    expect(res3.allowed).toBe(true);
    expect(res3.remaining).toBe(0);

    const res4 = checkRateLimit(key, 3, 5000);
    expect(res4.allowed).toBe(false);
    expect(res4.retryAfterMs).toBeGreaterThan(0);
  });

  it("assertRateLimit throws when limit exceeded", () => {
    checkRateLimit(key, 2, 5000);
    checkRateLimit(key, 2, 5000);
    expect(() => assertRateLimit(key, 2, 5000, "testing")).toThrow(
      "Too many testing attempts"
    );
  });

  it("resetRateLimit clears tracked attempts", () => {
    checkRateLimit(key, 1, 5000);
    expect(checkRateLimit(key, 1, 5000).allowed).toBe(false);
    resetRateLimit(key);
    expect(checkRateLimit(key, 1, 5000).allowed).toBe(true);
  });
});

describe("SEC-01 & SEC-04: Authorization and Tenant Isolation", () => {
  const adminId = "admin-user-0001";
  const projectAdminId = "project-admin-0002";
  const unauthorizedUserId = "unauthorized-user-0003";
  const targetProjectId = "target-project-0001";
  const targetAdrId = "target-adr-0001";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthorized user from accessing another project's ADR (SEC-04)", async () => {
    const { getAdrService } = await import("@/lib/api/decyra.functions");

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs a")) {
        return {
          id: targetAdrId,
          project_id: targetProjectId,
          status: "published",
          title: "Confidential Arch Decision",
          author_id: "other-user",
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return null; // Not platform admin
      }
      if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
        return null; // Not a project member
      }
      return null;
    });

    await expect(
      getAdrService(unauthorizedUserId, { id: targetAdrId })
    ).rejects.toThrow("Unauthorized: You do not have access to this ADR's project.");
  });

  it("allows project member to access project's ADR (SEC-04)", async () => {
    const { getAdrService } = await import("@/lib/api/decyra.functions");

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM adrs a")) {
        return {
          id: targetAdrId,
          project_id: targetProjectId,
          status: "published",
          title: "Public Project ADR",
          author_id: "author-user",
        };
      }
      if (sql.includes("FROM user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return null;
      }
      if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
        return { role: "engineer" }; // Authorized member
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async (sql) => {
      if (sql.includes("FROM project_members WHERE user_id = $1 AND project_id = $2")) {
        return { rows: [{ role: "engineer" }] } as any;
      }
      return { rows: [] } as any;
    });

    const res = await getAdrService(projectAdminId, { id: targetAdrId });

    expect(res.adr.id).toBe(targetAdrId);
    expect(res.adr.title).toBe("Public Project ADR");
  });


  it("rejects unauthorized user from adding members to a project (SEC-01)", async () => {
    const { addProjectMemberService } = await import("@/lib/api/decyra.functions");

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      // User is neither platform admin nor project admin
      return null;
    });

    await expect(
      addProjectMemberService(unauthorizedUserId, {
        project_id: targetProjectId,
        user_id: "victim-user-1234",
        role: "project_admin",
      })
    ).rejects.toThrow("Only admins or project admins can manage project data.");
  });

  it("allows project admin to add members to their project (SEC-01)", async () => {
    const { addProjectMemberService } = await import("@/lib/api/decyra.functions");

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'project_admin'")) {
        return { 1: 1 };
      }
      return null;
    });

    vi.spyOn(postgres, "query").mockImplementation(async () => {
      return { rows: [] } as any;
    });

    const res = await addProjectMemberService(projectAdminId, {
      project_id: targetProjectId,
      user_id: "new-engineer-1234",
      role: "engineer",
    });
    expect(res.ok).toBe(true);
  });

  it("rejects unauthorized user from removing project members (SEC-01)", async () => {
    const { removeProjectMemberService } = await import("@/lib/api/decyra.functions");

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM project_members WHERE id = $1")) {
        return { id: "membership-1", project_id: targetProjectId, role: "engineer" };
      }
      // User is not admin or project admin
      return null;
    });

    await expect(
      removeProjectMemberService(unauthorizedUserId, { id: "membership-1" })
    ).rejects.toThrow("Only admins or project admins can manage project data.");
  });

  it("prevents removing the last project administrator (SEC-01)", async () => {
    const { removeProjectMemberService } = await import("@/lib/api/decyra.functions");

    vi.spyOn(postgres, "queryOne").mockImplementation(async (sql) => {
      if (sql.includes("FROM project_members WHERE id = $1")) {
        return { id: "membership-admin", project_id: targetProjectId, role: "project_admin" };
      }
      if (sql.includes("user_roles WHERE user_id = $1 AND role = 'admin'")) {
        return { 1: 1 }; // Platform admin caller
      }
      if (sql.includes("COUNT(*) as count FROM project_members")) {
        return { count: "1" }; // Only 1 admin left
      }
      return null;
    });

    await expect(
      removeProjectMemberService(adminId, { id: "membership-admin" })
    ).rejects.toThrow("Cannot remove the last project administrator for this project.");
  });
});

