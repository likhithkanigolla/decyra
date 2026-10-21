import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getDatabaseConfig,
  getPostgresConfig,
  getSupabaseConfig,
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

  it("defaults to postgres database type when not specified", () => {
    delete process.env.DATABASE_TYPE;
    const config = getDatabaseConfig();
    expect(config.type).toBe("postgres");
    expect(config.isLocal).toBe(true);
    expect(config.isSupabase).toBe(false);
  });

  it("identifies supabase mode when configured", () => {
    process.env.DATABASE_TYPE = "supabase";
    const config = getDatabaseConfig();
    expect(config.type).toBe("supabase");
    expect(config.isLocal).toBe(false);
    expect(config.isSupabase).toBe(true);
  });

  it("reads postgres configuration correctly", () => {
    process.env.DATABASE_TYPE = "postgres";
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

  it("throws error when getSupabaseConfig is called in postgres mode", () => {
    process.env.DATABASE_TYPE = "postgres";
    expect(() => getSupabaseConfig()).toThrow(
      'Supabase config requested but DATABASE_TYPE is not "supabase"'
    );
  });

  it("throws error when getPostgresConfig is called in supabase mode", () => {
    process.env.DATABASE_TYPE = "supabase";
    expect(() => getPostgresConfig()).toThrow(
      'Postgres config requested but DATABASE_TYPE is not "postgres"'
    );
  });

  it("validates postgres configuration and flags missing DATABASE_URL", () => {
    process.env.DATABASE_TYPE = "postgres";
    delete process.env.DATABASE_URL;
    expect(() => validateDatabaseConfig()).toThrow("Missing PostgreSQL environment variables: DATABASE_URL");
  });

  it("validates postgres configuration successfully when present", () => {
    process.env.DATABASE_TYPE = "postgres";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/decyra";
    expect(() => validateDatabaseConfig()).not.toThrow();
  });

  it("validates supabase configuration and flags missing keys", () => {
    process.env.DATABASE_TYPE = "supabase";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect(() => validateDatabaseConfig()).toThrow(
      "Missing Supabase environment variables: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY"
    );
  });
});
