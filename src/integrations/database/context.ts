/**
 * Database context helper for server functions
 */

export interface ServerFunctionContext {
  userId: string;
  claims?: Record<string, unknown>;
  isDatabaseLocal?: true;
}

export async function getDatabaseClient() {
  const { query, queryOne } = await import('@/integrations/database/postgres');
  return {
    type: 'postgres' as const,
    client: { query, queryOne },
  };
}

export function isLocalContext(): boolean {
  return true;
}
