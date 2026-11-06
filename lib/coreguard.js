// BanditBoard Live – håndhævelse af rettigheder på selve data.
// Klienterne sender hele deres tilstand ("core"). Serveren sammenligner den med sin egen,
// finder præcis hvad der er ændret, og tager KUN de ændringer, som brugerens permissions tillader.
// Alt andet bliver liggende som det var, og afsenderen får serverens version tilbage.
// Desuden "projicerer" serveren data pr. modtager: andres private tavler/resultater sendes aldrig ud.

const J = x => JSON.stringify(x === undefined ? null : x);
const eq = (a, b) => J(a) === J(b);
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
// Sand hvis inc kun TILFØJER felter til base (fx standardværdier appen udfylder) – bruges til at afvise stille i stedet for med en fejlbesked
function onlyAdds(base, inc) {
  if (base === undefined || base === null) return true;
  if (typeof base !== 'object' || Array.isArray(base)) return eq(base, inc);
  if (!inc || typeof inc !== 'object' || Array.isArray(inc)) return false;
  return Object.keys(base).every(k => onlyAdds(base[k], inc[k]));
}

// ---------- hvilke permissions kræver hvilke data ----------
const SETTING_PERM = {
  view: 'USE_SCOREBOARD',
  tourName: 'EDIT_TOURNAMENT', event: 'EDIT_TOURNAMENT',
  ovTitle: 'MANAGE_LAYOUT', ovSub: 'MANAGE_LAYOUT', sponsors: 'MANAGE_LAYOUT', boards: 'MANAGE_LAYOUT', designs: 'MANAGE_LAYOUT', vis: 'MANAGE_LAYOUT',
  media: 'MANAGE_LAYOUT', sponsorLogos: 'MANAGE_LAYOUT', sponNames: 'MANAGE_LAYOUT', lookCat: 'MANAGE_LAYOUT', look: 'MANAGE_LAYOUT', sponStyle: 'MANAGE_LAYOUT', showTimerOv: 'MANAGE_LAYOUT',
  points: 'MANAGE_SCOREBOARD_SETTINGS', dartInput: 'MANAGE_SCOREBOARD_SETTINGS', minusMode: 'MANAGE_SCOREBOARD_SETTINGS', table: 'MANAGE_SCOREBOARD_SETTINGS', limits: 'MANAGE_SCOREBOARD_SETTINGS'
  // alt andet (venue, scheme, mode, font, allowSignup …) kræver MANAGE_SETTINGS
};
const settingPerm = k => SETTING_PERM[k] || 'MANAGE_SETTINGS';
const TOURNEY_PERM = { timer: 'CONTROL_TIMER', round: 'USE_SCOREBOARD', feat: 'USE_SCOREBOARD', place: 'EDIT_MATCH' };
const tourneyPerm = k => TOURNEY_PERM[k] || 'EDIT_TOURNAMENT';
const LABEL = {
  EDIT_SCORE: 'ændre score', USE_SCOREBOARD: 'styre scoreboardet', EDIT_PLAYER: 'ændre spillere', EDIT_TEAM: 'ændre hold', MANAGE_PLAYERS: 'slette spillere/hold',
  IMPORT_PLAYERS: 'importere spillere', EDIT_MATCH: 'ændre kampe', CONTROL_TIMER: 'ændre timeren', CREATE_TOURNAMENT: 'oprette turneringer', EDIT_TOURNAMENT: 'redigere turneringen',
  DELETE_TOURNAMENT: 'slette turneringer/resultater', MANAGE_LAYOUT: 'ændre layout', MANAGE_SCOREBOARD_SETTINGS: 'ændre scoreboard-indstillinger', MANAGE_SETTINGS: 'ændre systemindstillinger',
  VIEW_OWN_BOARD: 'bruge en egen tavle', OWN_BOARD_OTHER: 'styre en andens tavle'
};
const LEGACY_SETTINGS = ['adminPin', 'operator'];

