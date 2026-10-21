import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt } from "@/integrations/database/local-auth.server";

describe("local-auth JWT helpers", () => {
  it("generates a valid 3-part JWT token", () => {
    const token = signJwt({ sub: "user-123", email: "user@example.com", role: "admin" });
    const parts = token.split(".");
    expect(parts.length).toBe(3);
  });

  it("verifies and extracts the payload correctly", () => {
    const userPayload = { sub: "user-456", email: "engineer@example.com", role: "member" };
    const token = signJwt(userPayload);
    const decoded = verifyJwt(token);

    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe("user-456");
    expect(decoded?.email).toBe("engineer@example.com");
    expect(decoded?.role).toBe("member");
    expect(decoded?.iat).toBeDefined();
    expect(decoded?.exp).toBeDefined();
  });

  it("fails verification when token is tampered", () => {
    const token = signJwt({ sub: "user-789", role: "member" });
    const parts = token.split(".");
    // Tamper with payload
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "user-789", role: "admin" })
    ).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    expect(verifyJwt(tamperedToken)).toBeNull();
  });

  it("returns null for malformed or non-JWT strings", () => {
    expect(verifyJwt("not-a-token")).toBeNull();
    expect(verifyJwt("header.payload")).toBeNull();
    expect(verifyJwt("")).toBeNull();
  });
});
