// Auth attacher middleware — attaches Bearer token to every serverFn call.
// In Supabase mode: reads the Supabase session token.
// In local PostgreSQL mode: reads a local JWT stored in localStorage.
//
// Must be registered as a global `functionMiddleware` in `src/start.ts`.

import { createMiddleware } from '@tanstack/react-start';

const IS_LOCAL = import.meta.env.VITE_DATABASE_TYPE === 'postgres';
const LOCAL_TOKEN_KEY = 'local_auth_token';

export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    let token: string | undefined;

    if (IS_LOCAL) {
      // Local mode: read the JWT we stored at login time
      token = typeof window !== 'undefined'
        ? (localStorage.getItem(LOCAL_TOKEN_KEY) ?? undefined)
        : undefined;
    } else {
      // Supabase mode: read the active Supabase session
      const { supabase } = await import('./client');
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    }

    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }
);

// Helpers for local auth token management (used in auth.tsx / route.tsx)
export function setLocalToken(token: string): void {
  localStorage.setItem(LOCAL_TOKEN_KEY, token);
}

export function getLocalToken(): string | null {
  return localStorage.getItem(LOCAL_TOKEN_KEY);
}

export function clearLocalToken(): void {
  localStorage.removeItem(LOCAL_TOKEN_KEY);
}
