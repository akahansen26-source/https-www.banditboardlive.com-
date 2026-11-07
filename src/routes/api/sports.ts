import { createFileRoute } from "@tanstack/react-router";
import { sportSummaries } from "@/lib/sports/summary";

export const Route = createFileRoute("/api/sports")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(sportSummaries()), {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
        }),
    },
  },
});
