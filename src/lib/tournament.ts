import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

export const getTournament = createServerFn({ method: "GET" }).handler(async () => {
  const { readPublicTournament } = await import("./tournament.server");
  return readPublicTournament();
});

export const saveTournamentInfo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; plan: string }) => ({
    name: clip(input?.name, 120),
    plan: clip(input?.plan, 4000),
  }))
  .handler(async ({ context, data }) => {
    const { saveTournamentInfo: save } = await import("./tournament.server");
    return save(context.userId, data.name, data.plan);
  });

export const joinTournament = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; note: string }) => ({
    name: clip(input?.name, 120),
    note: clip(input?.note, 240),
  }))
  .handler(async ({ context, data }) => {
    const { joinTournament: join } = await import("./tournament.server");
    return join(context.userId, data.name, data.note);
  });

export const leaveTournament = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { leaveTournament: leave } = await import("./tournament.server");
    return leave(context.userId);
  });

export const addRankingRow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; points: number; wins: number }) => ({
    name: clip(input?.name, 120),
    points: Number(input?.points) || 0,
    wins: Number(input?.wins) || 0,
  }))
  .handler(async ({ context, data }) => {
    const { addRanking } = await import("./tournament.server");
    return addRanking(context.userId, data.name, data.points, data.wins);
  });

export const removeRankingRow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => ({ id: clip(input?.id, 80) }))
  .handler(async ({ context, data }) => {
    const { removeRanking } = await import("./tournament.server");
    return removeRanking(context.userId, data.id);
  });

export const addHistoryRow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { title: string; detail: string }) => ({
    title: clip(input?.title, 160),
    detail: clip(input?.detail, 400),
  }))
  .handler(async ({ context, data }) => {
    const { addHistory } = await import("./tournament.server");
    return addHistory(context.userId, data.title, data.detail);
  });

export const removeHistoryRow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => ({ id: clip(input?.id, 80) }))
  .handler(async ({ context, data }) => {
    const { removeHistory } = await import("./tournament.server");
    return removeHistory(context.userId, data.id);
  });
