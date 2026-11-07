import { buttonImage } from "./icons";
import streamDeck, { SingletonAction, type KeyDownEvent, type WillAppearEvent, type DidReceiveSettingsEvent, type SendToPluginEvent, type JsonValue, type KeyAction } from "@elgato/streamdeck";

/**
 * BanditBoard Live – Stream Deck-plugin.
 * Hver tast sender et knaptryk til BanditBoard Live. Det åbne scoreboard (i browseren) udfører
 * trykket præcis som et klik. Virker uanset om OBS/Streamlabs har fokus.
 */

type Globals = { server?: string; token?: string; autoLayout?: string };
type ButtonSettings = { a?: string; v?: string; label?: string; confirm?: boolean; okMark?: boolean; plainTitle?: boolean };
type ScoreSettings = { side?: string; press?: string };
type Side = { name: string; score: number | string; on: boolean };
type Status = { table?: string; game?: boolean; mode?: string; over?: boolean; paused?: boolean; active?: string; round?: number; target?: number | null; sides?: Side[] };
type Remote = { online: boolean; statusAt: string | null; catalog: { a: string; v: string; label: string; group: string }[]; status: Status };

const DEFAULT_SERVER = "https://www.banditboardlive.com";
let globals: Globals = {};
let last: Remote | null = null;
let lastError = "";

const server = () => (globals.server?.trim() || DEFAULT_SERVER).replace(/\/+$/, "");
const token = () => globals.token?.trim() || "";

