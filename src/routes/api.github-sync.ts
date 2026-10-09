import { createFileRoute } from "@tanstack/react-router";
import { processGitHubWebhook } from "@/lib/api/github-sync.server";

const MAX_WEBHOOK_BYTES = 5_000_000;

class PayloadTooLargeError extends Error {}

async function readRequestBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      void reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/github-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > MAX_WEBHOOK_BYTES) {
          return jsonResponse({ error: "Webhook payload is too large." }, 413);
        }
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
          return jsonResponse({ error: "Expected an application/json webhook payload." }, 415);
        }

        try {
          const body = await readRequestBody(request);
          const result = await processGitHubWebhook(
            body,
            request.headers.get("x-github-event"),
            request.headers.get("x-hub-signature-256"),
          );
          return jsonResponse(result.body, result.status);
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            return jsonResponse({ error: "Webhook payload is too large." }, 413);
          }
          console.error(
            "[github-sync] Webhook processing failed.",
            error instanceof Error ? error.name : "Unknown error",
          );
          return jsonResponse({ error: "Repository synchronization failed." }, 500);
        }
      },
    },
  },
});
