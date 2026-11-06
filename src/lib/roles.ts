export const PERMISSIONS = [
  "VIEW_PUBLIC",
  "VIEW_OWN_BOARD",
  "USE_SCOREBOARD",
  "EDIT_SCORE",
  "EDIT_PLAYER",
  "EDIT_TEAM",
  "EDIT_MATCH",
  "CONTROL_TIMER",
  "USE_REMOTE",
  "CREATE_TOURNAMENT",
  "EDIT_TOURNAMENT",
  "DELETE_TOURNAMENT",
  "IMPORT_PLAYERS",
  "EXPORT_RESULTS",
  "MANAGE_USERS",
  "MANAGE_ROLES",
  "MANAGE_PUBS",
  "MANAGE_SETTINGS",
  "MANAGE_SOCIAL",
  "MANAGE_ADMINS",
  "MANAGE_MANAGERS",
  "MANAGE_SUPPORT",
  "MANAGE_RULES",
  "APPROVE_RESULTS",
  "MANAGE_CONTENT",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const USER_ROLES = [
  "gaest",
  "bruger",
  "scoreboard_admin",
  "administrer_scoreboard",
  "admin",
  "administrator_manager",
  "administrer_indstillinger",
  "udlejning",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ["pending", "approved", "rejected", "suspended", "disabled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  pending: "Afventer godkendelse",
  approved: "Godkendt",
  rejected: "Afvist",
  suspended: "Midlertidigt deaktiveret",
  disabled: "Deaktiveret",
};

export function normalizeAccountStatus(value: string | null | undefined): AccountStatus {
  return (ACCOUNT_STATUSES as readonly string[]).includes(value || "") ? (value as AccountStatus) : "approved";
}

/** Roles an admin can hand out. Legacy roles stay valid for old accounts. */
export const ASSIGNABLE_ROLES = [
  "gaest",
  "bruger",
  "scoreboard_admin",
  "administrer_scoreboard",
  "admin",
  "administrator_manager",
] as const;

export const ROLE_LABEL: Record<UserRole, string> = {
  gaest: "Gæst",
  bruger: "Bruger",
  scoreboard_admin: "Scoreboard-admin",
  administrer_scoreboard: "Administrer scoreboard",
  admin: "Admin",
  administrator_manager: "Administrator-manager",
  administrer_indstillinger: "Administrer indstillinger",
  udlejning: "Udlejning",
};

export const ROLE_BLURB: Record<(typeof ASSIGNABLE_ROLES)[number], string> = {
  gaest: "Kun offentlig visning. Ingen scoreboard.",
  bruger: "Egen tavle og egne funktioner. Ingen administration.",
  scoreboard_admin: "Køre live scoreboard: point, spillere, timer, kampe og remote.",
  administrer_scoreboard: "Alt scoreboard-admin kan, plus turneringer, spillere og import.",
  admin: "Brugere, pubber, indstillinger og scoreboard. Ikke andre managere.",
  administrator_manager: "Fuld adgang, også andre administratorer og managere.",
};

const SCOREBOARD_RUN: Permission[] = [
  "VIEW_PUBLIC",
  "VIEW_OWN_BOARD",
  "USE_SCOREBOARD",
  "EDIT_SCORE",
  "EDIT_PLAYER",
  "EDIT_TEAM",
  "EDIT_MATCH",
  "CONTROL_TIMER",
  "USE_REMOTE",
];

const SCOREBOARD_SETUP: Permission[] = [
  ...SCOREBOARD_RUN,
  "CREATE_TOURNAMENT",
  "EDIT_TOURNAMENT",
  "DELETE_TOURNAMENT",
  "IMPORT_PLAYERS",
  "EXPORT_RESULTS",
  "MANAGE_RULES",
  "APPROVE_RESULTS",
];

const ADMIN_PERMS: Permission[] = [
  ...SCOREBOARD_SETUP,
  "MANAGE_USERS",
  "MANAGE_ROLES",
  "MANAGE_PUBS",
  "MANAGE_SETTINGS",
  "MANAGE_SOCIAL",
  "MANAGE_ADMINS",
  "MANAGE_SUPPORT",
  "MANAGE_CONTENT",
];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  gaest: ["VIEW_PUBLIC"],
  bruger: ["VIEW_PUBLIC", "VIEW_OWN_BOARD"],
  scoreboard_admin: SCOREBOARD_RUN,
  administrer_scoreboard: SCOREBOARD_SETUP,
  admin: ADMIN_PERMS,
  administrator_manager: PERMISSIONS,
  administrer_indstillinger: ["VIEW_PUBLIC", "MANAGE_SETTINGS", "MANAGE_SOCIAL", "MANAGE_CONTENT"],
  udlejning: ["VIEW_PUBLIC", "VIEW_OWN_BOARD", "MANAGE_PUBS"],
};

export function normalizeRole(role: string): UserRole {
  if (role === "klub") return "bruger";
  if ((USER_ROLES as readonly string[]).includes(role)) return role as UserRole;
  return "gaest";
}

export function permissionsFor(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[normalizeRole(role)] ?? ROLE_PERMISSIONS.gaest;
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function hasAnyPermission(role: UserRole, permissions: readonly Permission[]): boolean {
  const owned = permissionsFor(role);
  return permissions.some((permission) => owned.includes(permission));
}

export function canAssignRoles(role: UserRole): boolean {
  return hasPermission(role, "MANAGE_ROLES");
}

export function canManageVenues(role: UserRole): boolean {
  return hasAnyPermission(role, ["MANAGE_PUBS", "MANAGE_USERS"]);
}

export function canEditSiteSettings(role: UserRole): boolean {
  return hasAnyPermission(role, ["MANAGE_SETTINGS", "MANAGE_SOCIAL"]);
}

export function canOpenBoard(role: UserRole): boolean {
  return hasAnyPermission(role, ["VIEW_OWN_BOARD", "USE_SCOREBOARD"]);
}

export function canUseScoreboard(role: UserRole): boolean {
  return canOpenBoard(role);
}

export function canRunLiveBoard(role: UserRole): boolean {
  return hasPermission(role, "USE_SCOREBOARD");
}

export function canManageTournament(role: UserRole): boolean {
  return hasPermission(role, "EDIT_TOURNAMENT");
}

export function canOpenAdmin(role: UserRole): boolean {
  return hasAnyPermission(role, ["MANAGE_USERS", "MANAGE_PUBS", "MANAGE_SETTINGS", "MANAGE_ROLES"]);
}

/** Hjemmesidens indhold: sider, sektioner og billeder (CMS). */
export function canManageContent(role: UserRole): boolean {
  return hasPermission(role, "MANAGE_CONTENT");
}
