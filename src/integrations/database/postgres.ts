/**
 * PostgreSQL client for local development
 * Provides a simple interface for database queries
 */

import { Pool, Client } from 'pg';
import { getPostgresConfig } from './config';

let pool: Pool | null = null;

/**
 * Get or create a connection pool to PostgreSQL
 */
export function getPostgresPool(): Pool {
  if (pool) {
    return pool;
  }

  const config = getPostgresConfig();
  
  pool = new Pool({
    connectionString: config.url || 
      `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
  });

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
 * Execute a single query for a single row
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
