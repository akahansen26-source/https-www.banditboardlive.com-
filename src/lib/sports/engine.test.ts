import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultValues, replayProblem, SPORTS, summarize, validateEvent, validateRuleSet, sportById, actionsFor } from "./engine.ts";
import type { MatchEvent, Participant, RuleValues } from "./types.ts";
import { computeStandings, knockoutFirstRound, roundRobin } from "./standings.ts";
import { checkout } from "./families/darts.ts";
import { scoreGame } from "./families/bowling.ts";

const AB: Participant[] = [{ id: "a", name: "Hjemme" }, { id: "b", name: "Ude" }];

/** Lille testkamp: tilføjer hændelser med validering, som serveren gør. */
function match(sportId: string, over: RuleValues = {}, participants: Participant[] = AB, customEvents?: Parameters<typeof summarize>[0]["customEvents"]) {
  const sport = sportById(sportId)!;
  const m = { sportId, rules: { ...defaultValues(sport), ...over }, participants, customEvents };
  const events: MatchEvent[] = [];
  let t = 1_000_000;
  return {
    m,
    events,
    /** Tilføj; returnerer fejl eller null */
    add(type: string, side?: string, data?: Record<string, unknown>, extra: Partial<MatchEvent> = {}) {
      t += 1000;
      const ev: MatchEvent = { id: `e${events.length + 1}`, seq: events.length + 1, at: t, type, side, data, ...extra };
      const err = validateEvent(m, events, ev);
      if (!err) events.push(ev);
      return err;
    },
    ok(type: string, side?: string, data?: Record<string, unknown>, extra: Partial<MatchEvent> = {}) {
      const err = this.add(type, side, data, extra);
      assert.equal(err, null, `${type} burde være gyldig: ${err}`);
    },
    wait(ms: number) { t += ms; },
    sum() {
      // genafspil: en gyldig hændelsesrække skal også være gyldig ved genberegning
      if (!events.some((e) => e.voided)) assert.equal(replayProblem(m, events), null, "genafspil fejlede");
      return summarize(m, events, t);
    },
    void(id: string) { const e = events.find((x) => x.id === id); if (e) e.voided = { at: t, reason: "test" }; },
  };
}

describe("katalog", () => {
  it("alle sportsgrene har gyldige standardregler og et modul", () => {
    for (const s of SPORTS) {
      const v = defaultValues(s);
      const { errors } = validateRuleSet(s, v, s.customEvents ?? []);
      assert.deepEqual(errors, [], `${s.id}: ${errors.join(" ")}`);
      assert.ok(actionsFor({ sportId: s.id, rules: v, participants: AB }, []).length > 0, s.id);
      if (s.variants) for (const va of s.variants) assert.deepEqual(validateRuleSet(s, defaultValues(s, va.id), s.customEvents ?? []).errors, [], `${s.id}/${va.id}`);
    }
  });
  it("modstridende regler giver fejl", () => {
    const s = sportById("fodbold")!;
    const r = validateRuleSet(s, { ...defaultValues(s), allowDraw: false, extraTime: false, shootout: false });
    assert.ok(r.errors.some((e) => /kan ikke afgøres/.test(e)));
    assert.ok(validateRuleSet(s, { ...defaultValues(s), periodMin: -5 }).errors.length > 0);
    assert.ok(validateRuleSet(s, { ...defaultValues(s), cards: "ja" as unknown as boolean }).errors.length > 0);
  });
});

