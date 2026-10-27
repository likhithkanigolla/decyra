// Auth attacher middleware — attaches Bearer token to every serverFn call.
// Reads local JWT stored in localStorage.
//
// Registered as a global `functionMiddleware` in `src/start.ts`.

import { createMiddleware } from '@tanstack/react-start';

export const LOCAL_TOKEN_KEY = 'local_auth_token';

export const attachAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    const token =
      typeof window !== 'undefined'
        ? (localStorage.getItem(LOCAL_TOKEN_KEY) ?? undefined)
        : undefined;

    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }
);

// Helpers for auth token management
export function setLocalToken(token: string): void {
  localStorage.setItem(LOCAL_TOKEN_KEY, token);
}

export function getLocalToken(): string | null {
  return localStorage.getItem(LOCAL_TOKEN_KEY);
}

export function clearLocalToken(): void {
  localStorage.removeItem(LOCAL_TOKEN_KEY);
}
