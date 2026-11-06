/** Billard: pool (8-, 9-, 10-ball m.fl.) med racks, og snooker med point pr. kugle og frames. */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent } from "../types.ts";
import { bool, decideSpecial, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, other, statusLabel, str } from "../common.ts";

export function replayPool(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const racks: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const fouls: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const consec: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const breakRuns: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  let breaker = ids[0], done = false, rackNo = 1;
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" | "penalty" }[] = [];
  const raceTo = num(ctx.rules, "raceTo", 5);
  const winRack = (w: string, seq: number, how: string) => {
    racks[w] += 1;
    feed.push({ seq, side: w, kind: "score", text: `Rack ${rackNo} til ${nameOf(ctx, w)}${how ? ` (${how})` : ""}` });
    rackNo += 1;
    ids.forEach((i) => (consec[i] = 0));
    const mode = str(ctx.rules, "breakRule", "alternate");
    breaker = mode === "winner" ? w : mode === "loser" ? other(ctx, w) ?? w : other(ctx, breaker) ?? breaker;
    if (racks[w] >= raceTo) done = true;
  };
  for (const e of live(events)) {
    if (done || !e.side) continue;
    if (e.type === "breaker") breaker = e.side;
    if (e.type === "rack") {
      const how = String(e.data?.how ?? "");
      if (how === "break_run") breakRuns[e.side] += 1;
      winRack(e.side, e.seq, { break_run: "break and run", golden: "golden break", on_break: "kugle på break", foul_loss: "modstander lavede tabsgivende fejl", "": "" }[how] ?? how);
    }
    if (e.type === "foul") {
      fouls[e.side] += 1;
      consec[e.side] += 1;
      feed.push({ seq: e.seq, side: e.side, kind: "penalty", text: `Fejl – ${nameOf(ctx, e.side)}${e.data?.kind ? ` (${e.data.kind})` : ""}${bool(ctx.rules, "ballInHand", true) ? " · ball in hand" : ""}` });
      if (bool(ctx.rules, "threeFoul", false) && consec[e.side] >= 3) {
        const w = other(ctx, e.side);
        if (w) winRack(w, e.seq, "3 fejl i træk");
      }
    }
    if (e.type === "legal") consec[e.side] = 0;
  }
  return { racks, fouls, consec, breakRuns, breaker, done, rackNo, feed };
}

export const pool: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayPool(ctx, events);
    out.status = r.done ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, `Rack ${r.rackNo} · først til ${num(ctx.rules, "raceTo", 5)}`);
    out.scores = ctx.participants.map((p) => ({ id: p.id, name: p.name, main: String(r.racks[p.id]), sub: `Fejl ${r.fouls[p.id]}`, detail: [r.consec[p.id] ? `${r.consec[p.id]} fejl i træk` : "", r.breakRuns[p.id] ? `Break & run: ${r.breakRuns[p.id]}` : ""].filter(Boolean), active: r.breaker === p.id && !r.done }));
    if (!r.done) out.info.push(`Break: ${nameOf(ctx, r.breaker)}`);
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (r.done) { out.winnerId = Object.entries(r.racks).sort((a, b) => b[1] - a[1])[0][0]; out.resultType = `Racks ${ctx.participants.map((p) => r.racks[p.id]).join("-")}`; }
    if (out.winnerId) out.results = duelResults(ctx, out.winnerId, false, r.racks);
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replayPool(ctx, events);
    if (["rack", "foul"].includes(ev.type)) {
      if (!ev.side) return "Vælg spiller.";
      if (r.done) return "Kampen er afgjort.";
    }
    if (ev.type === "finish" && !r.done) return "Ingen har nået det antal racks, der kræves.";
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const a: ActionDef[] = [
      { type: "rack", label: "Vandt rack", side: true, tone: "score", group: "Racks", fields: [{ key: "how", label: "Måde", kind: "choice", optional: true, options: [{ value: "", label: "Almindelig" }, { value: "break_run", label: "Break and run" }, { value: "on_break", label: "Afgørende kugle på break" }, { value: "foul_loss", label: "Modstander tabte på fejl" }] }] },
      { type: "foul", label: "Fejl", side: true, tone: "penalty", group: "Fejl", fields: [{ key: "kind", label: "Fejltype", kind: "text", optional: true }] },
      { type: "breaker", label: "Har break", side: true, tone: "info", group: "Racks" },
    ];
    if (bool(ctx.rules, "threeFoul", false)) a.push({ type: "legal", label: "Lovligt stød (nulstil fejl i træk)", side: true, tone: "info", group: "Fejl" });
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};

