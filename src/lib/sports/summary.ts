import { SPORTS } from "./catalog.ts";

/** Kort oversigt over katalogets sportsgrene til scoreboard-appen (board.html). */
export type SportSummary = {
  id: string;
  name: string;
  emoji: string;
  group: string;
  family: string;
  blurb: string;
  variants: { id: string; label: string }[];
  /** Adressen, der opretter en rigtig kamp i den fælles kampmotor med sporten valgt. */
  href: string;
};

export function sportSummaries(): SportSummary[] {
  return SPORTS.map((s) => ({
    id: s.id,
    name: s.name,
    emoji: s.emoji,
    group: s.group,
    family: s.family,
    blurb: s.blurb,
    variants: (s.variants ?? []).map((v) => ({ id: v.id, label: v.label })),
    href: `/kamp/ny?sport=${encodeURIComponent(s.id)}`,
  }));
}