async function api<T>(path: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  if (!token()) throw new Error("Indsæt din Stream Deck-nøgle fra scoreboardet (🎛 Stream Deck).");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(server() + path, {
      ...init,
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(j.error || `Serverfejl (${r.status})`);
    return j;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("BanditBoard Live svarer ikke – tjek internetforbindelsen.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/* ---------- tast-grafik ---------- */
const escXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
function fit(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function svg(body: string, border = "#1E293B") {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="18" fill="#0B1222"/><rect x="4" y="4" width="136" height="136" rx="15" fill="none" stroke="${border}" stroke-width="6"/>${body}</svg>`;
  return "data:image/svg+xml;charset=utf8," + encodeURIComponent(s);
}
function scoreImage(st: Status | undefined, sideKey: string, online: boolean) {
  if (!online) return svg(`<text x="72" y="64" font-family="Arial" font-size="20" font-weight="700" fill="#94A3B8" text-anchor="middle">Scoreboard</text><text x="72" y="92" font-family="Arial" font-size="20" font-weight="700" fill="#94A3B8" text-anchor="middle">ikke åbent</text>`);
  if (!st?.game || !st.sides?.length) return svg(`<text x="72" y="80" font-family="Arial" font-size="22" font-weight="700" fill="#94A3B8" text-anchor="middle">Ingen kamp</text>`);
  if (sideKey === "turn") {
    const name = fit(st.active || st.sides.find((x) => x.on)?.name || "–", 12);
    return svg(`<text x="72" y="40" font-family="Arial" font-size="18" font-weight="700" fill="#22D3EE" text-anchor="middle">${st.over ? "SLUT" : st.paused ? "PAUSE" : "DIN TUR"}</text><text x="72" y="84" font-family="Arial" font-size="${name.length > 9 ? 20 : 26}" font-weight="800" fill="#F8FAFC" text-anchor="middle">${escXml(name)}</text><text x="72" y="120" font-family="Arial" font-size="18" fill="#94A3B8" text-anchor="middle">Runde ${st.round ?? 1}</text>`, "#22D3EE");
  }
  const side = sideKey === "active" ? st.sides.find((x) => x.on) ?? st.sides[0] : st.sides[Number(sideKey) || 0];
  if (!side) return svg(`<text x="72" y="80" font-family="Arial" font-size="20" fill="#94A3B8" text-anchor="middle">Ingen spiller ${Number(sideKey) + 1}</text>`);
  const score = String(side.score ?? 0);
  const size = score.length <= 2 ? 72 : score.length === 3 ? 58 : 44;
  return svg(
    `<text x="72" y="34" font-family="Arial" font-size="20" font-weight="700" fill="${side.on ? "#22D3EE" : "#CBD5E1"}" text-anchor="middle">${escXml(fit(side.name || "–", 11))}</text><text x="72" y="${92 + size / 4}" font-family="Arial Black, Arial" font-size="${size}" font-weight="900" fill="#F8FAFC" text-anchor="middle">${escXml(score)}</text>`,
    side.on && !st.over ? "#22D3EE" : "#1E293B",
  );
}


const emptyButton = () =>
  "data:image/svg+xml;charset=utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="20" fill="#0B1222"/><rect x="4" y="4" width="136" height="136" rx="16" fill="none" stroke="#FF5B1F" stroke-width="4" stroke-dasharray="10 8"/><text x="72" y="68" font-family="Arial" font-size="20" font-weight="700" fill="#CBD5E1" text-anchor="middle">Vælg</text><text x="72" y="94" font-family="Arial" font-size="20" font-weight="700" fill="#CBD5E1" text-anchor="middle">knap</text></svg>`);
async function paintButton(action: { setImage: (i?: string) => Promise<void>; setTitle: (t?: string) => Promise<void> }, s: ButtonSettings) {
  if (!s.a) {
    await action.setImage(emptyButton());
    await action.setTitle("");
    return;
  }
  if (s.plainTitle) {
    await action.setImage(undefined);
    await action.setTitle(wrap(s.label || s.a));
    return;
  }
  await action.setImage(buttonImage(s.a, s.v ?? "", s.label || s.a));
  await action.setTitle("");
}


/* ---------- hurtig-opsætning: tomme taster konfigurerer sig selv efter placering ---------- */
type Slot = { a: string; v?: string; label: string };
const LAYOUTS: Record<string, (Slot | null)[][]> = {
  spil: [
    [null, null, null, { a: "tstart", label: "Start tur" }, { a: "tprev", label: "Forrige" }, { a: "tnextp", label: "Næste spiller" }, { a: "tnextt", label: "Næste tur" }, { a: "rpause", label: "Pause" }],
    [{ a: "add", v: "2#kegle", label: "Kegle +2" }, { a: "add", v: "6#konge", label: "Konge alene +6" }, { a: "add", v: "4#roedt", label: "Rødt / blegt +4" }, { a: "add", v: "2#hul", label: "Hvid i hul +2" }, { a: "add", v: "16#alle", label: "Alle kegler +16" }, { a: "foul", v: "0", label: "Fejl point" }, { a: "foul", v: "2", label: "Rød i hul" }, { a: "foul", v: "6", label: "Fejl 6 + point" }],
    [{ a: "dig", v: "1", label: "1" }, { a: "dig", v: "2", label: "2" }, { a: "dig", v: "3", label: "3" }, { a: "dig", v: "4", label: "4" }, { a: "dig", v: "5", label: "5" }, { a: "bk", label: "Slet ciffer" }, { a: "sign", label: "Minus" }, { a: "kent", label: "Enter" }],
    [{ a: "dig", v: "6", label: "6" }, { a: "dig", v: "7", label: "7" }, { a: "dig", v: "8", label: "8" }, { a: "dig", v: "9", label: "9" }, { a: "dig", v: "0", label: "0" }, { a: "plus", label: "Læg til serien" }, { a: "undo", label: "Fortryd slag" }, { a: "__next", label: "Næste / Serie slut" }],
  ],
  kamp: [
    [{ a: "__skt", v: "1", label: "Skæve af spiller 1" }, { a: "__skt", v: "2", label: "Skæve af spiller 2" }, { a: "sk", v: "2", label: "−2" }, { a: "sk", v: "4", label: "−4" }, { a: "sk", v: "6", label: "−6" }, { a: "sk", v: "8", label: "−8" }, { a: "sk", v: "10", label: "−10" }, { a: "sk", v: "12", label: "−12" }],
    [{ a: "sk", v: "14", label: "−14" }, { a: "sk", v: "16", label: "−16" }, { a: "__undo", label: "Fortryd" }, null, { a: "tmstart", label: "Timer" }, { a: "rpause", label: "Pause" }, { a: "reserve", label: "Reserver" }, { a: "end", label: "Afslut" }],
    [{ a: "view", v: "classic", label: "Klassisk" }, { a: "view", v: "duo", label: "2-spiller" }, { a: "view", v: "modern", label: "Moderne" }, { a: "view", v: "big", label: "TV" }, null, null, null, { a: "breset", label: "Nulstil tavle" }],
    [{ a: "bsel", v: "bord_1", label: "Bord 1" }, { a: "bsel", v: "bord_2", label: "Bord 2" }, { a: "bsel", v: "bord_3", label: "Bord 3" }, { a: "bsel", v: "bord_4", label: "Bord 4" }, null, null, null, null],
  ],
};
function autoSlot(coords: { row: number; column: number } | undefined): Slot | null {
  const L = globals.autoLayout ? LAYOUTS[globals.autoLayout] : undefined;
  if (!L || !coords) return null;
  return L[coords.row]?.[coords.column] ?? null;
}
const SCORE_AUTO: Record<number, string> = { 0: "0", 1: "turn", 2: "1" };

/* ---------- Scoreboard-knap ---------- */
class ButtonAction extends SingletonAction<ButtonSettings> {
  override readonly manifestId = "com.banditboardlive.scoreboard.button";
  private busy = new Set<string>();

  override async onWillAppear(ev: WillAppearEvent<ButtonSettings>) {
    let settings = ev.payload.settings;
    if (!settings.a && "coordinates" in ev.payload) {
      const slot = autoSlot(ev.payload.coordinates as { row: number; column: number });
      if (slot) {
        settings = { a: slot.a, v: slot.v ?? "", label: slot.label };
        await ev.action.setSettings(settings);
      }
    }
    if (ev.action.isKey()) await paintButton(ev.action, settings);
  }
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ButtonSettings>) {
    if (ev.action.isKey()) await paintButton(ev.action, ev.payload.settings);
  }
  override async onKeyDown(ev: KeyDownEvent<ButtonSettings>) {
    const { a, v = "", okMark } = ev.payload.settings;
    if (!a) {
      await ev.action.showAlert();
      return;
    }
    if (this.busy.has(ev.action.id)) return;
    this.busy.add(ev.action.id);
    try {
      const r = await api<{ ok: boolean; message: string }>("/api/streamdeck", { method: "POST", body: JSON.stringify({ a, v, source: "streamdeck" }) }, 8000);
      if (!r.ok) {
        streamDeck.logger.warn(`Tryk på ${a}/${v} blev afvist: ${r.message}`);
        await ev.action.showAlert();
      } else if (okMark && ev.action.isKey()) await ev.action.showOk();
      kickPoll();
    } catch (e) {
      streamDeck.logger.error(`Tryk fejlede: ${(e as Error).message}`);
      await ev.action.showAlert();
    } finally {
      this.busy.delete(ev.action.id);
    }
  }
  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, ButtonSettings>) {
    await handlePi(ev.payload);
  }
}
function wrap(label: string) {
  const words = label.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const l = lines[lines.length - 1];
    if (l && (l + " " + w).length <= 9) lines[lines.length - 1] = l + " " + w;
    else lines.push(w);
  }
  return lines.slice(0, 3).join("\n");
}

/* ---------- Score / tur-visning ---------- */
class ScoreAction extends SingletonAction<ScoreSettings> {
  override readonly manifestId = "com.banditboardlive.scoreboard.score";
  override async onWillAppear(ev: WillAppearEvent<ScoreSettings>) {
    let settings = ev.payload.settings;
    const c = "coordinates" in ev.payload ? (ev.payload.coordinates as { row: number; column: number }) : undefined;
    if (settings.side === undefined && globals.autoLayout === "spil" && c && c.row === 0 && SCORE_AUTO[c.column]) {
      settings = { side: SCORE_AUTO[c.column] };
      await ev.action.setSettings(settings);
    }
    if (ev.action.isKey()) await paint(ev.action, settings);
    ensurePolling();
  }
  override async onWillDisappear(ev: { action: { id: string } }) {
    painted.delete(ev.action.id);
    ensurePolling();
  }
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ScoreSettings>) {
    if (ev.action.isKey()) await paint(ev.action, ev.payload.settings);
  }
  override async onKeyDown(ev: KeyDownEvent<ScoreSettings>) {
    const press = ev.payload.settings.press || "";
    if (!press) {
      kickPoll();
      return;
    }
    try {
      const r = await api<{ ok: boolean; message: string }>("/api/streamdeck", { method: "POST", body: JSON.stringify({ a: press, v: "", source: "streamdeck" }) }, 8000);
      if (!r.ok) await ev.action.showAlert();
      kickPoll();
    } catch {
      await ev.action.showAlert();
    }
  }
  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, ScoreSettings>) {
    await handlePi(ev.payload);
  }
}

