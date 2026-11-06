import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/media/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { cmsDb } = await import("@/lib/cms/server");
        const { readMedia } = await import("@/lib/cms/core");
        const media = await readMedia(await cmsDb(), params.id);
        if (!media) return new Response("Ikke fundet", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
        return new Response(media.bytes as unknown as BodyInit, {
          headers: {
            "content-type": media.mime,
            "content-length": String(media.bytes.length),
            "cache-control": "public, max-age=3600",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
          },
        });
      },
    },
  },
});
