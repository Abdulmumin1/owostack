import { createFileRoute } from "@tanstack/react-router";
import spec from "../../openapi.json" with { type: "json" };

export const Route = createFileRoute("/openapi.json")({
  server: {
    handlers: {
      // Serve the raw OpenAPI specification so AI agents and API clients can
      // read the full request/response schemas that power the API reference.
      GET: async () =>
        new Response(JSON.stringify(spec), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
