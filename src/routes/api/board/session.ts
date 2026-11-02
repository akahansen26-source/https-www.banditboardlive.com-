import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { ensureProfile } from "@/lib/board-store.server";
import { permissionsFor } from "@/lib/roles";

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

export const Route = createFileRoute("/api/board/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser(bearer(request));
        if (!user) return json({ error: "Unauthorized" }, 401);
        const profile = await ensureProfile(user.id);
        return json({
          id: profile.userId,
          email: profile.email,
          name: profile.accountName,
          role: profile.role,
          venueName: profile.venueName,
          contactName: profile.contactName,
          active: profile.active,
          accountStatus: profile.accountStatus,
          permissions: permissionsFor(profile.role),
        });
      },
    },
  },
});