// ---------- rensning af alt, der kommer fra en klient ----------
// Ingen HTML i data (forhindrer at nogen planter et script, der kører hos en administrator),
// gyldige id'er og kun rigtige billeder. Almindelige data fra appen ændres ikke af dette.
const ID = /^[\w-]{1,60}$/;
const IMG_OK = v => v === 1 || v === '' || v === 0 || v === true || v === false || v == null || (typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v));
function scrub(v, depth) {
  if (depth > 40) return null;
  if (typeof v === 'string') return v.replace(/[<>]/g, '');
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.slice(0, 20000).map(x => scrub(x, depth + 1));
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; const x = scrub(v[k], depth + 1); if (x !== undefined) o[k] = x; } return o; }
  return undefined;
}
const idList = l => Array.isArray(l) ? l.filter(x => x && typeof x === 'object' && typeof x.id === 'string' && ID.test(x.id)) : l;
function sanitize(inc) {
  const c = scrub(inc, 0) || {};
  for (const k of ['players', 'teams', 'history']) if (k in c) c[k] = idList(c[k]);
  if (Array.isArray(c.tables)) c.tables = idList(c.tables).map(t => { if (t.game && typeof t.game === 'object' && Array.isArray(t.game.sides)) t.game.sides.forEach(sd => { if (sd && typeof sd.score !== 'number') sd.score = Number(sd.score) || 0; }); return t; });
  if (c.tourney && typeof c.tourney === 'object' && 'matches' in c.tourney) c.tourney.matches = idList(c.tourney.matches);
  for (const k of ['players', 'teams']) if (Array.isArray(c[k])) c[k].forEach(x => { if (!IMG_OK(x.photo)) x.photo = ''; if (Array.isArray(x.pids)) x.pids = x.pids.filter(p => typeof p === 'string' && ID.test(p)); });
  if (Array.isArray(c.signups)) c.signups = c.signups.filter(p => typeof p === 'string' && ID.test(p));
  return c;
}

function projectCore(core, ctx) {
  if (!core) return core;
  const uid = ctx && ctx.uid;
  const c = Object.assign({}, core);
  if (Array.isArray(c.tables)) c.tables = c.tables.filter(t => !t.owner || t.owner === uid);
  if (Array.isArray(c.history)) c.history = c.history.filter(h => !h.owner || h.owner === uid);
  if (c.settings) { c.settings = Object.assign({}, c.settings); LEGACY_SETTINGS.forEach(k => delete c.settings[k]); }
  if (Array.isArray(c.players)) c.players = c.players.map(p => { if (!p || !('pin' in p)) return p; const q = Object.assign({}, p); delete q.pin; return q; });
  return c;
}

// liste med id'er: tilføj / ret / fjern hver for sig
function mergeList(base, inc, can, kind) {
  base = Array.isArray(base) ? base : []; inc = Array.isArray(inc) ? inc : [];
  const B = new Map(base.map(x => [x && x.id, x])), I = new Map(inc.map(x => [x && x.id, x]));
  const denied = new Set(); let soft = true;
  const added = inc.filter(x => x && !B.has(x.id)), removed = base.filter(x => x && !I.has(x.id));
  const addP = kind.add(added.length), out = [];
  const seen = new Set();
  for (const x of inc) {
    if (!x || typeof x !== 'object' || !x.id || seen.has(x.id)) continue;
    seen.add(x.id);
    const b = B.get(x.id);
    if (!b) { if (can(addP)) out.push(x); else { denied.add(addP); soft = false; } continue; }
    if (eq(b, x)) { out.push(b); continue; }
    if (can(kind.mod)) out.push(x); else { out.push(b); denied.add(kind.mod); if (!onlyAdds(b, x)) soft = false; }
  }
  for (const b of removed) { if (can(kind.del)) continue; out.push(b); denied.add(kind.del); soft = false; }
  return { list: out, denied, soft };
}

