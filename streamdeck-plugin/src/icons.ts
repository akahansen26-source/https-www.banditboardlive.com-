export const escXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const fit = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + "…" : text);
/* ---------- ikoner til Scoreboard-knap ---------- */
type Look = { big: string; cap: string; bg: [string, string]; fg?: string; bigSize?: number };
const C = {
  score: ["#FF7A1A", "#C2410C"] as [string, string],
  minus: ["#EF4444", "#991B1B"] as [string, string],
  turn: ["#22D3EE", "#0E7490"] as [string, string],
  num: ["#334155", "#0F172A"] as [string, string],
  enter: ["#22C55E", "#15803D"] as [string, string],
  game: ["#8B5CF6", "#5B21B6"] as [string, string],
  danger: ["#64748B", "#1E293B"] as [string, string],
  view: ["#3B82F6", "#1D4ED8"] as [string, string],
};
function lookFor(a: string, vRaw: string, label: string): Look {
  const v = vRaw.split("#")[0];
  const L = label.replace(/^[^\p{L}\p{N}+−-]+/u, "").trim();
  const num = L.match(/^(.*?)\s*([+−-]\s?\d+)$/);
  switch (a) {
    case "__next": case "next": return { big: "»", cap: a === "next" ? "SERIE SLUT" : "NÆSTE", bg: C.enter, bigSize: 80 };
    case "__undo": case "undo": case "pundo": return { big: "↶", cap: a === "undo" ? "FORTRYD SLAG" : "FORTRYD", bg: C.danger, bigSize: 70 };
    case "__skt": return { big: v || "1", cap: "MINUS TIL SPILLER", bg: C.minus, bigSize: 60 };
    case "dig": return { big: v, cap: "", bg: C.num, bigSize: 84 };
    case "bk": return { big: "⌫", cap: "SLET", bg: C.num, bigSize: 56 };
    case "plus": return { big: "+", cap: "LÆG TIL", bg: C.num, bigSize: 84 };
    case "sign": return { big: "−", cap: "MINUS", bg: C.minus, bigSize: 84 };
    case "kent": return { big: "↵", cap: "ENTER", bg: C.enter, bigSize: 70 };
    case "sk": return { big: "−" + v, cap: "MINUSPOINT", bg: C.minus, bigSize: v.length > 1 ? 56 : 66 };
    case "sktgt": return { big: fit(L, 8), cap: "MINUS TIL", bg: C.minus, bigSize: L.length > 6 ? 28 : 34 };
    case "foul": return v === "2" ? { big: "+2", cap: "RØD I HUL", bg: C.minus, bigSize: 60 } : v === "6" ? { big: "+6", cap: "FEJL 6", bg: C.minus, bigSize: 60 } : { big: "!", cap: "FEJL", bg: C.minus, bigSize: 70 };
    case "tstart": return { big: "▶", cap: "START TUR", bg: C.turn, bigSize: 60 };
    case "tprev": return { big: "◀", cap: "FORRIGE", bg: C.turn, bigSize: 56 };
    case "tnextp": return { big: "▶|", cap: "NÆSTE SPILLER", bg: C.turn, bigSize: 50 };
    case "tnextt": return { big: "▶▶", cap: "NÆSTE TUR", bg: C.turn, bigSize: 50 };
    case "rpause": return { big: "II", cap: "PAUSE", bg: C.game, bigSize: 60 };
    case "tmstart": case "tmpause": return { big: "◷", cap: "TIMER", bg: C.game, bigSize: 64 };
    case "tmreset": return { big: "↺", cap: "NULSTIL TIMER", bg: C.game, bigSize: 60 };
    case "breset": return { big: "↺", cap: "NULSTIL TAVLE", bg: C.danger, bigSize: 60 };
    case "end": return { big: "■", cap: "AFSLUT KAMP", bg: C.danger, bigSize: 52 };
    case "rematch": return { big: "↻", cap: "OMKAMP", bg: C.game, bigSize: 60 };
    case "reserve": return { big: "☰", cap: "RESERVER", bg: C.game, bigSize: 52 };
    case "view": return { big: "▣", cap: fit(L.toUpperCase(), 11), bg: C.view, bigSize: 56 };
    case "bsel": { const m = L.match(/Bord\s*\d+/i); return { big: m ? m[0].replace(/\D+/g, "") : "#", cap: "BORD", bg: C.view, bigSize: 64 }; }
    case "lock": return { big: "🔒", cap: fit(L.toUpperCase(), 12), bg: C.game, bigSize: 44 };
  }
  if (a === "add" || num) {
    const n = num ? num[2].replace(/\s/g, "").replace("-", "−") : "+" + v;
    const cap = (num ? num[1] : L).toUpperCase();
    return { big: n, cap: fit(cap, 13), bg: n.startsWith("−") ? C.minus : C.score, bigSize: n.length > 3 ? 50 : 62 };
  }
  return { big: "", cap: L.toUpperCase(), bg: C.game };
}
function capLines(cap: string): string[] {
  const words = cap.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const l = out[out.length - 1];
    if (l && (l + " " + w).length <= 11) out[out.length - 1] = l + " " + w;
    else out.push(w);
  }
  return out.slice(0, 3);
}
export function buttonImage(a: string, v: string, label: string) {
  const k = lookFor(a, v, label);
  const fg = k.fg ?? "#FFFFFF";
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${k.bg[0]}"/><stop offset="1" stop-color="${k.bg[1]}"/></linearGradient></defs>`;
  const caps = capLines(k.cap);
  let body = "";
  if (k.big) {
    const bs = k.bigSize ?? 60;
    const big = caps.length > 1 ? Math.min(bs, 50) : bs;
    const by = caps.length > 1 ? 58 + big * 0.32 : caps.length ? 70 + big * 0.32 : 72 + big * 0.35;
    body += `<text x="72" y="${by}" font-family="Arial Black, Arial, sans-serif" font-size="${big}" font-weight="900" fill="${fg}" text-anchor="middle">${escXml(k.big)}</text>`;
    caps.forEach((c, i) => {
      body += `<text x="72" y="${122 + i * 16 - (caps.length - 1) * 16}" font-family="Arial, sans-serif" font-size="${caps.length > 1 || c.length > 10 ? 15 : 17}" font-weight="700" fill="${fg}" fill-opacity=".92" text-anchor="middle">${escXml(c)}</text>`;
    });
  } else {
    const start = 72 - (caps.length - 1) * 13 + 8;
    caps.forEach((c, i) => {
      body += `<text x="72" y="${start + i * 26}" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="${fg}" text-anchor="middle">${escXml(c)}</text>`;
    });
  }
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${grad}<rect width="144" height="144" rx="20" fill="url(#g)"/><rect x="3" y="3" width="138" height="138" rx="18" fill="none" stroke="#FFFFFF" stroke-opacity=".18" stroke-width="3"/>${body}</svg>`;
  return "data:image/svg+xml;charset=utf8," + encodeURIComponent(s);
}
