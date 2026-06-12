/**
 * Database context helper for server functions
 * Provides unified database access for both Supabase and local PostgreSQL
 */

import { getDatabaseConfig, getSupabaseConfig } from '@/integrations/database/config';
import type { Database } from '@/integrations/supabase/types';

export interface ServerFunctionContext {
  userId: string;
  claims?: any;
  supabase?: any; // SupabaseClient<Database>
  isDatabaseLocal?: boolean;
}

/**
 * Get database client from context
 * Returns Supabase client for Supabase mode, PostgreSQL client for local mode
 */
export async function getDatabaseClient(context: ServerFunctionContext) {
  const config = getDatabaseConfig();

  if (config.isSupabase) {
    if (!context.supabase) {
      throw new Error('Supabase client not available in context');
    }
    return {
      type: 'supabase' as const,
      client: context.supabase,
    };
  }

  if (config.isLocal) {
    const { query, queryOne } = await import('@/integrations/database/postgres');
    return {
      type: 'postgres' as const,
      client: { query, queryOne },
    };
  }

  throw new Error('Unknown database type');
}

/**
 * Helper to check if using Supabase
 */
export function isSupabaseContext(context: ServerFunctionContext): boolean {
  return !context.isDatabaseLocal && !!context.supabase;
}

/**
 * Helper to check if using local PostgreSQL
 */
export function isLocalContext(context: ServerFunctionContext): boolean {
  return context.isDatabaseLocal === true;
}

/**
 * Example: Get user profile in database-agnostic way
 */
export async function getUserProfile(
  context: ServerFunctionContext,
  userId: string
) {
  const { type, client } = await getDatabaseClient(context);

  if (type === 'supabase') {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  if (type === 'postgres') {
    return client.queryOne(
      'SELECT * FROM profiles WHERE id = $1',
      [userId]
    );
  }
}

/**
 * Helper function to safely access Supabase client
 * Throws helpful error if in local mode
 */
export function getSupabaseClientOrThrow(
  context: ServerFunctionContext
): any {
  if (!context.supabase) {
    throw new Error(
      'Supabase client not available. Are you in local PostgreSQL mode? ' +
      'Use getDatabaseClient() instead for database-agnostic access.'
    );
  }
  return context.supabase;
}
