export const SUPPORT_CATEGORIES = [
  "Teknisk hjælp",
  "Bruger/konto",
  "Turnering",
  "Resultat/point",
  "LIVE-scoreboard",
  "Mobilapp",
  "Forslag",
  "Fejlrapport",
  "Samarbejde",
  "Andet",
] as const;

export const SUPPORT_STATUSES = ["new", "open", "waiting", "solved", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const STATUS_LABEL: Record<SupportStatus, string> = {
  new: "Ny",
  open: "Under behandling",
  waiting: "Afventer bruger",
  solved: "Løst",
  closed: "Lukket",
};
