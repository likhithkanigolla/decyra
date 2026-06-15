/**
 * PostgreSQL client for local development
 * Provides a simple interface for database queries
 */

import { Pool } from 'pg';
import { getPostgresConfig } from './config';

let pool: Pool | null = null;

/**
 * Get or create a connection pool to PostgreSQL.
 * Pool is intentionally kept small — enough for SSR concurrency without
 * overwhelming the DB container in production Docker deployments.
 */
export function getPostgresPool(): Pool {
  if (pool) {
    return pool;
  }

  const config = getPostgresConfig();

  pool = new Pool({
    connectionString:
      config.url ||
      `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`,

    // Keep a warm pool so connections are never created on the hot path
    min: 2,
    max: parseInt(process.env.POSTGRES_POOL_MAX ?? '10', 10),

    // Release idle connections after 30 s to avoid phantom holds on the DB
    idleTimeoutMillis: 30_000,

    // Fail fast if we can't get a connection within 5 s (instead of hanging)
    connectionTimeoutMillis: 5_000,

    // Keep TCP connections alive to avoid reconnects after Docker bridge idle
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  pool.on('error', (err) => {
    // Log but do NOT exit — a single bad idle client should not crash the server
    console.error('[pg-pool] Unexpected error on idle client:', err.message);
  });

  // Pre-warm the pool at startup so the first request is not slow
  pool.connect()
    .then((c) => c.release())
    .catch(() => { /* ignore — will retry on first real request */ });

  return pool;
}

/**
 * Execute a query
 */
export async function query<T = any>(
  text: string,
  values?: any[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const client = await getPostgresPool().connect();
  try {
    const result = await client.query(text, values);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a query and return only the first row (or null)
 */
export async function queryOne<T = any>(
  text: string,
  values?: any[]
): Promise<T | null> {
  const result = await query<T>(text, values);
  return result.rows[0] || null;
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
