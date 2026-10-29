import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
let migrationsRan = false;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

/**
 * Auto-run migrations on startup.
 * Runs once per process startup.
 */
async function runMigrationsIfNeeded(): Promise<void> {
  if (migrationsRan) return;
  migrationsRan = true;

  try {
    console.log('🔄 [server] Running database migrations for PostgreSQL...');
    const { runMigrations } = await import('./integrations/database/migrate');
    await runMigrations();
    console.log('✅ [server] Migrations complete.');
  } catch (err) {
    console.error('❌ [server] Migration failed on startup:', err);
    // Don't crash the server — let the request proceed and show the error in UI
  }
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function attachSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");

  if (process.env.NODE_ENV === "production") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Run migrations once before handling the first request
    await runMigrationsIfNeeded();

    try {
      const handler = await getServerEntry();
      const rawResponse = await handler.fetch(request, env, ctx);
      const response = await normalizeCatastrophicSsrResponse(rawResponse);
      return attachSecurityHeaders(response);
    } catch (error) {
      console.error(error);
      const errorResponse = new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      return attachSecurityHeaders(errorResponse);
    }
  },
};