describe("fodbold", () => {
  it("mål, selvmål og straffespark tildelt tæller korrekt", () => {
    const g = match("fodbold");
    assert.match(String(g.add("goal", "a")), /Start kampen/);
    g.ok("start");
    g.ok("goal", "a", undefined, { player: "Jensen", minute: 12 });
    g.ok("penalty_awarded", "b");
    assert.equal(g.sum().scores[1].main, "0", "tildelt straffespark er ikke et mål");
    g.ok("penalty_goal", "b", undefined, { player: "Hansen" });
    g.ok("own_goal", "b", undefined, { player: "Nielsen" });
    const s = g.sum();
    assert.equal(s.scores[0].main, "2");
    assert.equal(s.scores[1].main, "1");
  });
  it("andet gule kort = udvisning, og den udviste kan ikke score", () => {
    const g = match("fodbold");
    g.ok("start");
    g.ok("yellow", "a", undefined, { player: "Jensen" });
    g.ok("yellow", "a", undefined, { player: "Jensen" });
    assert.match(String(g.add("goal", "a", undefined, { player: "Jensen" })), /ude af kampen/);
    assert.match(String(g.add("yellow", "a", undefined, { player: "jensen" })), /allerede ude/);
    assert.ok(g.sum().feed.some((f) => /udvisning/.test(f.text)));
  });
  it("kort påvirker ikke stillingen; kort kan slås fra", () => {
    const g = match("fodbold", { cards: false });
    g.ok("start");
    assert.match(String(g.add("yellow", "a", undefined, { player: "X" })), /slået fra/);
  });
  it("uafgjort, ligapoint 3-1-0 og afslutning før tid", () => {
    const g = match("fodbold");
    g.ok("start");
    assert.match(String(g.add("finish")), /perioder/);
    g.ok("period_end"); g.ok("period_start"); g.ok("goal", "a"); g.ok("goal", "b"); g.ok("finish");
    const s = g.sum();
    assert.equal(s.draw, true);
    assert.deepEqual(s.results.map((r) => r.points), [1, 1]);
  });
  it("knockout: ekstra spilletid og straffesparkskonkurrence afgør", () => {
    const g = match("fodbold", { allowDraw: false, extraTime: true, shootout: true });
    g.ok("start"); g.ok("period_end"); g.ok("period_start"); g.ok("period_end");
    assert.match(String(g.add("finish")), /ikke ende uafgjort/);
    assert.match(String(g.add("so", "a", { scored: true })), /forlænget/i);
    g.ok("period_start"); g.ok("period_end"); g.ok("period_start"); g.ok("period_end");
    assert.match(String(g.add("finish")), /straffe/i);
    g.ok("so", "a", { scored: true }); g.ok("so", "b", { scored: false }); g.ok("so", "a", { scored: true });
    g.ok("finish");
    const s = g.sum();
    assert.equal(s.winnerId, "a");
    assert.match(s.resultType, /straffesparks/i);
    assert.equal(s.scores[0].sub, "(2)");
  });
  it("annulleret mål tæller ikke (historik bevares)", () => {
    const g = match("fodbold");
    g.ok("start"); g.ok("goal", "a"); g.ok("goal", "a");
    g.void("e3");
    assert.equal(g.sum().scores[0].main, "1");
    assert.equal(g.events.length, 3);
  });
  it("kampuret tæller op og fortsætter i 2. halvleg fra 45", () => {
    const g = match("fodbold");
    g.ok("start"); g.wait(10 * 60000);
    const s = g.sum();
    assert.equal(Math.floor(s.clock!.elapsedMs / 60000), 10);
    g.ok("period_end"); g.ok("period_start");
    assert.equal(g.sum().clock!.offsetMin, 45);
  });
  it("walkover og diskvalifikation", () => {
    const g = match("fodbold"); g.ok("start"); g.ok("walkover", undefined, { winner: "b" });
    assert.equal(g.sum().winnerId, "b");
    const h = match("fodbold"); h.ok("start"); h.ok("disqualify", "a", { reason: "test" });
    assert.equal(h.sum().winnerId, "b");
    assert.match(String(h.add("goal", "b")), /afsluttet/);
  });
});