const buttonAction = new ButtonAction();
const scoreAction = new ScoreAction();

const painted = new Map<string, string>();
async function paint(action: KeyAction<ScoreSettings>, settings?: ScoreSettings) {
  const s = settings ?? ((await action.getSettings()) as ScoreSettings);
  const img = scoreImage(last?.status, s.side ?? "0", Boolean(last?.online));
  if (painted.get(action.id) === img) return;
  painted.set(action.id, img);
  await action.setImage(img);
  await action.setTitle("");
}
async function paintAll() {
  for (const a of scoreAction.actions) if (a.isKey()) await paint(a).catch(() => undefined);
}

/* ---------- status-hentning (long-poll, kun når der er score-taster eller et åbent indstillingsvindue) ---------- */
let polling = false;
let piOpen = false;
let kick: (() => void) | null = null;
function wanted() {
  return Boolean(token()) && (piOpen || [...scoreAction.actions].length > 0);
}
function kickPoll() {
  kick?.();
}
async function refresh(wait: number) {
  const since = wait && last?.statusAt ? `&since=${encodeURIComponent(last.statusAt)}` : "";
  last = await api<Remote>(`/api/streamdeck?status=1&wait=${wait}${since}`, {}, wait + 10000);
  lastError = "";
}
function ensurePolling() {
  if (polling || !wanted()) return;
  polling = true;
  void (async () => {
    let fails = 0;
    while (wanted()) {
      try {
        await refresh(8000);
        fails = 0;
        await paintAll();
        await pushToPi();
      } catch (e) {
        lastError = (e as Error).message;
        fails++;
        if (last) last = { ...last, online: false };
        await paintAll();
        await pushToPi();
        await new Promise<void>((r) => {
          const t = setTimeout(r, Math.min(30000, 2000 * fails));
          kick = () => {
            clearTimeout(t);
            r();
          };
        });
        kick = null;
      }
    }
    polling = false;
  })();
}

