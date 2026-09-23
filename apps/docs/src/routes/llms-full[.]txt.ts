import { createFileRoute } from "@tanstack/react-router";
import { renderLLMFull } from "@/lib/llms";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(await renderLLMFull(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
    },
  },
});