describe("håndbold, basketball, ishockey, rugby", () => {
  it("håndbold: 3. udvisning giver diskvalifikation", () => {
    const g = match("haandbold");
    g.ok("start");
    for (let i = 0; i < 3; i++) { g.ok("suspension", "a", undefined, { player: "Mikkel" }); g.wait(3 * 60000); }
    assert.match(String(g.add("goal", "a", undefined, { player: "Mikkel" })), /ude af kampen/);
  });
  it("håndbold: spiller på udvisning kan ikke score", () => {
    const g = match("haandbold");
    g.ok("start"); g.ok("suspension", "a", undefined, { player: "Mikkel" });
    assert.match(String(g.add("goal", "a", undefined, { player: "Mikkel" })), /tidsstraf/);
    g.wait(2 * 60000 + 1000);
    g.ok("goal", "a", undefined, { player: "Mikkel" });
  });
  it("basketball: 1/2/3 point, 5 fejl og ingen uafgjort", () => {
    const g = match("basketball");
    g.ok("start"); g.ok("p3", "a"); g.ok("p2", "b"); g.ok("p1", "b");
    assert.equal(g.sum().scores[0].main, "3");
    for (let i = 0; i < 5; i++) g.ok("foul", "a", { kind: "personal" }, { player: "Lee" });
    assert.match(String(g.add("p2", "a", undefined, { player: "Lee" })), /ude af kampen/);
    for (let i = 0; i < 3; i++) { g.ok("period_end"); g.ok("period_start"); }
    g.ok("period_end");
    assert.match(String(g.add("finish")), /uafgjort/i);
  });
  it("ishockey: sejr i overtid giver 2-1", () => {
    const g = match("ishockey");
    g.ok("start"); for (let i = 0; i < 2; i++) { g.ok("period_end"); g.ok("period_start"); } g.ok("period_end");
    g.ok("period_start"); g.ok("goal", "b"); g.ok("finish");
    const s = g.sum();
    assert.equal(s.winnerId, "b");
    assert.deepEqual(s.results.map((r) => r.points), [1, 2]);
  });
  it("rugby: 4 forsøg og snævert nederlag giver bonuspoint", () => {
    const g = match("rugby");
    g.ok("start"); for (let i = 0; i < 4; i++) g.ok("try", "a"); g.ok("pen_goal", "b"); g.ok("pen_try", "b"); g.ok("drop", "b"); g.ok("try", "b"); g.ok("conversion", "b");
    g.ok("period_end"); g.ok("period_start"); g.ok("finish");
    const s = g.sum();
    assert.equal(s.scores[0].main, "20"); assert.equal(s.scores[1].main, "20");
    const h = match("rugby"); h.ok("start"); for (let i = 0; i < 4; i++) h.ok("try", "a"); h.ok("try", "b"); h.ok("try", "b"); h.ok("try", "b"); h.ok("pen_goal", "b"); h.ok("period_end"); h.ok("period_start"); h.ok("finish");
    const t = h.sum();
    assert.equal(t.winnerId, "a");
    assert.deepEqual(t.results.map((r) => r.points), [5, 1]); // 4 + forsøgsbonus · tabt med 2 = bonus
  });
});

describe("sætsport", () => {
  it("volleyball: 3-2 giver 2-1 point, afgørende sæt til 15", () => {
    const g = match("volleyball");
    g.ok("start");
    const set = (w: string, l: string, wp: number, lp: number) => { for (let i = 0; i < lp; i++) { g.ok("point", w); g.ok("point", l); } for (let i = lp; i < wp; i++) g.ok("point", w); };
    set("a", "b", 25, 23); set("b", "a", 25, 20); set("a", "b", 26, 24); set("b", "a", 25, 10); set("a", "b", 15, 13);
    const s = g.sum();
    assert.equal(s.status, "finished");
    assert.equal(s.winnerId, "a");
    assert.deepEqual(s.results.map((r) => r.points), [2, 1]);
    assert.match(String(g.add("point", "a")), /afgjort/);
  });
  it("badminton: loft på 30", () => {
    const g = match("badminton");
    g.ok("start");
    for (let i = 0; i < 29; i++) { g.ok("point", "a"); g.ok("point", "b"); }
    g.ok("point", "b");
    assert.equal(g.sum().scores[1].sub, "Sæt 1");
  });
  it("bordtennis: serveskifte hver 2. bold", () => {
    const g = match("bordtennis");
    g.ok("start"); g.ok("serve", "a"); g.ok("point", "b"); g.ok("point", "b");
    assert.ok(g.sum().info.some((x) => x.includes("Ude")));
  });
  it("tennis: fordel, game, sæt og tiebreak 7-6", () => {
    const g = match("tennis");
    g.ok("start");
    const game = (w: string) => { for (let i = 0; i < 4; i++) g.ok("point", w); };
    g.ok("point", "a"); g.ok("point", "a"); g.ok("point", "a"); g.ok("point", "b"); g.ok("point", "b"); g.ok("point", "b");
    assert.equal(g.sum().scores[0].main, "40");
    g.ok("point", "a"); assert.equal(g.sum().scores[0].main, "AD");
    g.ok("point", "a");
    for (let i = 0; i < 5; i++) { game("b"); game("a"); }
    game("b");
    for (let i = 0; i < 6; i++) { g.ok("point", "a"); g.ok("point", "b"); }
    g.ok("point", "a"); g.ok("point", "a");
    const s = g.sum();
    assert.equal(s.scores[0].sub, "Sæt 1");
    assert.equal(s.scores[0].detail?.[0], "7(8)");
  });
});

