/**
 * Hvile: sider der spørger serveren med faste mellemrum, holder pause når ingen bruger dem,
 * så databasen kan sove (ellers bruges månedens kvote op af faner, der står åbne natten over).
 */
const AFTER = 30 * 60_000;
let last = Date.now();
let started = false;

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const bump = () => {
    last = Date.now();
  };
  for (const e of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(e, bump, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) bump();
  });
}

/** Kald når der skete noget (fx nye data), så siden holder sig vågen. */
export function markActive() {
  last = Date.now();
}

/**
 * Må siden spørge serveren nu?
 * - aktiv (brugt inden for 30 min): ja
 * - passiv visning (TV/OBS): kun hvert 15. min den første time, derefter hver time
 * - ellers: nej, indtil nogen bruger siden igen
 */
export function pollAllowed(state: { t: number }, passive = false): boolean {
  start();
  const idle = Date.now() - last;
  if (idle < AFTER) return !(typeof document !== "undefined" && document.hidden && !passive);
  if (!passive) return false;
  const gap = idle < AFTER + 3_600_000 ? 15 * 60_000 : 60 * 60_000;
  if (Date.now() - state.t < gap) return false;
  state.t = Date.now();
  return true;
}