// ---------------- Snooker ----------------
export const BALLS: Record<string, number> = { red: 1, yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 };
export const BALL_LABEL: Record<string, string> = { red: "Rød", yellow: "Gul", green: "Grøn", brown: "Brun", blue: "Blå", pink: "Pink", black: "Sort" };
const COLOURS = ["yellow", "green", "brown", "blue", "pink", "black"];

export function replaySnooker(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const frames: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  let pts: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  let reds = num(ctx.rules, "reds", 15), expect: "red" | "colour" | "sequence" = "red", nextColour = 0;
  let striker = ids[0], brk = 0;
  const highBreak: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  let frameNo = 1, done = false;
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" | "penalty" }[] = [];
  const framesToWin = num(ctx.rules, "framesToWin", 3);
  const endFrame = (w: string, seq: number, how: string) => {
    frames[w] += 1;
    feed.push({ seq, side: w, kind: "score", text: `Frame ${frameNo} til ${nameOf(ctx, w)} (${ids.map((i) => pts[i]).join("-")}${how ? `, ${how}` : ""})` });
    frameNo += 1;
    pts = Object.fromEntries(ids.map((i) => [i, 0]));
    reds = num(ctx.rules, "reds", 15); expect = "red"; nextColour = 0; brk = 0;
    if (frames[w] >= framesToWin) done = true;
  };
  for (const e of live(events)) {
    if (done) continue;
    if (e.type === "striker" && e.side) { striker = e.side; brk = 0; continue; }
    if (e.type === "pot" && e.side) {
      const ball = String(e.data?.ball ?? "");
      const v = BALLS[ball] ?? 0;
      if (e.side !== striker) { striker = e.side; brk = 0; }
      pts[e.side] += v;
      brk += v;
      highBreak[e.side] = Math.max(highBreak[e.side], brk);
      if (ball === "red") { reds = Math.max(0, reds - 1); expect = "colour"; }
      else if (expect === "colour") { expect = reds > 0 ? "red" : "sequence"; nextColour = 0; }
      else if (expect === "sequence") nextColour += 1;
      if (expect === "sequence" && nextColour >= COLOURS.length) {
        const [a, b] = ids;
        if (pts[a] !== pts[b]) endFrame(pts[a] > pts[b] ? a : b, e.seq, "");
        else if (bool(ctx.rules, "respotBlack", true)) { nextColour = COLOURS.length - 1; feed.push({ seq: e.seq, kind: "info", text: "Lige – sort genplaceres" }); }
      }
      continue;
    }
    if (e.type === "foul" && e.side) {
      const v = Math.max(num(ctx.rules, "foulMin", 4), Number(e.data?.value) || 0);
      const to = other(ctx, e.side);
      if (to) pts[to] += v;
      feed.push({ seq: e.seq, side: e.side, kind: "penalty", text: `Fejl – ${nameOf(ctx, e.side)} (${v} til ${nameOf(ctx, to)})` });
      if (e.data?.redLost && reds > 0) reds -= 1;
      striker = to ?? striker; brk = 0;
      if (expect === "colour") expect = reds > 0 ? "red" : "sequence";
      continue;
    }
    if (e.type === "miss" && e.side) { striker = other(ctx, e.side) ?? striker; brk = 0; if (expect === "colour") expect = reds > 0 ? "red" : "sequence"; continue; }
    if (e.type === "concede" && e.side) { const w = other(ctx, e.side); if (w) endFrame(w, e.seq, "opgivet"); continue; }
    if (e.type === "frame" && e.side) endFrame(e.side, e.seq, "");
  }
  const remaining = reds * 8 + (expect === "colour" ? 7 : 0) + COLOURS.slice(expect === "sequence" ? nextColour : 0).reduce((s, c) => s + BALLS[c], 0);
  return { frames, pts, reds, expect, nextColour, striker, brk, highBreak, frameNo, done, remaining, feed };
}

