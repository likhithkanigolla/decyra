import { describe, it, expect, vi } from "vitest";
import type { QueryResult } from "pg";
import { loginLocal, hashPassword } from "@/integrations/database/local-auth.server";
import * as postgres from "@/integrations/database/postgres";

describe("username and email login authentication", () => {
  it("authenticates successfully using username with uppercase characters and whitespace", async () => {
    const passwordHash = await hashPassword("validPassword123");
    const fakeUser = {
      id: "11111111-1111-1111-1111-111111111111",
      email: "engineer@example.com",
      username: "eng_lead",
      full_name: "Lead Engineer",
      password_hash: passwordHash,
      role: "member",
      is_locked: false,
    };

    const queryOneSpy = vi.spyOn(postgres, "queryOne").mockImplementation(async (sql, params) => {
      expect(sql).toContain("LOWER(u.email) = $1");
      expect(sql).toContain("LOWER(COALESCE(u.username, '')) = $1");
      expect(sql).toContain("LOWER(COALESCE(p.username, '')) = $1");
      expect(params).toEqual(["eng_lead"]);
      return fakeUser;
    });

    const querySpy = vi
      .spyOn(postgres, "query")
      .mockResolvedValue({ rows: [] } as unknown as QueryResult);

    const result = await loginLocal("  ENG_LEAD  ", "validPassword123");

    expect(result.token).toBeDefined();
    expect(result.user.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.user.email).toBe("engineer@example.com");
    expect(result.user.username).toBe("eng_lead");

    queryOneSpy.mockRestore();
    querySpy.mockRestore();
  });

  it("authenticates successfully using username with leading @ symbol", async () => {
    const passwordHash = await hashPassword("securePass123");
    const fakeUser = {
      id: "22222222-2222-2222-2222-222222222222",
      email: "architect@example.com",
      username: "chief_architect",
      full_name: "Chief Architect",
      password_hash: passwordHash,
      role: "admin",
      is_locked: false,
    };

    const queryOneSpy = vi.spyOn(postgres, "queryOne").mockImplementation(async (_sql, params) => {
      expect(params).toEqual(["chief_architect"]);
      return fakeUser;
    });

    const querySpy = vi
      .spyOn(postgres, "query")
      .mockResolvedValue({ rows: [] } as unknown as QueryResult);

    const result = await loginLocal("@Chief_Architect", "securePass123");

    expect(result.token).toBeDefined();
    expect(result.user.username).toBe("chief_architect");
    expect(result.user.role).toBe("admin");

    queryOneSpy.mockRestore();
    querySpy.mockRestore();
  });

  it("falls back to profiles.username when local_users.username is null", async () => {
    const passwordHash = await hashPassword("secretPassword123");
    const fakeUser = {
      id: "33333333-3333-3333-3333-333333333333",
      email: "member@example.com",
      username: "profile_only_username",
      full_name: "Profile Member",
      password_hash: passwordHash,
      role: "member",
      is_locked: false,
    };

    const queryOneSpy = vi.spyOn(postgres, "queryOne").mockImplementation(async (_sql, params) => {
      expect(params).toEqual(["profile_only_username"]);
      return fakeUser;
    });

    const querySpy = vi
      .spyOn(postgres, "query")
      .mockResolvedValue({ rows: [] } as unknown as QueryResult);

    const result = await loginLocal("profile_only_username", "secretPassword123");

    expect(result.user.username).toBe("profile_only_username");

    queryOneSpy.mockRestore();
    querySpy.mockRestore();
  });

  it("rejects login when account is locked", async () => {
    const lockedUser = {
      id: "44444444-4444-4444-4444-444444444444",
      email: "locked@example.com",
      username: "locked_user",
      full_name: "Locked User",
      password_hash: "hash",
      role: "member",
      is_locked: true,
    };

    const queryOneSpy = vi.spyOn(postgres, "queryOne").mockResolvedValue(lockedUser);

    await expect(loginLocal("locked_user", "password123")).rejects.toThrow(
      "Your account has been locked",
    );

    queryOneSpy.mockRestore();
  });

  it("rejects login when user is not found", async () => {
    const queryOneSpy = vi.spyOn(postgres, "queryOne").mockResolvedValue(null);

    await expect(loginLocal("non_existent_user", "password123")).rejects.toThrow(
      "Invalid email, username, or password",
    );

    queryOneSpy.mockRestore();
  });
});
