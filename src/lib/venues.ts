import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ASSIGNABLE_ROLES, type AccountStatus, type UserRole } from "@/lib/roles";

export type PublicProfile = {
  userId: string;
  email: string;
  accountName: string;
  role: UserRole;
  venueName: string;
  contactName: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  notes: string;
  accessCode: string;
  active: boolean;
  accountStatus: AccountStatus;
  publicLive: boolean;
  createdAt: string;
};

export type PublicSettings = {
  facebook: string;
  instagram: string;
  youtube: string;
  contactEmail: string;
  contactPhone: string;
};

export type VenueDraft = {
  venueName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  notes: string;
  accessCode: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function draft(input: VenueDraft, withEmail: boolean): VenueDraft {
  const email = clip(input?.email, 160).toLowerCase();
  if (withEmail && !EMAIL.test(email)) throw new Error("Skriv en gyldig e-mail.");
  const venueName = clip(input?.venueName, 120);
  if (!venueName) throw new Error("Skriv navnet på pubben eller klubben.");
  return {
    venueName,
    contactName: clip(input?.contactName, 120),
    email,
    phone: clip(input?.phone, 40),
    address: clip(input?.address, 160),
    postalCode: clip(input?.postalCode, 12),
    city: clip(input?.city, 80),
    notes: clip(input?.notes, 500),
    accessCode: clip(input?.accessCode, 40),
  };
}

function safeUrl(value: unknown): string {
  const url = clip(value, 300);
  if (!url) return "";
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Links skal starte med https://");
  return url;
}

export const getSiteSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { readSettings } = await import("./board-store.server");
  return readSettings();
});

export const getOverlayKey = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureOverlayKey } = await import("./board-store.server");
    return ensureOverlayKey(context.userId);
  });

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureProfile } = await import("./board-store.server");
    return ensureProfile(context.userId);
  });

export const saveMyProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: VenueDraft) => draft(input, false))
  .handler(async ({ context, data }) => {
    const { saveOwnDetails } = await import("./board-store.server");
    return saveOwnDetails(context.userId, data);
  });

export const listVenueAccounts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listVenues } = await import("./board-store.server");
    return listVenues(context.userId);
  });

export const createVenueAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: VenueDraft) => draft(input, true))
  .handler(async ({ context, data }) => {
    const { createVenueAccount: create } = await import("./board-store.server");
    return create(context.userId, data);
  });

export const updateVenueAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: VenueDraft & { userId: string }) => {
    const userId = clip(input?.userId, 80);
    if (!userId) throw new Error("Brugeren mangler.");
    return { userId, ...draft(input, false) };
  })
  .handler(async ({ context, data }) => {
    const { updateVenue } = await import("./board-store.server");
    return updateVenue(context.userId, data);
  });

export const setAccountStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; status: AccountStatus }) => {
    const userId = clip(input?.userId, 80);
    const status = String(input?.status || "") as AccountStatus;
    if (!userId) throw new Error("Brugeren mangler.");
    if (!["pending", "approved", "rejected", "suspended", "disabled"].includes(status)) {
      throw new Error("Ukendt status.");
    }
    return { userId, status };
  })
  .handler(async ({ context, data }) => {
    const { setAccountStatus: setStatus } = await import("./board-store.server");
    return setStatus(context.userId, data.userId, data.status);
  });

export const setMyPublicLive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { on: boolean }) => ({ on: Boolean(input?.on) }))
  .handler(async ({ context, data }) => {
    const { setPublicLive } = await import("./board-store.server");
    return setPublicLive(context.userId, data.on);
  });

export const setVenueActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; active: boolean }) => ({
    userId: clip(input?.userId, 80),
    active: Boolean(input?.active),
  }))
  .handler(async ({ context, data }) => {
    const { setVenueActive: setActive } = await import("./board-store.server");
    return setActive(context.userId, data.userId, data.active);
  });

export const newAccessCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; accessCode?: string }) => ({
    userId: clip(input?.userId, 80),
    accessCode: clip(input?.accessCode, 40),
  }))
  .handler(async ({ context, data }) => {
    const { regenerateAccessCode } = await import("./board-store.server");
    return regenerateAccessCode(context.userId, data.userId, data.accessCode);
  });

export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureProfile } = await import("./board-store.server");
    const { hasPermission } = await import("./roles");
    const { listAudit } = await import("./audit.server");
    const profile = await ensureProfile(context.userId);
    if (!hasPermission(profile.role, "MANAGE_USERS") && !hasPermission(profile.role, "MANAGE_ROLES")) {
      throw new Error("Kun en administrator kan se loggen.");
    }
    return listAudit(100);
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { password: string }) => {
    const password = String(input?.password ?? "");
    if (password.length < 8) throw new Error("Skriv din adgangskode.");
    return { password };
  })
  .handler(async ({ context, data }) => {
    const { deleteOwnAccount } = await import("./board-store.server");
    return deleteOwnAccount(context.userId, data.password);
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; role: UserRole }) => {
    const userId = clip(input?.userId, 80);
    const role = (ASSIGNABLE_ROLES as readonly string[]).includes(input?.role) ? input.role : "";
    if (!userId || !role) throw new Error("Brugeren eller rollen mangler.");
    return { userId, role };
  })
  .handler(async ({ context, data }) => {
    const { setUserRole: setRole } = await import("./board-store.server");
    return setRole(context.userId, data.userId, data.role);
  });

export const deleteVenueAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string }) => {
    const userId = clip(input?.userId, 80);
    if (!userId) throw new Error("Brugeren mangler.");
    return { userId };
  })
  .handler(async ({ context, data }) => {
    const { removeVenue } = await import("./board-store.server");
    return removeVenue(context.userId, data.userId);
  });

export const saveSiteSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: PublicSettings) => ({
    facebook: safeUrl(input?.facebook),
    instagram: safeUrl(input?.instagram),
    youtube: safeUrl(input?.youtube),
    contactEmail: clip(input?.contactEmail, 160),
    contactPhone: clip(input?.contactPhone, 40),
  }))
  .handler(async ({ context, data }) => {
    const { writeSettings } = await import("./board-store.server");
    return writeSettings(context.userId, data);
  });