export const snooker: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replaySnooker(ctx, events);
    out.status = r.done ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, `Frame ${r.frameNo} · bedst af ${num(ctx.rules, "framesToWin", 3) * 2 - 1}`);
    out.scores = ctx.participants.map((p) => ({ id: p.id, name: p.name, main: String(r.pts[p.id]), sub: `Frames ${r.frames[p.id]}`, detail: [r.striker === p.id && r.brk ? `Break ${r.brk}` : "", r.highBreak[p.id] ? `Højeste break ${r.highBreak[p.id]}` : ""].filter(Boolean), active: r.striker === p.id && !r.done }));
    if (!r.done) {
      out.info.push(`Røde tilbage: ${r.reds} · point tilbage på bordet: ${r.remaining}`);
      out.info.push(r.expect === "red" ? "Næste: rød" : r.expect === "colour" ? "Næste: en farve" : `Næste: ${BALL_LABEL[COLOURS[r.nextColour]] ?? "–"}`);
      const [a, b] = ctx.participants;
      if (a && b) {
        const diff = Math.abs(r.pts[a.id] - r.pts[b.id]);
        if (diff > r.remaining) out.info.push("Snookers kræves");
      }
    }
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (r.done) { out.winnerId = Object.entries(r.frames).sort((a, b) => b[1] - a[1])[0][0]; out.resultType = `Frames ${ctx.participants.map((p) => r.frames[p.id]).join("-")}`; }
    if (out.winnerId) out.results = duelResults(ctx, out.winnerId, false, r.frames, undefined, Object.fromEntries(ctx.participants.map((p) => [p.id, { highBreak: r.highBreak[p.id] }])));
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replaySnooker(ctx, events);
    if (["pot", "foul", "miss", "frame", "concede"].includes(ev.type)) {
      if (!ev.side) return "Vælg spiller.";
      if (r.done) return "Kampen er afgjort.";
    }
    if (ev.type === "pot") {
      const ball = String(ev.data?.ball ?? "");
      if (!(ball in BALLS)) return "Vælg kugle.";
      if (bool(ctx.rules, "checkOrder", true)) {
        if (r.expect === "red" && ball !== "red") return "Der skal spilles på en rød.";
        if (r.expect === "colour" && ball === "red") return "Efter en rød skal der spilles på en farve.";
        if (r.expect === "sequence" && ball !== COLOURS[r.nextColour]) return `Nu skal ${BALL_LABEL[COLOURS[r.nextColour]]?.toLowerCase()} i hul.`;
      }
      if (ball === "red" && r.reds === 0) return "Der er ingen røde tilbage.";
    }
    if (ev.type === "foul") {
      const v = Number(ev.data?.value ?? num(ctx.rules, "foulMin", 4));
      if (v < num(ctx.rules, "foulMin", 4) || v > 7) return `En fejl giver ${num(ctx.rules, "foulMin", 4)}–7 point.`;
    }
    if (ev.type === "finish" && !r.done) return "Ingen har vundet det antal frames, der kræves.";
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const a: ActionDef[] = Object.keys(BALLS).map((b) => ({ type: "pot", label: `${BALL_LABEL[b]} (${BALLS[b]})`, side: true, tone: "score" as const, group: "Kugler", preset: { ball: b } }));
    a.push({ type: "foul", label: "Fejl", side: true, tone: "penalty", group: "Fejl og skift", fields: [{ key: "value", label: "Strafpoint (4–7)", kind: "int", min: 4, max: 7 }, { key: "redLost", label: "En rød forsvandt i fejlen", kind: "bool", optional: true }] });
    a.push({ type: "miss", label: "Ingen kugle – skift spiller", side: true, tone: "info", group: "Fejl og skift" });
    a.push({ type: "concede", label: "Opgiver frame", side: true, tone: "danger", group: "Frame" });
    a.push({ type: "frame", label: "Tildel frame", side: true, tone: "info", group: "Frame", hint: "Bruges hvis framen afgøres uden for normal rækkefølge" });
    void ctx;
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};
