import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";

const noDatabase =
  Boolean(process.env.VERCEL) && !process.env.DATABASE_URL?.trim();

function unavailable() {
  return Response.json(
    {
      message:
        "DATABASE_URL mangler på den live side. I Vercel skal variablen hedde DATABASE_URL, gælde for Production og starte med postgresql://. Gem, og tryk Redeploy på den nyeste udgivelse.",
    },
    { status: 503 },
  );
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => (noDatabase ? unavailable() : auth.handler(request)),
      POST: ({ request }) => (noDatabase ? unavailable() : auth.handler(request)),
    },
  },
});