/* ---------- indstillingsvinduet (property inspector) ---------- */
async function pushToPi() {
  if (!piOpen) return;
  await streamDeck.ui.current
    ?.sendToPropertyInspector({ event: "remote", online: Boolean(last?.online), error: lastError, catalog: last?.catalog ?? [], status: (last?.status ?? {}) as JsonValue, server: server(), hasToken: Boolean(token()) })
    .catch(() => undefined);
}
async function handlePi(payload: JsonValue) {
  const p = (payload ?? {}) as { event?: string };
  if (p.event === "refresh") {
    try {
      await refresh(0);
    } catch (e) {
      lastError = (e as Error).message;
      last = last ? { ...last, online: false } : null;
    }
    await pushToPi();
    await paintAll();
  }
}
streamDeck.ui.onDidAppear(() => {
  piOpen = true;
  ensurePolling();
});
streamDeck.ui.onDidDisappear(() => {
  piOpen = false;
});

streamDeck.settings.onDidReceiveGlobalSettings<Globals>((ev) => {
  const changed = ev.settings.token !== globals.token || ev.settings.server !== globals.server;
  globals = ev.settings;
  if (changed) {
    last = null;
    void handlePi({ event: "refresh" });
    kickPoll();
    ensurePolling();
  }
});

streamDeck.actions.registerAction(buttonAction);
streamDeck.actions.registerAction(scoreAction);
await streamDeck.connect();
globals = await streamDeck.settings.getGlobalSettings<Globals>();
ensurePolling();