function makeGuard() {
  const removedTables = new Set();
  function mergeHistory(a, b, del) {
    const dead = new Set(del || []), byId = new Map();
    for (const h of (a || [])) if (!dead.has(h.id)) byId.set(h.id, h);
    for (const h of (b || [])) { if (dead.has(h.id)) continue; const s = byId.get(h.id); if (!s || (h.rev || 0) >= (s.rev || 0)) byId.set(h.id, h); }
    return [...byId.values()].sort((x, y) => (y.at || 0) - (x.at || 0));
  }

  // ctx = { uid, perms:Set }. Returnerer { core, denied:[permission], loud:boolean }
  function apply(base, inc, ctx) {
    const can = p => ctx.perms.has(p);
    base = base || {};
    inc = sanitize(inc);
    const out = Object.assign({}, base);
    const denied = new Set(); let loud = false;
    const deny = (p, soft) => { denied.add(p); if (!soft) loud = true; };

    for (const k of Object.keys(inc)) {
      if (k === 'game' || k === 'reserve' || k === 'audit' || k === 'histDel') continue;
      const b = base[k], v = inc[k];
      if (k === 'tables' || k === 'history') continue;
      if (eq(b, v)) continue;
      if (k === 'players' || k === 'teams') {
        const P = k === 'players' ? 'EDIT_PLAYER' : 'EDIT_TEAM';
        const r = mergeList(b, v, can, { add: n => (n > 10 ? 'IMPORT_PLAYERS' : P), mod: P, del: 'MANAGE_PLAYERS' });
        r.denied.forEach(p => deny(p, r.soft)); out[k] = r.list; continue;
      }
      if (k === 'settings') {
        const s = Object.assign({}, b || {}), vv = v && typeof v === 'object' ? v : {};
        for (const sk of new Set(Object.keys(vv).concat(Object.keys(b || {})))) {
          if (LEGACY_SETTINGS.includes(sk)) continue;
          if (!(sk in vv)) continue; // en klient kan ikke slette en indstilling ved at udelade den
          if (eq((b || {})[sk], vv[sk])) continue;
          const p = settingPerm(sk);
          if (can(p)) s[sk] = vv[sk]; else deny(p, onlyAdds((b || {})[sk], vv[sk]));
        }
        out.settings = s; continue;
      }
      if (k === 'tourney') {
        const t = Object.assign({}, b || {}), vv = v && typeof v === 'object' ? v : {};
        for (const tk of Object.keys(vv)) {
          if (eq((b || {})[tk], vv[tk])) continue;
          if (tk === 'matches') {
            const r = mergeList((b || {}).matches, vv.matches, can, { add: () => 'EDIT_TOURNAMENT', mod: 'EDIT_MATCH', del: 'EDIT_TOURNAMENT' });
            r.denied.forEach(p => deny(p, r.soft)); t.matches = r.list; continue;
          }
          const p = tourneyPerm(tk);
          if (can(p)) t[tk] = vv[tk]; else deny(p, onlyAdds((b || {})[tk], vv[tk]));
        }
        out.tourney = t; continue;
      }
      if (k === 'lastSetup' || k === 'replay') { if (can('USE_SCOREBOARD')) out[k] = v; else deny('USE_SCOREBOARD', true); continue; }
      if (k === 'signups') { if (can('EDIT_TOURNAMENT')) out[k] = v; else deny('EDIT_TOURNAMENT', false); continue; }
      if (can('MANAGE_SETTINGS')) out[k] = v; else deny('MANAGE_SETTINGS', b === undefined);
    }

    // ---------- borde ----------
    if (Array.isArray(inc.tables)) {
      const bt = Array.isArray(base.tables) ? base.tables : [], B = new Map(bt.map(t => [t.id, t])), seen = new Set(), res = [];
      const strip = t => { const c = Object.assign({}, t); delete c.rev; return c; };
      for (const t of inc.tables) {
        if (!t || typeof t !== 'object' || !t.id || removedTables.has(t.id) || seen.has(t.id)) continue;
        seen.add(t.id);
        const b = B.get(t.id);
        if (b && eq(strip(b), strip(t))) { res.push(b); continue; }
        const owner = b ? b.owner : t.owner;
        if (owner) { // privat tavle: kun ejeren
          if (owner !== ctx.uid) { deny('OWN_BOARD_OTHER', !b ? false : onlyAdds(strip(b), strip(t))); if (b) res.push(b); continue; }
          if (!b) { deny('VIEW_OWN_BOARD', false); continue; } // egne tavler oprettes kun via serveren
          if (!can('VIEW_OWN_BOARD')) { deny('VIEW_OWN_BOARD', false); res.push(b); continue; }
          res.push((t.rev || 0) >= (b.rev || 0) ? Object.assign({}, t, { owner: b.owner, no: b.no, name: b.name }) : b); continue;
        }
        if (!b) {
          if (can('MANAGE_SCOREBOARD_SETTINGS') || can('EDIT_MATCH')) res.push(Object.assign({}, t, { owner: undefined }));
          else deny('MANAGE_SCOREBOARD_SETTINGS', false);
          continue;
        }
        const gameCh = !eq(b.game, t.game) || !eq(b.reserve, t.reserve), metaCh = !eq(b.name, t.name) || !eq(b.no, t.no) || Object.keys(strip(t)).some(x => !['game', 'reserve', 'name', 'no', 'id'].includes(x) && !eq(b[x], t[x]));
        const okGame = can('USE_SCOREBOARD') && can('EDIT_SCORE'), okMeta = can('MANAGE_SCOREBOARD_SETTINGS');
        if (gameCh && !okGame) deny(can('USE_SCOREBOARD') ? 'EDIT_SCORE' : 'USE_SCOREBOARD', false);
        if (metaCh && !okMeta) deny('MANAGE_SCOREBOARD_SETTINGS', false);
        const newer = (t.rev || 0) >= (b.rev || 0);
        if (!newer) { res.push(b); continue; }
        let m = Object.assign({}, b);
        if (gameCh && okGame) Object.assign(m, { game: t.game, reserve: t.reserve });
        if (metaCh && okMeta) { const o = strip(t); delete o.game; delete o.reserve; delete o.owner; Object.assign(m, o); }
        if ((gameCh && okGame) || (metaCh && okMeta)) m.rev = t.rev;
        res.push(m);
      }
      for (const b of bt) if (!seen.has(b.id) && !removedTables.has(b.id)) res.push(b);
      out.tables = res; if (can('USE_SCOREBOARD')) { delete out.game; delete out.reserve; }
    }

    // ---------- historik ----------
    if (Array.isArray(inc.history)) {
      const B = new Map((base.history || []).map(h => [h.id, h]));
      const liveG = new Set((out.tables || base.tables || []).map(t => t.game && t.game.id).filter(Boolean));
      const ok = [];
      for (const h of inc.history) {
        if (!h || typeof h !== 'object' || !h.id) continue;
        const b = B.get(h.id);
        if (b && eq(b, h)) continue;
        const owner = b ? b.owner : h.owner;
        if (owner) { if (owner === ctx.uid && can('VIEW_OWN_BOARD') && (!b || b.owner === h.owner)) ok.push(h); else deny('OWN_BOARD_OTHER', false); continue; }
        if (h.owner) { deny('EDIT_MATCH', false); continue; }
        const need = !b ? 'EDIT_SCORE' : (liveG.has(h.gid) ? 'EDIT_SCORE' : 'EDIT_MATCH');
        if (can(need)) ok.push(h); else deny(need, false);
      }
      out.history = mergeHistory(base.history, ok, base.histDel);
    }
    return { core: out, denied: [...denied], loud };
  }
  return { apply, removedTables, mergeHistory };
}

const deniedText = list => {
  const t = [...new Set(list.map(p => LABEL[p] || p))];
  return t.length ? 'Du har ikke rettighed til at ' + (t.length > 1 ? t.slice(0, -1).join(', ') + ' eller ' + t[t.length - 1] : t[0]) + '.' : '';
};

module.exports = { sanitize, makeGuard, projectCore, settingPerm, tourneyPerm, deniedText, onlyAdds, LEGACY_SETTINGS };
