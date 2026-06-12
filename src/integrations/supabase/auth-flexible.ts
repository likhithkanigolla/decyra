/**
 * Conditional authentication middleware
 * Switches between Supabase auth and local PostgreSQL auth based on DATABASE_TYPE
 */

import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { getDatabaseConfig } from '@/integrations/database/config';
import type { Database } from './types';

// Unified context type for both Supabase and local modes
export interface FlexibleAuthContext {
  userId: string;
  claims: any;
  isDatabaseLocal: boolean;
  supabase?: any; // Only set in Supabase mode
}

/**
 * Flexible auth middleware that works with both Supabase and local PostgreSQL.
 *
 * For Supabase mode: Validates Bearer token with Supabase, attaches supabase client.
 * For PostgreSQL mode: Validates our local HS256 JWT, sets isDatabaseLocal=true.
 */
export const requireFlexibleAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }): Promise<any> => {
    const config = getDatabaseConfig();
    const request = getRequest();

    if (!request?.headers) {
      throw new Error('Unauthorized: No request headers available');
    }

    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      throw new Error('Unauthorized: No authorization header provided');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Unauthorized: Only Bearer tokens are supported');
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      throw new Error('Unauthorized: No token provided');
    }

    // ── Supabase mode ────────────────────────────────────────────────────────
    if (config.isSupabase) {
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        const missing = [
          ...(!SUPABASE_URL ? ['SUPABASE_URL'] : []),
          ...(!SUPABASE_PUBLISHABLE_KEY ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
        ];
        throw new Error(`Missing Supabase environment variables: ${missing.join(', ')}`);
      }

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient<Database>(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );

      const { data, error } = await supabase.auth.getClaims(token);
      if (error || !data?.claims) {
        throw new Error('Unauthorized: Invalid token');
      }

      if (!data.claims.sub) {
        throw new Error('Unauthorized: No user ID found in token');
      }

      const ctx: FlexibleAuthContext = {
        supabase,
        userId: data.claims.sub,
        claims: data.claims,
        isDatabaseLocal: false,
      };

      return next({ context: ctx });
    }

    // ── Local PostgreSQL mode ─────────────────────────────────────────────────

    // Validate using our local HS256 JWT
    try {
      const { verifyJwt } = await import('@/integrations/database/local-auth.server');
      const payload = verifyJwt(token);

      if (!payload) {
        throw new Error('Invalid or expired token');
      }

      const userId = (payload.sub as string) || (payload.user_id as string);
      if (!userId) {
        throw new Error('No user ID in token');
      }

      const ctx: FlexibleAuthContext = {
        userId,
        claims: payload,
        isDatabaseLocal: true,
      };

      return next({ context: ctx });
    } catch (error) {
      console.error('Token validation failed:', error);
      throw new Error('Unauthorized: Invalid token');
    }
  }
);
