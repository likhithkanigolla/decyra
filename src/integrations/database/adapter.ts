/**
 * Unified database adapter
 * Provides a consistent interface for both Supabase and local PostgreSQL
 */

import { getDatabaseConfig, validateDatabaseConfig } from './config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

validateDatabaseConfig();

const config = getDatabaseConfig();

export interface DatabaseAdapter {
  type: 'supabase' | 'postgres';
  isSupabase(): boolean;
  isLocal(): boolean;
}

class SupabaseAdapter implements DatabaseAdapter {
  type: 'supabase' = 'supabase';

  isSupabase() {
    return true;
  }

  isLocal() {
    return false;
  }

  async getClient(): Promise<SupabaseClient<Database>> {
    const { supabase } = await import('@/integrations/supabase/client');
    return supabase;
  }

  async getAdminClient(): Promise<SupabaseClient<Database>> {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    return supabaseAdmin;
  }
}

class PostgresAdapter implements DatabaseAdapter {
  type: 'postgres' = 'postgres';

  isSupabase() {
    return false;
  }

  isLocal() {
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

/**
 * Get the database adapter based on DATABASE_TYPE environment variable
 */
function createAdapter(): DatabaseAdapter {
  if (config.isSupabase) {
    return new SupabaseAdapter();
  }
  return new PostgresAdapter();
}

export const dbAdapter = createAdapter();

/**
 * Determine if we're using Supabase
 */
export const isSupabase = () => config.isSupabase;

/**
 * Determine if we're using local PostgreSQL
 */
export const isLocal = () => config.isLocal;
