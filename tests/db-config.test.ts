import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getDatabaseConfig,
  getPostgresConfig,
  validateDatabaseConfig,
} from "@/integrations/database/config";

describe("database config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns postgres database type", () => {
    const config = getDatabaseConfig();
    expect(config.type).toBe("postgres");
    expect(config.isLocal).toBe(true);
  });

  it("reads postgres configuration correctly with custom variables", () => {
    process.env.POSTGRES_HOST = "custom-host";
    process.env.POSTGRES_PORT = "5433";
    process.env.POSTGRES_DB = "testdb";
    process.env.POSTGRES_USER = "testuser";
    process.env.POSTGRES_PASSWORD = "testpassword";
    process.env.DATABASE_URL = "postgresql://testuser:testpassword@custom-host:5433/testdb";

    const pg = getPostgresConfig();
    expect(pg.host).toBe("custom-host");
    expect(pg.port).toBe(5433);
    expect(pg.database).toBe("testdb");
    expect(pg.user).toBe("testuser");
    expect(pg.password).toBe("testpassword");
    expect(pg.url).toBe(process.env.DATABASE_URL);
  });

  it("provides sensible defaults when env variables are not set", () => {
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PORT;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.DATABASE_URL;

    const pg = getPostgresConfig();
    expect(pg.host).toBe("localhost");
    expect(pg.port).toBe(5432);
    expect(pg.database).toBe("decyra");
    expect(pg.user).toBe("postgres");
    expect(pg.password).toBeUndefined();
    expect(pg.url).toBeUndefined();
  });

  it("validates postgres configuration successfully when DATABASE_URL is present", () => {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/decyra";
    expect(() => validateDatabaseConfig()).not.toThrow();
  });

  it("validates postgres configuration successfully when discrete host/db/user are present", () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_HOST = "localhost";
    process.env.POSTGRES_DB = "decyra";
    process.env.POSTGRES_USER = "postgres";
    expect(() => validateDatabaseConfig()).not.toThrow();
  });

  it("throws error when neither connection string nor discrete config is present", () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_HOST = "";
    process.env.POSTGRES_DB = "";
    process.env.POSTGRES_USER = "";
    expect(() => validateDatabaseConfig()).toThrow(
      "Missing PostgreSQL configuration: Provide DATABASE_URL or POSTGRES_HOST, POSTGRES_DB, and POSTGRES_USER."
    );
  });
});

