/**
 * PostgreSQL database adapter
 */

export interface DatabaseAdapter {
  type: 'postgres';
  isLocal(): boolean;
}

class PostgresAdapter implements DatabaseAdapter {
  type: 'postgres' = 'postgres';

  isLocal(): boolean {
    return true;
  }

  async getClient() {
    const { query, queryOne } = await import('./postgres');
    return {
      query,
      queryOne,
    };
  }

  async getAdminClient() {
    const { query, queryOne } = await import('./postgres');
    return {
      query,
      queryOne,
    };
  }
}

export const dbAdapter = new PostgresAdapter();

export const isLocal = () => true;
