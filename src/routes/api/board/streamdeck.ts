import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { RemoteError, boardPoll, newToken, remoteInfo, revokeToken } from "@/lib/streamdeck.server";

/** Scoreboardets egen side af Stream Deck-forbindelsen (kræver login). */
function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function fail(e: unknown) {
  if (e instanceof RemoteError) return json({ error: e.message }, e.status);
  console.error("board/streamdeck", e);
  return json({ error: "Serverfejl" }, 500);
}

export const Route = createFileRoute("/api/board/streamdeck")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser(bearer(request));
        if (!user) return json({ error: "Unauthorized" }, 401);
        try {
          return json(await remoteInfo(user.id));
        } catch (e) {
          return fail(e);
        }
      },
      POST: async ({ request }) => {
        const user = await getSessionUser(bearer(request));
        if (!user) return json({ error: "Unauthorized" }, 401);
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          if (body.newToken) return json(await newToken(user.id));
          if (body.revoke) {
            await revokeToken(user.id);
            return json({ ok: true });
          }
          return json(await boardPoll(user.id, body as Parameters<typeof boardPoll>[1]));
        } catch (e) {
          return fail(e);
        }
      },
    },
  },
});