describe("dart", () => {
  it("501: bust, umulige scores, turorden og checkout", () => {
    const g = match("dart", { legsToWin: 1 });
    g.ok("start");
    assert.match(String(g.add("visit", "a", { score: 179 })), /kan ikke kastes/);
    assert.match(String(g.add("visit", "b", { score: 60 })), /tur/);
    for (const [s, v] of [["a", 180], ["b", 60], ["a", 180], ["b", 60], ["a", 100]] as const) g.ok("visit", s, { score: v });
    assert.equal(g.sum().scores[0].main, "41");
    g.ok("visit", "b", { score: 60 });
    g.ok("visit", "a", { score: 41 }); // bust: 0 → nej, 41-41 = 0 gyldigt
    assert.equal(g.sum().status, "finished");
    assert.equal(g.sum().winnerId, "a");
    assert.equal(checkout(170), "T20 T20 BULL");
    assert.equal(checkout(169), "");
  });
  it("bust ved 1 tilbage og ved for meget", () => {
    const g = match("dart", { startScore: 101 });
    g.ok("start"); g.ok("visit", "a", { score: 100 });
    assert.equal(g.sum().scores[0].main, "101", "1 tilbage = bust");
    g.ok("visit", "b", { score: 60 }); g.ok("visit", "a", { score: 140 });
    assert.equal(g.sum().scores[0].main, "101");
  });
  it("cricket: luk og score", () => {
    const g = match("dartcricket", { legsToWin: 1 });
    g.ok("start");
    assert.match(String(g.add("cricket", "a", { marks: { 20: 9, 19: 3 } })), /tre pile/);
    g.ok("cricket", "a", { marks: { 20: 6 } });
    assert.equal(g.sum().scores[0].main, "60");
  });
});

describe("billard", () => {
  it("pool: race to, tre fejl i træk (9-ball)", () => {
    const g = match("pool9", { raceTo: 2 });
    g.ok("start"); g.ok("rack", "a"); g.ok("foul", "b"); g.ok("foul", "b"); g.ok("foul", "b");
    const s = g.sum();
    assert.equal(s.status, "finished");
    assert.equal(s.winnerId, "a");
  });
  it("snooker: rækkefølge, fejl og frame", () => {
    const g = match("snooker", { reds: 1, framesToWin: 1 });
    g.ok("start");
    assert.match(String(g.add("pot", "a", { ball: "black" })), /rød/);
    g.ok("pot", "a", { ball: "red" }); g.ok("pot", "a", { ball: "black" });
    assert.match(String(g.add("pot", "a", { ball: "pink" })), /gul/);
    g.ok("foul", "a", { value: 4 });
    for (const c of ["yellow", "green", "brown", "blue", "pink", "black"]) g.ok("pot", "a", { ball: c });
    const s = g.sum();
    assert.equal(s.status, "finished");
    assert.equal(s.winnerId, "a");
  });
});

