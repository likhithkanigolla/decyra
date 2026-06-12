/**
 * Database configuration factory
 * Supports both Supabase and local PostgreSQL
 */

export type DatabaseType = 'supabase' | 'postgres';

export interface DatabaseConfig {
  type: DatabaseType;
  isSupabase: boolean;
  isLocal: boolean;
}

export function getDatabaseConfig(): DatabaseConfig {
  const dbType = (process.env.DATABASE_TYPE || 'postgres') as DatabaseType;

  console.log(`Using database type: ${dbType}`);

  return {
    type: dbType,
    isSupabase: dbType === 'supabase',
    isLocal: dbType === 'postgres',
  };
}

/**
 * Safely get frontend Vite env variables if available
 */
function getViteEnv() {
  try {
    return typeof import.meta !== 'undefined'
      ? import.meta.env
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get Supabase credentials (for Supabase mode)
 */
export function getSupabaseConfig() {
  const config = getDatabaseConfig();

  if (!config.isSupabase) {
    throw new Error(
      'Supabase config requested but DATABASE_TYPE is not "supabase"'
    );
  }

  const viteEnv = getViteEnv();

  const SUPABASE_URL =
    viteEnv?.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const SUPABASE_PUBLISHABLE_KEY =
    viteEnv?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  };
}

/**
 * Get PostgreSQL credentials (for local mode)
 */
export function getPostgresConfig() {
  const config = getDatabaseConfig();

  if (!config.isLocal) {
    throw new Error(
      'Postgres config requested but DATABASE_TYPE is not "postgres"'
    );
  }

  return {
    url: process.env.DATABASE_URL,
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  };
}

/**
 * Validate environment variables for the current database mode
 */
export function validateDatabaseConfig(): void {
  const config = getDatabaseConfig();

  if (config.isSupabase) {
    const supabaseConfig = getSupabaseConfig();

    const missing = [
      ...(supabaseConfig.url ? [] : ['SUPABASE_URL']),
      ...(supabaseConfig.publishableKey
        ? []
        : ['SUPABASE_PUBLISHABLE_KEY']),
    ];

    if (missing.length) {
      throw new Error(
        `Missing Supabase environment variables: ${missing.join(', ')}`
      );
    }
  }

  if (config.isLocal) {
    const postgresConfig = getPostgresConfig();

    const missing = [
      ...(postgresConfig.url ? [] : ['DATABASE_URL']),
    ];

    if (missing.length) {
      throw new Error(
        `Missing PostgreSQL environment variables: ${missing.join(', ')}`
      );
    }
  }
}