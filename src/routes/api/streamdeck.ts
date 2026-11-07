import { createFileRoute } from "@tanstack/react-router";
import { RemoteError, readStatus, sendCommand, userByToken } from "@/lib/streamdeck.server";

/**
 * Bruges af Stream Deck-pluginnet (og fx Bitfocus Companion / "Website"-handlingen).
 *   GET  /api/streamdeck?status=1[&since=..&wait=8000]   Authorization: Bearer bbsd_…
 *   POST /api/streamdeck  {a, v}                           Authorization: Bearer bbsd_…
 *   GET  /api/streamdeck?token=bbsd_…&a=…&v=…               (til værktøjer der kun kan lave GET)
 */
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
function tokenOf(request: Request, url: URL) {
  const h = request.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : url.searchParams.get("token");
}
function fail(e: unknown) {
  if (e instanceof RemoteError) return json({ ok: false, error: e.message }, e.status);
  console.error("streamdeck", e);
  return json({ ok: false, error: "Serverfejl – prøv igen." }, 500);
}

export const Route = createFileRoute("/api/streamdeck")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST" } }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        try {
          const userId = await userByToken(tokenOf(request, url));
          const a = url.searchParams.get("a");
          if (a) return json(await sendCommand(userId, a, url.searchParams.get("v") ?? "", "url"));
          return json(await readStatus(userId, url.searchParams.get("since"), Number(url.searchParams.get("wait")) || 0));
        } catch (e) {
          return fail(e);
        }
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        try {
          const userId = await userByToken(tokenOf(request, url));
          const body = (await request.json().catch(() => ({}))) as { a?: string; v?: string; source?: string };
          return json(await sendCommand(userId, String(body.a ?? ""), String(body.v ?? ""), String(body.source ?? "streamdeck")));
        } catch (e) {
          return fail(e);
        }
      },
    },
  },
});
