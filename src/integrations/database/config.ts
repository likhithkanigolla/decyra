/**
 * Database configuration factory for PostgreSQL.
 */

export type DatabaseType = 'postgres';

export interface DatabaseConfig {
  type: DatabaseType;
  isLocal: true;
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    type: 'postgres',
    isLocal: true,
  };
}

/**
 * Get PostgreSQL credentials
 */
export function getPostgresConfig() {
  return {
    url: process.env.DATABASE_URL,
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'decyra',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD,
  };
}

/**
 * Validate PostgreSQL environment variables
 */
export function validateDatabaseConfig(): void {
  const hasConnectionString = Boolean(process.env.DATABASE_URL);
  const hasDiscreteConfig = Boolean(
    process.env.POSTGRES_HOST &&
    process.env.POSTGRES_DB &&
    process.env.POSTGRES_USER
  );

  if (!hasConnectionString && !hasDiscreteConfig) {
    throw new Error(
      'Missing PostgreSQL configuration: Provide DATABASE_URL or POSTGRES_HOST, POSTGRES_DB, and POSTGRES_USER.'
    );
  }
}