describe("skomager, quiz og egne regler", () => {
  const evs = [
    { id: "k", name: "Kegle", description: "", value: 2, sign: 1 as const, target: "self" as const, repeatable: true, needsApproval: false, show: true },
    { id: "s", name: "Skæv", description: "", value: 5, sign: 1 as const, target: "opponents" as const, repeatable: true, needsApproval: false, show: true },
    { id: "b", name: "Bonus", description: "", value: 10, sign: 1 as const, target: "self" as const, repeatable: false, needsApproval: true, show: true },
  ];
  const three: Participant[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  it("point til egen side og til modstanderne", () => {
    const g = match("skomager", {}, three, evs);
    g.ok("start"); g.ok("custom", "a", { eventId: "k", count: 3 }); g.ok("custom", "b", { eventId: "s" });
    const s = g.sum();
    const by = Object.fromEntries(s.scores.map((x) => [x.id, x.main]));
    assert.deepEqual(by, { a: "11", b: "0", c: "5" });
  });
  it("godkendelse og engangs-hændelser", () => {
    const g = match("skomager", {}, three, evs);
    g.ok("start"); g.ok("custom", "a", { eventId: "b" });
    assert.equal(g.sum().scores.find((x) => x.id === "a")?.main, "0");
    g.ok("approve", undefined, { ref: "e2" });
    assert.equal(g.sum().scores.find((x) => x.id === "a")?.main, "10");
    assert.match(String(g.add("custom", "a", { eventId: "b" })), /én gang/);
    assert.match(String(g.add("adjust", "a", { delta: 0 })), /helt tal/);
    g.ok("adjust", "a", { delta: -6 });
    assert.equal(g.sum().scores.find((x) => x.id === "a")?.main, "4");
  });
  it("mål nået afslutter og giver placering", () => {
    const g = match("skomager", { targetScore: 10 }, three, evs);
    g.ok("start"); g.ok("custom", "c", { eventId: "k", count: 5 });
    const s = g.sum();
    assert.equal(s.status, "finished"); assert.equal(s.winnerId, "c");
  });
  it("quiz: runder og minuspoint", () => {
    const g = match("quiz", { rounds: 1, pointsWrong: 1 }, three);
    g.ok("start"); g.ok("answer", "a", { correct: true, bonus: 2 }); g.ok("answer", "b", { correct: false }); g.ok("round_next");
    const s = g.sum();
    assert.equal(s.status, "finished"); assert.equal(s.winnerId, "a");
  });
});

describe("bowling og golf", () => {
  it("bowling: 300, spares og validering", () => {
    assert.equal(scoreGame(Array(12).fill(10)).total, 300);
    assert.equal(scoreGame(Array(21).fill(5)).total, 150);
    assert.equal(scoreGame(Array(20).fill(0).map((_, i) => (i % 2 ? 0 : 9))).total, 90);
    const g = match("bowling", { games: 1 }, [{ id: "a", name: "A" }]);
    g.ok("start"); g.ok("roll", "a", { pins: 7 });
    assert.match(String(g.add("roll", "a", { pins: 4 })), /kun 3/);
    g.ok("roll", "a", { spare: true });
    assert.equal(g.sum().scores[0].detail?.[0], "7/");
  });
  it("golf: slagspil med strafslag, stableford og hulspil", () => {
    const g = match("golf", { holes: 3, par: [4, 3, 5] }, [{ id: "a", name: "A" }, { id: "b", name: "B" }]);
    g.ok("start");
    g.ok("hole", "a", { hole: 1, strokes: 4 }); g.ok("hole", "a", { hole: 2, strokes: 2, penalties: 2 }); g.ok("hole", "a", { hole: 3, strokes: 5 });
    assert.match(String(g.add("hole", "a", { hole: 2, strokes: 3 })), /allerede/);
    g.ok("hole", "b", { hole: 1, strokes: 3 }); g.ok("hole", "b", { hole: 2, strokes: 3 }); g.ok("hole", "b", { hole: 3, strokes: 6 });
    const s = g.sum();
    assert.equal(s.status, "finished");
    assert.equal(s.winnerId, "b");
    assert.equal(s.scores.find((x) => x.id === "a")?.main, "+1");
    const st = match("golf", { holes: 2, par: [4, 4], format: "stableford" }, [{ id: "a", name: "A" }]);
    st.ok("start"); st.ok("hole", "a", { hole: 1, strokes: 3 }); st.ok("hole", "a", { hole: 2, strokes: 7 });
    assert.equal(st.sum().scores[0].main, "3 p");
    const mp = match("golf", { holes: 5, par: [4, 4, 4, 4, 4], format: "match" });
    mp.ok("start");
    for (let h = 1; h <= 3; h++) { mp.ok("hole", "a", { hole: h, strokes: 3 }); mp.ok("hole", "b", { hole: h, strokes: 5 }); }
    const ms = mp.sum();
    assert.equal(ms.status, "finished"); assert.equal(ms.resultType, "3 & 2");
  });
});

describe("motorsport og tidskonkurrencer", () => {
  const P: Participant[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  it("tidsstraf tælles én gang; placeringstab flytter kun placering; DNF bagerst", () => {
    const g = match("motorsport", { laps: 2, bonusFastestLap: true }, P);
    g.ok("start");
    for (const [s, t] of [["a", 60000], ["b", 60500], ["c", 61000], ["a", 60000], ["b", 60500]] as const) g.ok("lap", s, { ms: t });
    g.ok("status", "c", { value: "dnf" });
    g.ok("penalty", "a", { kind: "time", value: 5, reason: "Track limits" });
    let s = g.sum();
    assert.equal(s.scores[0].id, "a", "foreslået straf tæller ikke");
    g.ok("penalty_status", undefined, { ref: g.events[g.events.length - 1].id, status: "approved" });
    s = g.sum();
    assert.deepEqual(s.scores.map((x) => x.id), ["b", "a", "c"]);
    assert.match(String(g.add("penalty", "b", { kind: "time", value: 0, reason: "x" })), /større end 0/);
    assert.match(String(g.add("penalty", "b", { kind: "time", value: 3 })), /årsag/);
    g.ok("finish");
    const r = g.sum().results;
    const pts = Object.fromEntries(r.map((x) => [x.id, x.points]));
    assert.equal(pts.b, 25); assert.equal(pts.a, 18 + 1); assert.equal(pts.c, 0);
  });
  it("placeringstab uden tidstillæg", () => {
    const g = match("motorsport", { laps: 1, penaltyApproval: false }, P);
    g.ok("start"); g.ok("lap", "a", { ms: 50000 }); g.ok("lap", "b", { ms: 51000 }); g.ok("lap", "c", { ms: 52000 });
    g.ok("penalty", "a", { kind: "positions", value: 1, reason: "Kollision" });
    const s = g.sum();
    assert.deepEqual(s.scores.map((x) => x.id), ["b", "a", "c"]);
    assert.equal(s.scores[1].main, "50.000");
  });
  it("atletik: tyvstart giver DSQ", () => {
    const g = match("loeb", {}, P);
    g.ok("start"); g.ok("false_start", "b");
    g.ok("finish_time", "a", { ms: 10500 }); g.ok("finish_time", "c", { ms: 10500 });
    const s = g.sum();
    assert.equal(s.scores.find((x) => x.id === "b")?.main, "DSQ");
    assert.equal(s.scores[0].place, 1); assert.equal(s.scores[1].place, 1, "ens tid = delt placering");
  });
  it("spring/kast: bedste forsøg og højde med tre fejl", () => {
    const g = match("atletikfelt", {}, P);
    g.ok("start");
    g.ok("attempt", "a", { value: 6.5, valid: true }); g.ok("attempt", "b", { value: 6.5, valid: true }); g.ok("attempt", "b", { value: 6.2, valid: true });
    g.ok("attempt", "a", { valid: false });
    assert.equal(g.sum().scores[0].id, "b", "andetbedste forsøg afgør");
    const h = match("atletikfelt", { mode: "height" }, P);
    h.ok("start"); assert.match(String(h.add("attempt", "a", { cleared: true })), /højden/);
    h.ok("bar", undefined, { height: 1.8 });
    for (let i = 0; i < 3; i++) h.ok("attempt", "a", { cleared: false });
    assert.match(String(h.add("attempt", "a", { cleared: true })), /ude/);
  });
});

describe("kampsport", () => {
  it("boksning: 10-point must og enstemmig/split afgørelse", () => {
    const g = match("boksning", { rounds: 1 });
    g.ok("start");
    assert.match(String(g.add("round_score", undefined, { round: 1, judge: 1, a: 9, b: 9 })), /10-point/);
    g.ok("round_score", undefined, { round: 1, judge: 1, a: 10, b: 9 });
    assert.match(String(g.add("finish")), /dommer 2/);
    g.ok("round_score", undefined, { round: 1, judge: 2, a: 9, b: 10 });
    g.ok("round_score", undefined, { round: 1, judge: 3, a: 10, b: 9 });
    g.ok("finish");
    const s = g.sum();
    assert.equal(s.winnerId, "a"); assert.equal(s.resultType, "Split-afgørelse");
  });
  it("judo: to waza-ari giver sejr; tre shido giver hansoku-make", () => {
    const g = match("judo");
    g.ok("start"); g.ok("score", "b", { kind: "wazaari" }); g.ok("score", "b", { kind: "wazaari" });
    assert.equal(g.sum().winnerId, "b");
    const h = match("judo");
    h.ok("start"); for (let i = 0; i < 3; i++) h.ok("cpenalty", "a");
    assert.equal(h.sum().winnerId, "b");
  });
  it("taekwondo: gam-jeom giver point til modstander", () => {
    const g = match("taekwondo");
    g.ok("start"); g.ok("cpenalty", "a"); g.ok("score", "a", { kind: "head" });
    assert.deepEqual(g.sum().scores.map((x) => x.main), ["3", "1"]);
  });
});

describe("skak, e-sport og rangliste", () => {
  it("skak og e-sport", () => {
    const g = match("skak"); g.ok("start"); g.ok("result", undefined, { value: "½-½" });
    assert.equal(g.sum().draw, true);
    assert.deepEqual(g.sum().results.map((r) => r.points), [0.5, 0.5]);
    const e = match("esport"); e.ok("start"); e.ok("map", "a"); e.ok("map", "b"); e.ok("map", "a", { name: "Inferno", scoreWinner: 13, scoreLoser: 9 });
    assert.equal(e.sum().winnerId, "a");
  });
  it("tie-break: point → målscore → scorede → indbyrdes", () => {
    const P = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
    const W = (w: string, l: string, gf: number, ga: number) => ({ id: `${w}${l}`, results: [{ id: w, outcome: "W" as const, scoreFor: gf, scoreAgainst: ga, points: 3 }, { id: l, outcome: "L" as const, scoreFor: ga, scoreAgainst: gf, points: 0 }] });
    const rows = computeStandings(P, [W("a", "b", 1, 0), W("b", "c", 1, 0), W("c", "a", 1, 0)], "points,diff,for,h2h");
    assert.ok(rows.every((r) => r.points === 3));
    const rows2 = computeStandings(P, [W("a", "b", 3, 0), W("b", "c", 1, 0), W("c", "a", 1, 0)], "points,diff,for,h2h");
    assert.equal(rows2[0].id, "a");
  });
  it("turneringsformater: alle-mod-alle og knockout med bye", () => {
    const rr = roundRobin(["a", "b", "c", "d"]);
    assert.equal(rr.length, 3);
    assert.equal(rr.flat().length, 6);
    const ko = knockoutFirstRound(["a", "b", "c", "d", "e"]);
    assert.equal(ko.size, 8);
    assert.equal(ko.pairs.filter((p) => p[1] === null).length, 3);
  });
});

describe("rettelser", () => {
  it("kampstart kan ikke annulleres, når der er mål efter den", () => {
    const g = match("fodbold");
    g.ok("start");
    g.ok("goal", "a");
    g.void("e1");
    assert.ok(replayProblem(g.m, g.events));
  });
  it("et mål kan annulleres uden problemer", () => {
    const g = match("fodbold");
    g.ok("start");
    g.ok("goal", "a");
    g.void("e2");
    assert.equal(replayProblem(g.m, g.events), null);
    assert.equal(g.sum().scores[0].main, "0");
  });
});
