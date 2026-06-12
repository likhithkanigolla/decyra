/**
 * Development mode helpers for local PostgreSQL
 * Use these utilities when developing with DATABASE_TYPE=postgres
 */

/**
 * Generate a development token for local testing
 * Use this token in your API calls when DATABASE_TYPE=postgres
 * 
 * Example fetch call:
 * fetch('/api/user', {
 *   headers: {
 *     'Authorization': `Bearer ${getDevelopmentToken()}`
 *   }
 * })
 */
export function getDevelopmentToken(): string {
  // In development mode, any token starting with 'dev-' is accepted
  return 'dev-test-token-12345';
}

/**
 * Create a mock user context for development
 */
export function createMockUserContext(userId?: string) {
  return {
    userId: userId || 'dev-user-00000000-0000-0000-0000-000000000000',
    claims: {
      sub: userId || 'dev-user-00000000-0000-0000-0000-000000000000',
      role: 'developer',
      email: 'dev@local.test',
    },
    isDatabaseLocal: true,
  };
}

/**
 * Get authorization header for development requests
 */
export function getDevAuthHeader(): Record<string, string> {
  return {
    'Authorization': `Bearer ${getDevelopmentToken()}`,
  };
}

/**
 * Example: Fetch from server function in local mode
 * 
 * const response = await fetch('/api/list-projects', {
 *   method: 'GET',
 *   headers: getDevAuthHeader(),
 * });
 */
export async function fetchWithDevAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...getDevAuthHeader(),
    },
  });
}
