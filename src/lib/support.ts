import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { SUPPORT_CATEGORIES, type SupportStatus } from "@/lib/support-shared";

const optionalUser = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("./auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { getSessionUser } = await import("./auth/verify.server");
    const user = await getSessionUser((context as { bearerToken?: string }).bearerToken);
    return next({ context: { user } });
  });

function clip(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

const fileInput = (file: { name?: string; type?: string; data?: string } | null | undefined) =>
  file?.data ? { name: clip(file.name, 120), type: clip(file.type, 40), data: String(file.data).slice(0, 900000) } : null;

export const sendSupportMessage = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator(
    (input: {
      name?: string;
      email?: string;
      category?: string;
      subject?: string;
      message?: string;
      tournament?: string;
      tableName?: string;
      company?: string;
      file?: { name?: string; type?: string; data?: string } | null;
    }) => ({
      name: clip(input?.name, 120),
      email: clip(input?.email, 160),
      category: clip(input?.category, 40),
      subject: clip(input?.subject, 160),
      message: clip(input?.message, 4000),
      tournament: clip(input?.tournament, 120),
      tableName: clip(input?.tableName, 40),
      company: clip(input?.company, 80),
      file: fileInput(input?.file),
    }),
  )
  .handler(async ({ data, context }) => {
    const { createTicket } = await import("./support.server");
    return createTicket(data, context.user);
  });

export const mySupportTickets = createServerFn({ method: "GET" })
  .middleware([optionalUser])
  .handler(async ({ context }) => {
    if (!context.user) return [];
    const { listMyTickets } = await import("./support.server");
    return listMyTickets(context.user.id);
  });

export const supportBoardHints = createServerFn({ method: "GET" })
  .middleware([optionalUser])
  .handler(async ({ context }) => {
    if (!context.user) return { tournaments: [] as string[], tables: [] as string[] };
    const { boardHints } = await import("./support.server");
    return boardHints(context.user.id);
  });

export const openSupportTicket = createServerFn({ method: "GET" })
  .middleware([optionalUser])
  .validator((input: { code?: string; token?: string }) => ({
    code: clip(input?.code, 20).toUpperCase(),
    token: clip(input?.token, 80),
  }))
  .handler(async ({ data, context }) => {
    const { readTicket } = await import("./support.server");
    return readTicket(context.user?.id ?? null, data.code, data.token);
  });

export const answerSupportTicket = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator(
    (input: { code?: string; token?: string; body?: string; internal?: boolean; file?: { name?: string; type?: string; data?: string } | null }) => ({
      code: clip(input?.code, 20).toUpperCase(),
      token: clip(input?.token, 80),
      body: clip(input?.body, 4000),
      internal: Boolean(input?.internal),
      file: fileInput(input?.file),
    }),
  )
  .handler(async ({ data, context }) => {
    const { replyTicket } = await import("./support.server");
    return replyTicket(context.user?.id ?? null, data);
  });

export const supportQueue = createServerFn({ method: "GET" })
  .middleware([optionalUser])
  .validator((input: { status?: string; category?: string; query?: string }) => ({
    status: clip(input?.status, 20),
    category: clip(input?.category, 40),
    query: clip(input?.query, 80),
  }))
  .handler(async ({ data, context }) => {
    if (!context.user) throw new Error("Log ind.");
    const { listStaffTickets, supportCounts, listSupportStaff } = await import("./support.server");
    const [tickets, counts, staff] = await Promise.all([
      listStaffTickets(context.user.id, data),
      supportCounts(),
      listSupportStaff(context.user.id),
    ]);
    return { tickets, counts, staff, categories: SUPPORT_CATEGORIES };
  });

export const changeSupportTicket = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: { code?: string; status?: SupportStatus | ""; assigneeId?: string }) => ({
    code: clip(input?.code, 20).toUpperCase(),
    status: clip(input?.status, 20),
    assigneeId: input?.assigneeId === undefined ? undefined : clip(input.assigneeId, 80),
  }))
  .handler(async ({ data, context }) => {
    if (!context.user) throw new Error("Log ind.");
    const { updateTicket } = await import("./support.server");
    return updateTicket(context.user.id, data);
  });
