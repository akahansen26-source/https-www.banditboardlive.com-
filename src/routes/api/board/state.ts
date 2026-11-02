import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { ensureOverlayKey, listPublicMatches, readBoardByOverlayKey, readBoardJoin, readBoardState, saveBoardJoin, writeBoardState } from "@/lib/board-store.server";

function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function denied(error: unknown) {
  const message = error instanceof Error ? error.message : "Kunne ikke gemme.";
  const status = /rettigheder|lukket/i.test(message) ? 403 : 400;
  return json({ error: message }, status);
}

export const Route = createFileRoute("/api/board/state")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("offentlig")) {
          try {
            return new Response(JSON.stringify({ matches: await listPublicMatches() }), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
            });
          } catch {
            return json({ matches: [] });
          }
        }
        const link = url.searchParams.get("link");
        if (link) {
          const user = await getSessionUser(bearer(request));
          if (!user) return json({ error: "Unauthorized" }, 401);
          try {
            return json({ key: await ensureOverlayKey(user.id) });
          } catch (error) {
            return denied(error);
          }
        }
        const spiller = url.searchParams.get("spiller");
        if (spiller) {
          try {
            return new Response(JSON.stringify(await readBoardJoin(spiller)), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
            });
          } catch {
            return json({ error: "Spiller-linket er ugyldigt." }, 404);
          }
        }
        const obs = url.searchParams.get("obs");
        if (obs) {
          try {
            const data = await readBoardByOverlayKey(obs);
            return new Response(JSON.stringify(data), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
            });
          } catch {
            return json({ error: "OBS-linket er ugyldigt." }, 404);
          }
        }
        const user = await getSessionUser(bearer(request));
        if (!user) return json({ error: "Unauthorized" }, 401);
        try {
          return json(await readBoardState(user.id));
        } catch (error) {
          return denied(error);
        }
      },
      POST: async ({ request }) => {
        const spiller = new URL(request.url).searchParams.get("spiller");
        if (!spiller) return json({ error: "Unauthorized" }, 401);
        let body: { id?: string; first?: string; last?: string; club?: string; sponsor?: string; pin?: string; photo?: string; sign?: boolean };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Ugyldigt indhold." }, 400);
        }
        try {
          return json(await saveBoardJoin(spiller, body));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Kunne ikke gemme.";
          const status = /PIN/i.test(message) ? 403 : /ugyldigt/i.test(message) ? 404 : 400;
          return json({ error: message }, status);
        }
      },
      PUT: async ({ request }) => {
        const user = await getSessionUser(bearer(request));
        if (!user) return json({ error: "Unauthorized" }, 401);
        let body: { state?: unknown };
        try {
          body = (await request.json()) as { state?: unknown };
        } catch {
          return json({ error: "Ugyldigt indhold." }, 400);
        }
        const state = typeof body.state === "string" ? body.state : "";
        if (!state.startsWith("{")) return json({ error: "Scoreboardet kunne ikke læses." }, 400);
        try {
          return json(await writeBoardState(user.id, state));
        } catch (error) {
          return denied(error);
        }
      },
    },
  },
});
