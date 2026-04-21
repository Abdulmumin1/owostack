import { createFileRoute } from "@tanstack/react-router";

const DEFAULT_AGENT_BASE_URL = "https://cull.avdorr12345.workers.dev";

type QueryPayload = {
  question?: string;
};

function getAgentStreamUrl() {
  const baseUrl =
    process.env.DOCS_AI_AGENT_URL?.trim() || DEFAULT_AGENT_BASE_URL;

  return new URL("/query/stream", `${baseUrl.replace(/\/$/, "")}/`).toString();
}

async function readUpstreamError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {}

  const fallback = await response.text().catch(() => "");

  return fallback.trim() || `Upstream request failed with ${response.status}`;
}

export const Route = createFileRoute("/api/assistant/stream" as never)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: QueryPayload;

        try {
          payload = (await request.json()) as QueryPayload;
        } catch {
          return Response.json(
            { error: "Request body must be valid JSON." },
            { status: 400 },
          );
        }

        const question = payload.question?.trim();
        if (!question) {
          return Response.json(
            { error: "Question is required." },
            { status: 400 },
          );
        }

        const upstream = await fetch(getAgentStreamUrl(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({ question }),
        });

        if (!upstream.ok) {
          return Response.json(
            { error: await readUpstreamError(upstream) },
            { status: upstream.status || 502 },
          );
        }

        if (!upstream.body) {
          return Response.json(
            { error: "Upstream streaming response body missing." },
            { status: 502 },
          );
        }

        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "content-type":
              upstream.headers.get("content-type") ?? "text/event-stream",
            "cache-control":
              upstream.headers.get("cache-control") ?? "no-cache",
          },
        });
      },
    },
  },
});
