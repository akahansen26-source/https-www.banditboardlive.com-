// BanditBoard Live – server der kører på klubbens computer og synkroniserer alle enheder via Socket.IO.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');
const QR = require('qrcode');
const { exec } = require('child_process');
const crypto = require('crypto');
const ACCESS = require('./lib/access');
const { makeGuard, projectCore, deniedText, LEGACY_SETTINGS, sanitize } = require('./lib/coreguard');

const PORT = process.env.PORT || 3000;
// Hjemmesiden (index.html, medier, branding) ligger i mappen public/ – den samme mappe som Cloudflare Pages udgiver.
const PUB = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
// Opgradering fra ældre version: medier/ og branding/ lå tidligere ved siden af server.js – kopiér manglende filer ind i public/
function copyMissing(src, dst) {
  try { if (!fs.existsSync(src) || path.resolve(src) === path.resolve(dst)) return; fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) { const a = path.join(src, e.name), b = path.join(dst, e.name);
      if (e.isDirectory()) copyMissing(a, b); else if (!fs.existsSync(b)) fs.copyFileSync(a, b); } } catch (e) { console.warn('Kunne ikke flytte', src, e.message); }
}
if (PUB !== __dirname) { copyMissing(path.join(__dirname, 'medier'), path.join(PUB, 'medier')); copyMissing(path.join(__dirname, 'branding'), path.join(PUB, 'branding')); }
const DATA = path.join(__dirname, 'data');
const STATE = path.join(DATA, 'state.json');   // spillere, hold, kampe, indstillinger, billeder
const AUDIT = path.join(DATA, 'audit.jsonl');  // handlingslog – kun tilføjelser, slettes aldrig
fs.mkdirSync(DATA, { recursive: true });

// ---------- Mediemappe: medier/<sportsgren>/<kategori>/<fil> ----------
const MEDIA = path.join(PUB, 'medier');
const DEFAULT_SPORTS = ['billard', 'dart', 'fodbold', 'faelles'];
const CATS = ['logoer', 'sponsorer', 'baand', 'baggrunde'];
for (const sp of DEFAULT_SPORTS) for (const c of CATS) fs.mkdirSync(path.join(MEDIA, sp, c), { recursive: true });
// Scoreboard-designs og sponsorboards som .json-filer (vises under Indstillinger → Scoreboard-design & sponsorboard)
const LOOK_DIRS = ['designs', 'sponsorboards'];
for (const sp of ['billard', 'dart', 'fodbold']) for (const c of LOOK_DIRS) fs.mkdirSync(path.join(MEDIA, sp, c), { recursive: true });
const MEDIA_README = path.join(MEDIA, 'LÆS MIG.txt');
if (!fs.existsSync(MEDIA_README)) fs.writeFileSync(MEDIA_README,
`MEDIEMAPPE TIL BANDITBOARD LIVE
Læg billeder (png, jpg, webp, svg, gif) i mapperne her. BanditBoard Live ser dem selv efter et par sekunder.

  <sportsgren>/logoer      klub- og holdlogoer
  <sportsgren>/sponsorer   sponsorlogoer til sponsorbåndet
  <sportsgren>/baand       baggrunde til overlay-båndet
  <sportsgren>/baggrunde   andre baggrunde

Ny sportsgren: opret en ny mappe (fx "padel") med de samme undermapper.
Udskift et logo: læg en ny fil med samme navn ovenpå den gamle.
Vælg hvad der vises under fanen "Medier" i BanditBoard Live.
`);
const IMG = /\.(png|jpe?g|webp|svg|gif)$/i;
const enc = encodeURIComponent;
const safeName = s => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 100);
const inMedia = rel => { const full = path.resolve(MEDIA, rel || ''); return full.startsWith(MEDIA + path.sep) ? full : null; };
const dirs = p => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch (e) { return []; } };
function scanMedia() {
  const order = n => (n === 'faelles' ? 1 : 0);
  return dirs(MEDIA).sort((a, b) => order(a) - order(b) || a.localeCompare(b, 'da')).map(sp => {
    const cats = {};
    const rank = c => { const i = CATS.indexOf(c); return i < 0 ? 99 : i; };
    for (const c of dirs(path.join(MEDIA, sp)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'da'))) {
      let files = [];
      try { files = fs.readdirSync(path.join(MEDIA, sp, c)).filter(f => LOOK_DIRS.includes(c) ? /\.json$/i.test(f) : IMG.test(f)).sort((a, b) => a.localeCompare(b, 'da')); } catch (e) {}
      cats[c] = files.map(f => {
        let v = 0; try { v = Math.round(fs.statSync(path.join(MEDIA, sp, c, f)).mtimeMs); } catch (e) {}
        return { name: f, path: `${sp}/${c}/${f}`, url: `/medier/${enc(sp)}/${enc(c)}/${enc(f)}?v=${v}` };
      });
    }
    return { name: sp, cats };
  });
}
let mediaSig = '';

// ---------- Systemlogo: branding/logo.(png|svg|webp|jpg) ----------
const BRAND = path.join(PUB, 'branding');
fs.mkdirSync(BRAND, { recursive: true });
const BRAND_README = path.join(BRAND, 'LÆS MIG.txt');
if (!fs.existsSync(BRAND_README)) fs.writeFileSync(BRAND_README,
`SYSTEMLOGO TIL BANDITBOARD LIVE
Læg jeres logo her med navnet logo.png (eller logo.svg / logo.webp / logo.jpg).
Brug gerne en PNG med gennemsigtig baggrund. Logoet vises præcis som filen er.
Det kan også uploades under fanen "Medier" i BanditBoard Live.
`);
const LOGO_RE = /^logo\.(png|jpe?g|webp|svg|gif)$/i;
function brandInfo() {
  try {
    const f = fs.readdirSync(BRAND).find(x => LOGO_RE.test(x));
    if (!f) return null;
    return { url: `/branding/${enc(f)}?v=${Math.round(fs.statSync(path.join(BRAND, f)).mtimeMs)}` };
  } catch (e) { return null; }
}
let brandSig = '';


let state = { core: null, imgs: {} };
try { state = Object.assign(state, JSON.parse(fs.readFileSync(STATE, 'utf8'))); } catch (e) {}
// Opgradering: den gamle admin-PIN, operatør-navn og spiller-PIN'er er erstattet af rigtige brugerkonti
if (state.core) {
  if (state.core.settings) LEGACY_SETTINGS.forEach(k => delete state.core.settings[k]);
  if (Array.isArray(state.core.players)) state.core.players.forEach(p => { if (p) delete p.pin; });
}
// Data fra disken renses på samme måde som data fra klienter (ingen HTML, gyldige id'er)
if (state.core) state.core = sanitize(state.core);
for (const k of Object.keys(state.imgs || {})) if (typeof state.imgs[k] !== 'string' || (state.imgs[k] && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(state.imgs[k]))) delete state.imgs[k];
let audit = [];
try { audit = fs.readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) {}
const auditIds = new Set(audit.map(a => a.id));

let writeTimer = null;
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const tmp = STATE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE);
  }, 300);
}
function addAudit(e) {
  if (!e || typeof e !== 'object' || !e.id || auditIds.has(e.id)) return false;
  auditIds.add(e.id); audit.push(e);
  fs.appendFileSync(AUDIT, JSON.stringify(e) + '\n');
  return true;
}
function urls() {
  // Rigtige netværkskort først (WiFi/kabel), virtuelle kort (VPN, WSL, VirtualBox, Hyper-V, Docker) sidst
  const virt = /vethernet|virtualbox|vmware|vbox|wsl|hyper-v|docker|loopback|zerotier|tailscale|utun|bridge|hamachi|vpn|tap|tun/i;
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      let score = a.address.startsWith('192.168.') ? 30 : a.address.startsWith('10.') ? 20 : 10;
      if (virt.test(name)) score -= 25;
      if (/wi-?fi|wlan|wireless|ethernet|en0|en1|eth0/i.test(name) && !virt.test(name)) score += 5;
      found.push({ url: `http://${a.address}:${PORT}/`, score, name });
    }
  found.sort((a, b) => b.score - a.score);
  return found.map(f => f.url).concat(`http://localhost:${PORT}/`);
}
function netNames() {
  return Object.entries(os.networkInterfaces()).flatMap(([n, l]) => (l || []).filter(a => (a.family === 'IPv4' || a.family === 4) && !a.internal).map(a => `${a.address} (${n})`));
}

// Opsummering til OBS, Streamlabs, vMix eller egne grafikker
// Officielle borde (private "Min tavle"-borde vises aldrig på TV, OBS eller i live data)
function tablesOf(c) { const l = Array.isArray(c.tables) ? c.tables.filter(t => !t.owner) : []; return l.length ? l : [{ id: 'bord_1', no: 1, name: (c.settings || {}).table || 'Bord 1', game: c.game || null }]; }
function liveSummary(bord) {
  const c = state.core || {}, st = c.settings || {}, tabs = tablesOf(c);
  const tb = (bord && tabs.find(t => String(t.no) === String(bord) || t.id === bord)) || tabs[0], g = tb.game;
  const P = id => (c.players || []).find(p => p.id === id) || { first: '?', last: '' };
  const T = id => (c.teams || []).find(t => t.id === id);
  const name = s => (s.teamId && T(s.teamId)) ? T(s.teamId).name : s.pids.map(id => `${P(id).first || ''} ${P(id).last || ''}`.trim()).join(' & ');
  const sk = s => { const v = s.pids.map(p => (s.sk || {})[p] || 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0; };
  if (!g) return { tournament: st.tourName || '', venue: st.venue || '', table: tb.name, tableNo: tb.no, game: null };
  const A = g.active || null, as = A ? g.sides.find(s => s.id === A.teamId) : null;
  const active = A && !g.over ? {
    activeTeamId: A.teamId, activeTeamIndex: A.teamIndex, activeTeamName: A.teamName,
    activePlayerId: A.playerId, activePlayerIndex: A.playerIndex, activePlayerNumber: A.playerNumber, activePlayerName: A.playerName,
    playerCount: A.playerCount, round: A.round, table: A.table,
    teamScore: as ? as.score : null, playerScore: as && as.pscore ? (as.pscore[A.playerId] || 0) : 0
  } : null;
  const rounds = g.sides.reduce((a, s) => a + (s.rounds || []).length, 0);
  return {
    tournament: st.tourName || '', venue: st.venue || '', table: tb.name, tableNo: tb.no,
    game: {
      mode: g.mode, target: g.target, round: Math.floor(rounds / g.sides.length) + 1, over: !!g.over,
      winner: g.winner ? name(g.sides.find(s => s.id === g.winner)) : null,
      turn: active ? active.activePlayerName : null,
      active,
      sides: g.sides.map(s => ({ id: s.id, name: name(s), score: s.score, skaever: sk(s), locked: !!s.place, place: s.place || null, isActive: !!(active && active.activeTeamId === s.id),
        players: s.pids.map((id, i) => ({ id, number: i + 1, name: `${P(id).first || ''} ${P(id).last || ''}`.trim(), club: P(id).club || '', score: (s.pscore || {})[id] || 0, skaever: (s.sk || {})[id] || 0, isActive: !!(active && active.activeTeamId === s.id && active.activePlayerId === id) })) }))
    }
  };
}


// =====================================================================
//  BRUGERE, ROLLER OG ADGANGSKONTROL
//  Alle sider, API-kald og data-ændringer tjekkes her på serveren ud fra
//  brugerens permissions (public/roller.json). Menuer i appen er kun pynt.
// =====================================================================
const USERS = require('./lib/users')(DATA);
const guard = makeGuard();
const removedTables = guard.removedTables;
const isLocal = ip => /^(::1|127\.|::ffff:127\.)/.test(ip || '');
const COOKIE = 'bb_sess', DCOOKIE = 'bb_disp';

// ---------- TV/OBS-visningsnøgle (erstatter de gamle remote-koder) ----------
const REMOTE = path.join(DATA, 'remote.json');
let remote = { displayKey: '' };
try { const r = JSON.parse(fs.readFileSync(REMOTE, 'utf8')); if (r && r.displayKey) remote.displayKey = r.displayKey; } catch (e) {}
const saveRemote = () => fs.writeFileSync(REMOTE, JSON.stringify(remote, null, 2), { mode: 0o600 });
function genKey() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.randomBytes(10); let s = ''; for (let i = 0; i < 10; i++) s += c[b[i] % c.length]; return 'VS-' + s; }
if (!remote.displayKey) { remote.displayKey = genKey(); saveRemote(); }
const keyOk = k => { if (!k || typeof k !== 'string') return false; const a = Buffer.from(k), b = Buffer.from(remote.displayKey); return a.length === b.length && crypto.timingSafeEqual(a, b); };

// ---------- pubber ----------
const PUBS = path.join(DATA, 'pubs.json');
let pubs = [];
try { pubs = JSON.parse(fs.readFileSync(PUBS, 'utf8')); if (!Array.isArray(pubs)) pubs = []; } catch (e) {}
const savePubs = () => { const t = PUBS + '.tmp'; fs.writeFileSync(t, JSON.stringify(pubs, null, 1)); fs.renameSync(t, PUBS); };
const SOCIAL = ['facebook', 'instagram', 'tiktok', 'youtube', 'web'];
const PUBF = ['name', 'city', 'address', 'phone', 'email', 'info', 'logo'];
const cleanTxt = (s, n) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const cleanUrl = s => { s = cleanTxt(s, 300); if (!s) return ''; if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, ''); return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : ''; };
const pubsFor = ctx => (ctx.perms.has('MANAGE_PUBS') || ctx.perms.has('MANAGE_SOCIAL')) ? pubs : pubs.filter(p => p.public !== false);

// ---------- hvem er det? ----------
function parseCookies(h) { const o = {}; String(h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); try { o[k] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {} } }); return o; }
function ctxFrom(cookieHeader, keyParam) {
  const ck = parseCookies(cookieHeader), u = USERS.fromToken(ck[COOKIE]);
  if (u) return { user: u, uid: u.id, role: u.role, perms: ACCESS.permsOf(u.role), token: ck[COOKIE] };
  if (keyOk(keyParam) || keyOk(ck[DCOOKIE])) return { user: null, uid: null, role: 'display', perms: ACCESS.permsOf('display') };
  return { user: null, uid: null, role: 'guest', perms: ACCESS.permsOf('guest') };
}
const reqCtx = req => ctxFrom(req.headers.cookie, req.query && req.query.key);
const meOf = ctx => ({ user: ctx.user ? USERS.pub(ctx.user) : null, role: ctx.role, roleName: ctx.role === 'display' ? 'TV/OBS-visning' : ACCESS.roleName(ctx.role), perms: [...ctx.perms], setup: USERS.count() === 0, signup: !!(state.core && state.core.settings && state.core.settings.allowSignup) });
const who = ctx => ctx.user ? ctx.user.name : ctx.role === 'display' ? 'TV/OBS-enhed' : 'Gæst';

// ---------- handlingslog skrevet af serveren ----------
let auditPush = () => {};
function sysLog(ctx, action, obj, cat, extra) {
  const e = Object.assign({ id: 's' + crypto.randomBytes(8).toString('hex'), at: Date.now(), user: ctx ? who(ctx) : 'System', uid: ctx && ctx.uid || null, role: ctx ? ACCESS.roleName(ctx.role) : '', action, obj: obj || '', cat: cat || 'system', src: 'server' }, extra || {});
  if (addAudit(e)) auditPush(e);
  return e;
}
const tourName = () => (state.core && state.core.settings && state.core.settings.tourName) || '';

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' }); next(); });
// Ændringer via API må kun komme fra BanditBoard Live's egne sider (beskytter mod at en fremmed hjemmeside sender kald med din login-cookie)
function sameOrigin(req) {
  const o = req.headers.origin || req.headers.referer; if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
app.use('/api', (req, res, next) => { if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return res.status(403).json({ error: 'Forkert oprindelse' }); next(); });
const json = express.json({ limit: '200kb' });
// need(perm…): mindst én af dem kræves. 401 hvis ikke logget ind, ellers 403.
const need = (...perms) => (req, res, next) => {
  const ctx = reqCtx(req); req.ctx = ctx;
  if (perms.some(p => ctx.perms.has(p))) return next();
  if (!ctx.user) return res.status(401).json({ error: 'Du skal være logget ind.', code: 'LOGIN' });
  res.status(403).json({ error: 'FORBIDDEN – din rolle har ikke rettighed til dette.', code: 'FORBIDDEN' });
};
function setSession(req, res, u, remember) {
  const token = USERS.newSession(u, remember, { ip: req.socket.remoteAddress, ua: req.headers['user-agent'] });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${remember ? '; Max-Age=' + 30 * 86400 : ''}`);
  return token;
}
const clearSession = res => res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);

// --- login / logout / mig ---
app.get('/api/me', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(meOf(reqCtx(req))); });
app.get('/api/roles', (req, res) => res.json(ACCESS.def()));
// Første opsætning: kun når der ingen brugere er, og kun fra selve klub-computeren
app.post('/api/setup', json, (req, res) => {
  if (USERS.count() > 0) return res.status(403).json({ error: 'BanditBoard Live er allerede sat op.' });
  if (!isLocal(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(req.headers.host || '')) || req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip']) return res.status(403).json({ error: 'Den første Administrator-manager kan kun oprettes på selve computeren, BanditBoard Live kører på.' });
  const b = req.body || {};
  try {
    const u = USERS.create({ username: b.username, name: b.name, password: b.password, role: 'manager' }, null);
    setSession(req, res, u, true);
    sysLog({ user: u, uid: u.id, role: 'manager', perms: ACCESS.permsOf('manager') }, 'Oprettede den første Administrator-manager', u.name + ' (' + u.username + ')', 'users');
    refreshAll(); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/login', json, (req, res) => {
  const b = req.body || {}, uname = String(b.username || '').trim().toLowerCase(), ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  const keys = ['ip:' + ip, 'u:' + uname];
  const wait = USERS.throttled(keys);
  if (wait) return res.status(429).json({ error: `For mange forkerte forsøg. Prøv igen om ${wait} sekunder.` });
  const u = USERS.byName(uname);
  if (!USERS.checkPw(u, b.password) || !u || u.active === false) {
    USERS.failed(keys);
    sysLog(null, 'Mislykket login', `brugernavn "${uname.slice(0, 40)}" fra ${ip}${u && u.active === false ? ' (deaktiveret)' : ''}`, 'security');
    return res.status(401).json({ error: u && u.active === false && USERS.checkPw(u, b.password) ? 'Kontoen er deaktiveret.' : 'Forkert brugernavn eller kodeord.' });
  }
  USERS.succeeded(keys);
  setSession(req, res, u, !!b.remember);
  sysLog({ user: u, uid: u.id, role: u.role, perms: new Set() }, 'Loggede ind', ip, 'security');
  res.json(meOf({ user: u, uid: u.id, role: u.role, perms: ACCESS.permsOf(u.role) }));
});
app.post('/api/logout', (req, res) => {
  const ctx = reqCtx(req); if (ctx.user) { USERS.endSession(ctx.token); sysLog(ctx, 'Loggede ud', '', 'security'); setTimeout(() => refreshUser(ctx.uid), 50); }
  clearSession(res); res.json({ ok: true });
});
app.post('/api/signup', json, (req, res) => {
  if (!(state.core && state.core.settings && state.core.settings.allowSignup)) return res.status(403).json({ error: 'Selvregistrering er slået fra. Bed en administrator om en konto.' });
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', ''), keys = ['su:' + ip];
  if (USERS.throttled(keys)) return res.status(429).json({ error: 'For mange forsøg – vent lidt.' });
  const b = req.body || {};
  try { USERS.failed(keys); const u = USERS.create({ username: b.username, name: b.name, password: b.password, role: 'user' }, null);
    setSession(req, res, u, true); sysLog({ user: u, uid: u.id, role: 'user', perms: new Set() }, 'Oprettede sig selv som bruger', u.name + ' (' + u.username + ')', 'users');
    res.json(meOf({ user: u, uid: u.id, role: 'user', perms: ACCESS.permsOf('user') }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/me/password', json, (req, res) => {
  const ctx = reqCtx(req); if (!ctx.user) return res.status(401).json({ error: 'Du skal være logget ind.' });
  const b = req.body || {};
  if (!USERS.checkPw(ctx.user, b.old)) return res.status(403).json({ error: 'Det nuværende kodeord er forkert.' });
  try { USERS.setPassword(ctx.user, b.password); USERS.endAllFor(ctx.uid, ctx.token); sysLog(ctx, 'Skiftede sit kodeord', '', 'security'); refreshUser(ctx.uid); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// --- brugeradministration ---
// Må aktøren administrere en bruger med rollen r? (MANAGE_USERS + den rettighed rollen kræver, fx MANAGE_ADMINS / MANAGE_MANAGERS)
const canHandle = (ctx, r) => ctx.perms.has('MANAGE_USERS') && ctx.perms.has(ACCESS.assignPerm(r));
const assignable = ctx => ACCESS.roleIds().filter(r => canHandle(ctx, r));
function playerProblem(pid, uid) {
  if (!pid) return null;
  if (typeof pid !== 'string' || !/^[\w-]{1,60}$/.test(pid) || !((state.core && state.core.players) || []).some(p => p && p.id === pid)) return 'Spilleren findes ikke.';
  if (USERS.list().some(x => x.playerId === pid && x.id !== uid)) return 'Spilleren er allerede koblet til en anden konto.';
  return null;
}
function lastManager(u) { return u.role === 'manager' && u.active !== false && USERS.activeManagers().length <= 1; }
app.get('/api/users', need('MANAGE_USERS'), (req, res) => res.json({ users: USERS.list().map(USERS.pub), assignable: assignable(req.ctx), me: req.ctx.uid }));
app.post('/api/users', json, need('MANAGE_USERS'), (req, res) => {
  const ctx = req.ctx, b = req.body || {}, role = String(b.role || 'user');
  if (!ACCESS.isRole(role)) return res.status(400).json({ error: 'Ukendt rolle.' });
  if (!canHandle(ctx, role)) { sysLog(ctx, 'AFVIST: forsøgte at oprette bruger med rollen ' + ACCESS.roleName(role), String(b.username || ''), 'security'); return res.status(403).json({ error: `FORBIDDEN – du må ikke oprette brugere med rollen ${ACCESS.roleName(role)}.` }); }
  if (role !== 'user' && role !== 'guest' && !ctx.perms.has('MANAGE_ROLES')) return res.status(403).json({ error: 'FORBIDDEN – du må ikke tildele roller.' });
  const pp = playerProblem(b.playerId || null, null); if (pp) return res.status(400).json({ error: pp });
  try {
    const u = USERS.create({ username: b.username, name: b.name, password: b.password, role, playerId: b.playerId || null }, ctx.user);
    sysLog(ctx, 'Oprettede bruger', `${u.name} (${u.username}) som ${ACCESS.roleName(role)}`, 'users');
    res.json(USERS.pub(u));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/users/:id', json, need('MANAGE_USERS'), (req, res) => {
  const ctx = req.ctx, u = USERS.byId(req.params.id), b = req.body || {};
  if (!u) return res.status(404).json({ error: 'Brugeren findes ikke.' });
  if (!canHandle(ctx, u.role)) { sysLog(ctx, 'AFVIST: forsøgte at ændre ' + ACCESS.roleName(u.role), u.name, 'security'); return res.status(403).json({ error: `FORBIDDEN – kun en rolle med rettighed til ${ACCESS.roleName(u.role)} kan ændre denne bruger.` }); }
  const ch = {}, log = [], oldRole = u.role;
  if ('role' in b && b.role !== u.role) {
    const r = String(b.role);
    if (!ACCESS.isRole(r)) return res.status(400).json({ error: 'Ukendt rolle.' });
    if (u.id === ctx.uid) { sysLog(ctx, 'AFVIST: forsøgte at ændre sin egen rolle', `${ACCESS.roleName(u.role)} → ${ACCESS.roleName(r)}`, 'security'); return res.status(403).json({ error: 'FORBIDDEN – du kan ikke ændre din egen rolle.' }); }
    if (!ctx.perms.has('MANAGE_ROLES') || !canHandle(ctx, r)) { sysLog(ctx, 'AFVIST: forsøgte at give ' + u.name + ' rollen ' + ACCESS.roleName(r), '', 'security'); return res.status(403).json({ error: `FORBIDDEN – du må ikke tildele rollen ${ACCESS.roleName(r)}.` }); }
    if (lastManager(u)) return res.status(409).json({ error: 'Der skal altid være mindst én aktiv Administrator-manager.' });
    ch.role = r; log.push(`rolle fra ${ACCESS.roleName(u.role)} til ${ACCESS.roleName(r)}`);
  }
  if ('active' in b && !!b.active !== (u.active !== false)) {
    if (u.id === ctx.uid) return res.status(403).json({ error: 'Du kan ikke deaktivere dig selv.' });
    if (!b.active && lastManager(u)) return res.status(409).json({ error: 'Den sidste aktive Administrator-manager kan ikke deaktiveres.' });
    ch.active = !!b.active; log.push(b.active ? 'aktiverede kontoen' : 'deaktiverede kontoen');
  }
  if ('name' in b) { const n = cleanTxt(b.name, 60); if (n && n !== u.name) { ch.name = n; log.push(`navn til "${n}"`); } }
  if ('playerId' in b) { const pp = playerProblem(b.playerId || null, u.id); if (pp) return res.status(400).json({ error: pp }); const p = b.playerId ? cleanTxt(b.playerId, 60) : null; if (p !== (u.playerId || null)) { ch.playerId = p; log.push(p ? 'koblede til spiller' : 'fjernede spillerkobling'); } }
  if ('password' in b && b.password) { const p = USERS.pwProblem(b.password); if (p) return res.status(400).json({ error: p }); }
  if (Object.keys(ch).length) USERS.update(u, ch);
  if (b.password) { USERS.setPassword(u, b.password); log.push('nyt kodeord'); USERS.endAllFor(u.id); }
  if (ch.active === false) USERS.endAllFor(u.id);
  if (log.length) {
    if (ch.role) sysLog(ctx, `${who(ctx)} ændrede ${u.name}s rolle fra ${ACCESS.roleName(oldRole)} til ${ACCESS.roleName(ch.role)}`, u.username, 'users', { critical: true });
    sysLog(ctx, 'Ændrede bruger', `${u.name} (${u.username}): ${log.join(', ')}`, 'users');
  }
  refreshUser(u.id); res.json(USERS.pub(u));
});
app.delete('/api/users/:id', need('MANAGE_USERS'), (req, res) => {
  const ctx = req.ctx, u = USERS.byId(req.params.id);
  if (!u) return res.status(404).json({ error: 'Brugeren findes ikke.' });
  if (!canHandle(ctx, u.role)) { sysLog(ctx, 'AFVIST: forsøgte at slette ' + ACCESS.roleName(u.role), u.name, 'security'); return res.status(403).json({ error: `FORBIDDEN – du må ikke slette en ${ACCESS.roleName(u.role)}.` }); }
  if (u.id === ctx.uid) return res.status(403).json({ error: 'Du kan ikke slette dig selv.' });
  if (lastManager(u)) return res.status(409).json({ error: 'Den sidste aktive Administrator-manager kan ikke slettes.' });
  USERS.endAllFor(u.id); USERS.remove(u);
  sysLog(ctx, 'Slettede bruger', `${u.name} (${u.username}), rolle ${ACCESS.roleName(u.role)}`, 'users', { critical: true });
  refreshUser(u.id); res.json({ ok: true });
});

// --- pubber og sociale medier ---
app.get('/api/pubs', (req, res) => res.json(pubsFor(reqCtx(req))));
function pubFrom(b, old, ctx) {
  const p = Object.assign({ id: 'pub_' + crypto.randomBytes(5).toString('hex'), events: [], public: true }, old || {});
  if (ctx.perms.has('MANAGE_PUBS')) {
    PUBF.forEach(k => { if (k in b) p[k] = k === 'info' ? cleanTxt(b[k], 600) : cleanTxt(b[k], 120); });
    if ('public' in b) p.public = !!b.public;
    if (Array.isArray(b.events)) p.events = b.events.slice(0, 40).map(e => ({ id: cleanTxt(e.id, 20) || crypto.randomBytes(4).toString('hex'), date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : '', time: /^\d{1,2}:\d{2}$/.test(e.time) ? e.time : '', title: cleanTxt(e.title, 120) })).filter(e => e.title);
  }
  if (ctx.perms.has('MANAGE_SOCIAL') || ctx.perms.has('MANAGE_PUBS')) SOCIAL.forEach(k => { if (k in b) p[k] = cleanUrl(b[k]); });
  return p;
}
app.post('/api/pubs', json, need('MANAGE_PUBS'), (req, res) => {
  const p = pubFrom(req.body || {}, null, req.ctx); if (!p.name) return res.status(400).json({ error: 'Pubben skal have et navn.' });
  pubs.push(p); savePubs(); sysLog(req.ctx, 'Oprettede pub', p.name, 'pubs'); pushPubs(); res.json(p);
});
app.patch('/api/pubs/:id', json, need('MANAGE_PUBS', 'MANAGE_SOCIAL'), (req, res) => {
  const i = pubs.findIndex(p => p.id === req.params.id); if (i < 0) return res.status(404).json({ error: 'Pubben findes ikke.' });
  const b = req.body || {};
  if (!req.ctx.perms.has('MANAGE_PUBS') && Object.keys(b).some(k => !SOCIAL.includes(k))) return res.status(403).json({ error: 'FORBIDDEN – du må kun ændre sociale medier.' });
  const p = pubFrom(b, pubs[i], req.ctx); if (!p.name) return res.status(400).json({ error: 'Pubben skal have et navn.' });
  pubs[i] = p; savePubs(); sysLog(req.ctx, Object.keys(b).every(k => SOCIAL.includes(k)) ? 'Ændrede sociale medier' : 'Ændrede pub', p.name, 'pubs'); pushPubs(); res.json(p);
});
app.delete('/api/pubs/:id', need('MANAGE_PUBS'), (req, res) => {
  const p = pubs.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: 'Pubben findes ikke.' });
  pubs = pubs.filter(x => x !== p); savePubs(); sysLog(req.ctx, 'Slettede pub', p.name, 'pubs', { critical: true }); pushPubs(); res.json({ ok: true });
});

// --- handlingslog ---
const auditFor = ctx => ctx.perms.has('VIEW_AUDIT') ? (ctx.perms.has('MANAGE_USERS') ? audit : audit.filter(a => !a.cat || a.cat === 'scoreboard')) : [];
app.get('/api/audit', need('VIEW_AUDIT'), (req, res) => res.json(auditFor(req.ctx)));

// --- medier og logo ---
const noScript = (req, res, next) => { res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"); next(); };
app.use('/medier', noScript, express.static(MEDIA, { maxAge: 0 }));
app.use('/branding', noScript, express.static(BRAND, { maxAge: 0 }));
app.get('/api/branding', (req, res) => res.json(brandInfo()));
app.post('/api/branding', need('MANAGE_SETTINGS', 'MANAGE_LAYOUT'), express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const ext = (path.extname(safeName(req.query.name)) || '').toLowerCase();
  if (!/^\.(png|jpe?g|webp|svg|gif)$/.test(ext) || !req.body || !req.body.length) return res.status(400).json({ error: 'Brug png, svg, webp eller jpg.' });
  for (const f of fs.readdirSync(BRAND)) if (LOGO_RE.test(f)) fs.unlinkSync(path.join(BRAND, f));
  fs.writeFileSync(path.join(BRAND, 'logo' + ext), req.body);
  sysLog(req.ctx, 'Skiftede systemlogo', '', 'scoreboard'); mediaChanged(); res.json(brandInfo());
});
app.get('/api/medier', (req, res) => res.json(scanMedia()));
function writeSite() { try { fs.writeFileSync(path.join(PUB, 'site.json'), JSON.stringify({ generated: new Date().toISOString(), medier: scanMedia().map(sp => ({ name: sp.name, cats: Object.fromEntries(Object.entries(sp.cats).map(([c, fs2]) => [c, fs2.map(f => ({ name: f.name, path: f.path, url: f.url.replace(/\?v=.*/, '') }))])) })), brand: (brandInfo() || {}).url ? brandInfo().url.replace(/\?v=.*/, '') : null }, null, 1)); } catch (e) {} }
function mediaChanged() {
  const m = scanMedia(), sig = JSON.stringify(m); if (sig !== mediaSig) { mediaSig = sig; if (typeof io !== 'undefined') io.emit('medier', m); writeSite(); }
  const b = brandInfo(), bs = JSON.stringify(b); if (bs !== brandSig) { brandSig = bs; if (typeof io !== 'undefined') io.emit('branding', b); }
}
app.post('/api/medier/upload', need('MANAGE_LAYOUT'), express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const sport = safeName(req.query.sport), cat = safeName(req.query.cat);
  let name = safeName(req.query.name);
  if (!sport || !cat || !IMG.test(name) || !req.body || !req.body.length) return res.status(400).json({ error: 'Kun billeder (png, jpg, webp, svg, gif).' });
  const dir = inMedia(path.join(sport, cat)); if (!dir) return res.status(400).end();
  fs.mkdirSync(dir, { recursive: true });
  const replace = safeName(req.query.replace);
  if (replace) {
    const old = inMedia(replace);
    if (old && fs.existsSync(old)) { const keep = path.basename(old, path.extname(old)) + path.extname(name).toLowerCase(); if (path.dirname(old) === dir && keep !== path.basename(old)) fs.unlinkSync(old); name = keep; }
  } else {
    const base = path.basename(name, path.extname(name)), ext = path.extname(name); let i = 2;
    while (fs.existsSync(path.join(dir, name))) name = `${base}-${i++}${ext}`;
  }
  fs.writeFileSync(path.join(dir, name), req.body);
  sysLog(req.ctx, 'Uploadede medie', `${sport}/${cat}/${name}`, 'scoreboard'); mediaChanged();
  res.json({ path: `${sport}/${cat}/${name}` });
});
app.post('/api/medier/delete', need('MANAGE_LAYOUT'), (req, res) => { const f = inMedia(req.query.path); if (!f || !IMG.test(f)) return res.status(400).end(); try { fs.unlinkSync(f); } catch (e) {} sysLog(req.ctx, 'Slettede medie', String(req.query.path || ''), 'scoreboard'); mediaChanged(); res.json({ ok: true }); });
app.post('/api/medier/mkdir', need('MANAGE_LAYOUT'), (req, res) => {
  const sp = safeName(req.query.sport).toLowerCase(); if (!sp) return res.status(400).end();
  const d = inMedia(sp); if (!d) return res.status(400).end();
  for (const c of CATS) fs.mkdirSync(path.join(d, c), { recursive: true });
  mediaChanged(); res.json({ ok: true, name: sp });
});
app.post('/api/medier/open', need('MANAGE_LAYOUT'), (req, res) => {
  if (!isLocal(req.socket.remoteAddress)) return res.status(403).json({ error: 'Mappen kan kun åbnes fra selve computeren, BanditBoard Live kører på.' });
  const cmd = process.platform === 'win32' ? `explorer "${MEDIA}"` : process.platform === 'darwin' ? `open "${MEDIA}"` : `xdg-open "${MEDIA}"`;
  exec(cmd, () => {}); res.json({ ok: true });
});

// ---------- sider med adgangskontrol ----------
// Appen ligger i én fil (index.html). Den indeholder ingen klubdata – data og handlinger kommer kun fra serveren efter rettighedstjek.
// Kendte interne adresser tjekkes her, FØR siden vises: uden rettighed får man 403 ACCESS DENIED.
const INDEX = [path.join(PUB, 'index.html'), path.join(__dirname, 'cueboard.html')].find(f => fs.existsSync(f));
app.get(['/', '/index.html', '/cueboard.html'], (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(INDEX); });
const escH = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function deniedPage(res, ctx, msg, next) {
  res.status(ctx.user ? 403 : 401).type('html').send(`<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ingen adgang · BanditBoard Live</title>
<body style="margin:0;font-family:system-ui,sans-serif;background:#070D1F;color:#E8EEF7;display:grid;place-items:center;min-height:100vh;text-align:center"><main style="max-width:520px;padding:24px">
<div style="font-size:13px;letter-spacing:.2em;color:#ff5d6c;font-weight:800">403 · ACCESS DENIED</div><h1 style="margin:.4em 0">${escH(msg)}</h1>
<p style="color:#9aa8c0">${ctx.user ? `Du er logget ind som <b>${escH(ctx.user.name)}</b> (${escH(ACCESS.roleName(ctx.role))}). Bed en administrator om en rolle med adgang.` : 'Log ind med en bruger, der har adgang.'}</p>
<p style="margin-top:22px">${ctx.user ? '' : `<a style="background:#19C3FF;color:#04121c;padding:12px 20px;border-radius:10px;font-weight:700;text-decoration:none" href="/#login?next=${encodeURIComponent(next)}">Log ind</a> `}<a style="color:#19C3FF;margin-left:12px" href="/">Til forsiden</a></p></main></body></html>`);
}
const pageDenied = new Map();
// route(paths, perms, hash, besked): kræver mindst én af perms. Visningsnøgle (?key=) gemmes som cookie til TV/OBS.
function route(paths, perms, hash, msg) {
  app.get(paths, (req, res) => {
    const ctx = reqCtx(req);
    if (req.query.key && keyOk(req.query.key)) res.append('Set-Cookie', `${DCOOKIE}=${encodeURIComponent(req.query.key)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}`);
    if (perms && !perms.some(p => ctx.perms.has(p))) {
      const ip = (req.socket.remoteAddress || '').replace('::ffff:', ''), k = ip + ' ' + req.path;
      if (Date.now() - (pageDenied.get(k) || 0) > 60000) { pageDenied.set(k, Date.now()); sysLog(ctx, 'AFVIST: åbnede ' + req.path, ip, 'security'); }
      return deniedPage(res, ctx, msg || 'Du har ikke rettigheder til at tilgå denne side.', req.path);
    }
    res.set('Cache-Control', 'no-store');
    res.redirect(typeof hash === 'function' ? hash(req) : hash);
  });
}
const SB = 'Du har ikke rettigheder til at tilgå scoreboardet.';
route(['/scoreboard', '/admin/scoreboard', '/scoreboard-admin', '/spil'], ['USE_SCOREBOARD'], '/#scoreboard', SB);
route(['/remote', '/remote/:x'], ['USE_REMOTE'], '/#remote', 'Du har ikke rettigheder til Remote Controller.');
route(['/obs', '/overlay'], ['USE_OVERLAY'], '/#overlay/1', 'Du har ikke rettigheder til OBS-overlayet.');
route(['/obs/:n', '/overlay/:n'], ['USE_OVERLAY'], req => /^(\d{1,2}|alle|sponsor)$/.test(req.params.n) ? (req.params.n === 'sponsor' ? '/#sponsor' : '/#overlay/' + req.params.n) : '/#overlay/1', 'Du har ikke rettigheder til OBS-overlayet.');
route(['/tv'], ['USE_OVERLAY'], '/#tv', 'Du har ikke rettigheder til TV-visningen.');
route(['/tv/:n'], ['USE_OVERLAY'], req => /^(\d{1,2}|alle)$/.test(req.params.n) ? '/#tv/' + req.params.n : '/#tv', 'Du har ikke rettigheder til TV-visningen.');
route(['/sponsor'], ['USE_OVERLAY'], '/#sponsor', 'Du har ikke rettigheder til sponsorboardet.');
route(['/admin', '/brugere', '/admin/brugere', '/admin/users'], ['MANAGE_USERS'], '/#brugere', 'Kun administratorer har adgang til brugeradministration.');
route(['/roller', '/admin/roller'], ['MANAGE_ROLES', 'MANAGE_USERS'], '/#roller', 'Kun administratorer kan se rolleadministrationen.');
route(['/pubber', '/admin/pubber'], ['MANAGE_PUBS', 'MANAGE_SOCIAL'], '/#pubber', 'Du har ikke rettigheder til at administrere pubber.');
route(['/log', '/admin/log'], ['VIEW_AUDIT'], '/#log', 'Du har ikke rettigheder til handlingsloggen.');
route(['/indstillinger', '/admin/indstillinger', '/settings'], ['MANAGE_SETTINGS', 'MANAGE_SCOREBOARD_SETTINGS', 'MANAGE_LAYOUT', 'MANAGE_REMOTE'], '/#indstillinger', 'Du har ikke rettigheder til indstillingerne.');
route(['/spillere', '/admin/spillere'], ['EDIT_PLAYER', 'EDIT_TEAM'], '/#spillere', 'Du har ikke rettigheder til spillere og hold.');
route(['/turneringsadmin', '/admin/turnering'], ['EDIT_TOURNAMENT', 'CREATE_TOURNAMENT'], '/#turneringsadmin', 'Du har ikke rettigheder til turneringsadministration.');
route(['/min-tavle'], ['VIEW_OWN_BOARD'], '/#min-tavle', 'Din rolle har ingen egen tavle.');
route(['/turnering', '/overlay/tournament', '/display/tournament', '/overlay/turnering', '/display/turnering'], null, '/#turnering');
route(['/login'], null, req => '/#login' + (req.query.next ? '?next=' + encodeURIComponent(String(req.query.next)) : ''));
route(['/mig'], null, '/#mig');
app.get('/test', (req, res) => res.type('html').send('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#070D1F;color:#E8EEF7;display:grid;place-items:center;height:90vh;text-align:center"><div><h1 style="color:#19C3FF">✓ BanditBoard Live svarer</h1><p>Forbindelsen fra denne enhed virker.</p><p><a style="color:#19C3FF" href="/">Åbn BanditBoard Live</a></p></div></body>'));

// ---------- live data og timer ----------
function timerInfo() {
  const tm = (state.core && state.core.tourney && state.core.tourney.timer) || null;
  if (!tm) return { duration: 0, remaining: 0, status: 'idle', label: '', text: '00:00' };
  const left = tm.run ? Math.max(0, (tm.endAt || 0) - Date.now()) : Math.max(0, +tm.left || 0);
  const status = tm.run ? (left <= 0 ? 'finished' : 'running') : (tm.fin || (left <= 0 && +tm.dur > 0)) ? 'finished' : (left < +tm.dur ? 'paused' : 'idle');
  const s = Math.ceil(left / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = v => String(v).padStart(2, '0');
  return { duration: Math.round((+tm.dur || 0) / 1000), remaining: s, status, label: tm.label || '', text: h ? `${p(h)}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}` };
}
// Timeren vises også på den offentlige turneringsoversigt, så den må læses af alle
app.get('/api/timer', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.json(timerInfo()); });
// Live score til OBS-tekstkilder m.m.: kræver USE_OVERLAY (login eller ?key=visningsnøgle)
const liveGuard = (req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); };
app.get('/api/live', liveGuard, need('USE_OVERLAY'), (req, res) => res.json(liveSummary(req.query.bord)));
app.get('/api/live/:bord', liveGuard, need('USE_OVERLAY'), (req, res) => res.json(req.params.bord === 'alle' ? tablesOf(state.core || {}).map(t => liveSummary(t.id)) : liveSummary(req.params.bord)));

// POST /api/timer {action:start|pause|reset|add|set, minutes, label}  – kræver CONTROL_TIMER
app.post('/api/timer', json, need('CONTROL_TIMER'), (req, res) => {
  if (!state.core) return res.status(409).json({ error: 'Ingen data endnu.' });
  const b = req.body || {}, to = state.core.tourney = Object.assign({}, state.core.tourney || {});
  const tm = to.timer = Object.assign({ label: 'Næste kamp', dur: 600000, left: 600000, endAt: 0, run: false }, to.timer || {});
  const left = () => tm.run ? Math.max(0, tm.endAt - Date.now()) : Math.max(0, +tm.left || 0), before = timerInfo().text;
  switch (b.action) {
    case 'start': if (!tm.run) { const l = left() || +tm.dur; Object.assign(tm, { run: true, endAt: Date.now() + l, left: l, fin: false }); } break;
    case 'pause': if (tm.run) Object.assign(tm, { run: false, left: left(), endAt: 0 }); break;
    case 'reset': Object.assign(tm, { run: false, left: +tm.dur, endAt: 0, fin: false }); break;
    case 'add': { const d = Math.round((+b.minutes || 1) * 60000); if (tm.run) tm.endAt = Math.max(Date.now(), tm.endAt + d); else tm.left = Math.max(0, left() + d); tm.fin = false; break; }
    case 'set': { const d = Math.round((+b.minutes || 0) * 60000); if (d <= 0 || d > 24 * 3600e3) return res.status(400).json({ error: 'minutes skal være mellem 0 og 1440' }); Object.assign(tm, { dur: d, left: d, run: false, endAt: 0, fin: false }); break; }
    default: return res.status(400).json({ error: 'action skal være start, pause, reset, add eller set' });
  }
  if ('label' in b) tm.label = cleanTxt(b.label, 60);
  state.core = Object.assign({}, state.core, { tourney: to }); persist(); pushCore();
  sysLog(req.ctx, 'Timer: ' + b.action + ' (API)', `${before} → ${timerInfo().text}`, 'scoreboard', { tour: tourName() });
  res.json(timerInfo());
});
// POST /api/score {bord:1, side:0|"navn", score:18 | delta:-6}  – kræver USE_SCOREBOARD + EDIT_SCORE
// Retter et tal på et officielt bord (som "✎ Ret tal" i appen). Private tavler kan ikke ændres her.
app.post('/api/score', json, (req, res) => {
  const ctx = reqCtx(req);
  if (!ctx.user && ctx.role !== 'display') { sysLog(ctx, 'AFVIST: POST /api/score uden login', (req.socket.remoteAddress || '').replace('::ffff:', ''), 'security'); return res.status(401).json({ error: 'Du skal være logget ind.', code: 'LOGIN' }); }
  if (!ctx.perms.has('USE_SCOREBOARD') || !ctx.perms.has('EDIT_SCORE')) { sysLog(ctx, 'AFVIST: forsøgte at ændre score via API', '', 'security'); return res.status(403).json({ error: 'FORBIDDEN – din rolle må ikke ændre score.', code: 'FORBIDDEN' }); }
  const b = req.body || {}, core = state.core; if (!core) return res.status(409).json({ error: 'Ingen kamp.' });
  const t = tablesOf(core).find(x => String(x.no) === String(b.bord || 1) || x.id === b.bord);
  if (!t || !t.game || t.game.over) return res.status(404).json({ error: 'Der er ingen aktiv kamp på det bord.' });
  const g = JSON.parse(JSON.stringify(t.game)), s = typeof b.side === 'number' ? g.sides[b.side] : g.sides.find(x => x.id === b.side);
  if (!s) return res.status(404).json({ error: 'Siden findes ikke (brug side: 0, 1, …).' });
  const old = s.score, nv = 'score' in b ? Math.round(+b.score) : old + Math.round(+b.delta || 0);
  if (!Number.isFinite(nv) || Math.abs(nv) > 100000) return res.status(400).json({ error: 'Ugyldigt tal.' });
  s.score = g.dir === 'down' ? Math.max(0, nv) : nv;
  s.feed = (s.feed || []).concat({ t: '✎ ' + (s.score - old > 0 ? '+' : '') + (s.score - old), c: s.score < old ? 'n' : '' });
  g.plog = (g.plog || []).concat({ id: crypto.randomBytes(4).toString('hex'), side: s.id, d: s.score - old, from: old, to: s.score, at: Date.now(), manual: true, foul: true, by: ctx.user ? ctx.user.name : 'API' });
  core.tables = core.tables.map(x => x.id === t.id ? Object.assign({}, x, { game: g, rev: (x.rev || 0) + 1 }) : x);
  state.core = Object.assign({}, core); persist(); pushCore();
  sysLog(ctx, 'Ændrede score', `${t.name} · side ${g.sides.indexOf(s) + 1}: ${old} → ${s.score}`, 'scoreboard', { tour: tourName(), from: old, to: s.score });
  res.json({ ok: true, bord: t.no, side: g.sides.indexOf(s), from: old, to: s.score });
});
// Alle andre /api-adresser findes ikke
app.all('/api/*', (req, res) => res.status(404).json({ error: 'Ukendt API-adresse' }));
app.get('/qr.svg', async (req, res) => {
  try { res.type('image/svg+xml').send(await QR.toString(String(req.query.t || '').slice(0, 500), { type: 'svg', margin: 1, width: 260 })); }
  catch (e) { res.status(400).end(); }
});

// =====================================================================
//  SOCKET.IO – live-synk med rettighedstjek på hver eneste besked
// =====================================================================
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 25e6,
  allowRequest: (req, cb) => { const o = req.headers.origin; if (!o) return cb(null, true); try { cb(null, new URL(o).host === req.headers.host); } catch (e) { cb(null, false); } }
});
const devices = new Map();
const sockets = () => [...io.sockets.sockets.values()];
function remoteStatus() {
  return { displayKey: remote.displayKey,
    devices: [...devices.values()].map(d => { const s = io.sockets.sockets.get(d.id), c = s && s.data.ctx; return { id: d.id, role: c ? c.role : 'guest', roleName: c ? (c.role === 'display' ? 'TV/OBS-visning' : ACCESS.roleName(c.role)) : '', user: c && c.user ? c.user.name : '', ip: d.ip, name: d.name, local: d.local, mode: d.mode, since: d.since }; }) };
}
function pushRemote() { for (const s of sockets()) if (s.data.ctx && s.data.ctx.perms.has('MANAGE_REMOTE')) s.emit('remote', remoteStatus()); }
function pushPubs() { for (const s of sockets()) if (s.data.ctx) s.emit('pubs', pubsFor(s.data.ctx)); }
auditPush = e => { for (const s of sockets()) if (s.data.ctx && auditFor(s.data.ctx).length && (s.data.ctx.perms.has('MANAGE_USERS') || !e.cat || e.cat === 'scoreboard')) s.emit('audit', e); };
function pushCore(except) { for (const s of sockets()) if (s !== except && s.data.ctx) s.emit('core', projectCore(state.core, s.data.ctx)); }
// Visningsnøglen (til TV/OBS-links) gives kun til indloggede brugere med USE_OVERLAY
const dkeyFor = ctx => ctx.user && ctx.perms.has('USE_OVERLAY') ? remote.displayKey : null;
function sendInit(socket) {
  const ctx = socket.data.ctx;
  socket.emit('init', { core: projectCore(state.core, ctx), imgs: state.imgs, audit: auditFor(ctx), urls: urls(), medier: scanMedia(), brand: brandInfo(), me: meOf(ctx),
    remote: ctx.perms.has('MANAGE_REMOTE') ? remoteStatus() : null, pubs: pubsFor(ctx), dkey: dkeyFor(ctx) });
}
// Når en brugers rolle ændres, eller kontoen deaktiveres/slettes, opdateres alle hans åbne enheder med det samme
function refreshUser(uid) {
  for (const s of sockets()) {
    if (!s.data.ctx || s.data.ctx.uid !== uid) continue;
    s.data.ctx = ctxFrom(s.handshake.headers.cookie, s.data.key);
    sendInit(s); s.emit('me', meOf(s.data.ctx));
  }
  pushRemote();
}
function refreshAll() { for (const s of sockets()) { s.data.ctx = ctxFrom(s.handshake.headers.cookie, s.data.key); sendInit(s); } pushRemote(); }
// Begrænser hvor tit samme enhed kan fylde loggen med afviste forsøg
const deniedLogAt = new Map(), userQuota = new Map();
function logDenied(socket, what) {
  const k = socket.id, n = Date.now(); if (n - (deniedLogAt.get(k) || 0) < 10000) return; deniedLogAt.set(k, n);
  sysLog(socket.data.ctx, 'AFVIST ændring', what, 'security');
}
const can = (socket, p) => !!(socket.data.ctx && socket.data.ctx.perms.has(p));
const forbid = (socket, msg) => socket.emit('denied', { reason: msg || 'FORBIDDEN – din rolle har ikke rettighed til dette.' });

io.on('connection', socket => {
  // Hver besked: sessionen tjekkes igen (udløbet/logget ud/deaktiveret = mister adgang med det samme), og fejl fanges
  const rawOn = socket.on.bind(socket);
  socket.on = (ev, fn) => rawOn(ev, (...a) => {
    try { if (ev !== 'disconnect') socket.data.ctx = ctxFrom(socket.handshake.headers.cookie, socket.data.key); fn(...a); }
    catch (e) { console.warn('Afvist besked', ev, e && e.message); }
  });
  // Cookie-baseret login: socket'en har samme bruger som browseren
  socket.data.key = socket.handshake.auth && socket.handshake.auth.key;
  socket.data.ctx = ctxFrom(socket.handshake.headers.cookie, socket.data.key);
  const ua = String(socket.handshake.headers['user-agent'] || '');
  devices.set(socket.id, { id: socket.id, ip: (socket.handshake.address || '').replace('::ffff:', ''), local: isLocal(socket.handshake.address),
    name: /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Telefon' : /OBS|Streamlabs/i.test(ua) ? 'OBS' : 'Computer',
    mode: String((socket.handshake.auth && socket.handshake.auth.mode) || 'scoreboard').slice(0, 20), since: Date.now() });
  sendInit(socket);
  pushRemote();
  socket.emit('srvtime', { t: Date.now() });
  socket.on('srvtime?', c => socket.emit('srvtime', { t: Date.now(), c: typeof c === 'number' ? c : undefined }));
  socket.on('disconnect', () => { devices.delete(socket.id); deniedLogAt.delete(socket.id); pushRemote(); });
  // Login/logout i browseren → genlæs cookien uden at genindlæse siden
  socket.on('whoami', () => { socket.data.ctx = ctxFrom(socket.handshake.headers.cookie, socket.data.key); sendInit(socket); pushRemote(); });

  socket.on('core', c => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return;
    // Sessionen tjekkes igen ved hver ændring (udløbet/deaktiveret konto mister straks adgangen)
    socket.data.ctx = ctxFrom(socket.handshake.headers.cookie, socket.data.key);
    const ctx = socket.data.ctx;
    if (!state.core) { // første data: kun en rolle der må oprette turneringer kan lægge data ind på serveren
      if (!ctx.perms.has('CREATE_TOURNAMENT') || !ctx.perms.has('MANAGE_SETTINGS')) { socket.emit('core', null); return; }
    }
    const r = guard.apply(state.core || {}, c, ctx);
    if (r.denied.length) {
      if (r.loud) { forbid(socket, deniedText(r.denied)); logDenied(socket, deniedText(r.denied)); }
    }
    const changed = JSON.stringify(r.core) !== JSON.stringify(state.core || {});
    if (changed) { state.core = r.core; persist(); }
    // Afsenderen får serverens version, hvis noget blev afvist eller flettet anderledes end det, den sendte
    const differs = r.denied.length || JSON.stringify(r.core.tables) !== JSON.stringify(c.tables) || (r.core.history || []).length !== (c.history || []).length;
    if (changed) pushCore(differs ? null : socket);
    else if (differs) socket.emit('core', projectCore(state.core, ctx));
  });
  socket.on('img', m => {
    if (!m || typeof m.id !== 'string' || !(can(socket, 'EDIT_PLAYER') || can(socket, 'EDIT_TEAM'))) return forbid(socket, 'Du har ikke rettighed til at ændre billeder.');
    if (m.data && (typeof m.data !== 'string' || !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(m.data) || m.data.length > 4e6)) return;
    if (!/^[\w-]{1,60}$/.test(m.id)) return;
    state.imgs[m.id.slice(0, 40)] = m.data || ''; persist(); socket.broadcast.emit('img', { id: m.id.slice(0, 40), data: m.data || '' });
  });
  // Handlinger logget i appen: serveren stempler HVEM der gjorde det – klienten kan ikke selv vælge navn eller rolle
  const auditOk = () => { const c = socket.data.ctx; return !!(c && c.user && [...c.perms].some(p => p !== 'VIEW_PUBLIC')); };
  let auditN = 0, auditT = Date.now();
  function takeAudit(e) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || !auditOk()) return false;
    if (Date.now() - auditT > 60000) { auditN = 0; auditT = Date.now(); } if (++auditN > 600) return false;
    const c = socket.data.ctx;
    if (e.uid && e.uid !== c.uid) return false; // gamle offline-indslag fra en anden bruger tages ikke ind
    const at = typeof e.at === 'number' && Math.abs(Date.now() - e.at) < 5 * 60e3 ? e.at : Date.now();
    const q = userQuota.get(c.uid) || { n: 0, t: Date.now() }; if (Date.now() - q.t > 60000) { q.n = 0; q.t = Date.now(); } if (++q.n > 300) return false; userQuota.set(c.uid, q);
    const x = { id: cleanTxt(e.id, 40), src: 'app', at, user: c.user.name, uid: c.uid, role: ACCESS.roleName(c.role), action: cleanTxt(e.action, 120), obj: cleanTxt(e.obj, 400), cat: 'scoreboard', tour: tourName() };
    if (addAudit(x)) { auditPush(x); return true; } return false;
  }
  socket.on('audit', takeAudit);
  socket.on('auditBulk', list => { (Array.isArray(list) ? list.slice(-500) : []).forEach(takeAudit); });

  // Egen spillerprofil (Min profil / QR): kun den spiller, kontoen er koblet til
  socket.on('profile', m => {
    const ctx = socket.data.ctx;
    if (!ctx.user) return forbid(socket, 'Log ind for at redigere din profil.');
    if (!ctx.perms.has('VIEW_OWN_BOARD') && !ctx.perms.has('EDIT_PLAYER')) return forbid(socket, 'FORBIDDEN – din rolle har ingen spillerprofil.');
    if (!m || typeof m.player !== 'object' || !m.player || !state.core) return;
    if (Date.now() - (socket.data.profAt || 0) < 2000) return forbid(socket, 'Vent et øjeblik, før du gemmer igen.'); socket.data.profAt = Date.now();
    const p = m.player, core = Object.assign({}, state.core), players = (core.players || []).slice();
    let pid = ctx.user.playerId;
    if (pid && !players.some(x => x.id === pid)) pid = null;
    if (!pid) { pid = 'p_' + crypto.randomBytes(5).toString('hex'); USERS.update(ctx.user, { playerId: pid }); }
    const clean = { id: pid, first: cleanTxt(p.first, 60), last: cleanTxt(p.last, 60), club: cleanTxt(p.club, 80), sponsor: cleanTxt(p.sponsor, 80) };
    if (!clean.first) return forbid(socket, 'Skriv mindst dit fornavn.');
    const i = players.findIndex(x => x.id === pid);
    if (typeof p.photo === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo) && p.photo.length < 3e6) { state.imgs[pid] = p.photo; io.emit('img', { id: pid, data: p.photo }); clean.photo = 1; }
    if (i >= 0) players[i] = Object.assign({}, players[i], clean, clean.photo ? {} : { photo: players[i].photo });
    else players.push(Object.assign({ photo: '', number: null }, clean));
    core.players = players;
    let su = (core.signups || []).slice();
    if (m.sign === true && !su.includes(pid)) su.push(pid);
    if (m.sign === false) su = su.filter(x => x !== pid);
    core.signups = su; state.core = core; persist(); pushCore();
    sysLog(ctx, i >= 0 ? 'Redigerede egen spillerprofil' : 'Oprettede egen spillerprofil', clean.first + ' ' + clean.last, 'scoreboard');
    socket.emit('me', meOf(socket.data.ctx));
  });
  // Min tavle: et privat bord, som kun ejeren kan se og styre
  socket.on('own:create', () => {
    const ctx = socket.data.ctx; if (!ctx.perms.has('VIEW_OWN_BOARD') || !ctx.uid) return forbid(socket, 'Din rolle har ingen egen tavle.');
    if (!state.core) state.core = { players: [], teams: [], tables: [], history: [], settings: {} };
    const tables = (state.core.tables || []).slice(), id = 'own_' + ctx.uid;
    if (!tables.some(t => t.id === id)) {
      tables.push({ id, no: 1000 + tables.filter(t => t.owner).length + 1, name: 'Min tavle – ' + ctx.user.name, owner: ctx.uid, game: null, reserve: [], rev: 1 });
      state.core = Object.assign({}, state.core, { tables }); persist();
    }
    socket.emit('core', projectCore(state.core, ctx));
  });

  socket.on('hist:del', ids => {
    if (!can(socket, 'DELETE_TOURNAMENT')) { logDenied(socket, 'slette resultater'); return forbid(socket, 'FORBIDDEN – din rolle må ikke slette resultater.'); }
    if (!Array.isArray(ids) || !state.core) return;
    ids = ids.filter(x => typeof x === 'string').map(x => x.slice(0, 60)).slice(0, 5000);
    const del = new Set((state.core.histDel || []).concat(ids));
    state.core = Object.assign({}, state.core, { histDel: [...del].slice(-20000) });
    state.core.history = (state.core.history || []).filter(h => !del.has(h.id)); persist(); pushCore();
    sysLog(socket.data.ctx, 'Slettede ' + ids.length + ' kamp(e) fra historikken', '', 'scoreboard', { tour: tourName() });
  });
  socket.on('table:remove', id => {
    if (!can(socket, 'MANAGE_SCOREBOARD_SETTINGS')) return forbid(socket, 'FORBIDDEN – din rolle må ikke fjerne borde.');
    if (!state.core || typeof id !== 'string') return;
    const t = (state.core.tables || []).find(x => x.id === id); if (!t || t.owner) return;
    removedTables.add(id); state.core = Object.assign({}, state.core, { tables: (state.core.tables || []).filter(t => t.id !== id) }); persist(); pushCore();
  });
  // TV/OBS-visningsnøgle (Administrer scoreboard og opefter)
  socket.on('remote:set', m => {
    if (!can(socket, 'MANAGE_REMOTE')) return forbid(socket, 'FORBIDDEN – din rolle må ikke ændre remote/visning.');
    if (m && m.regen) {
      remote.displayKey = genKey(); saveRemote();
      sysLog(socket.data.ctx, 'Lavede ny TV/OBS-visningsnøgle', 'gamle links virker ikke længere', 'scoreboard');
      for (const s of sockets()) if (s.data.ctx && s.data.ctx.role === 'display') { s.data.ctx = ctxFrom(s.handshake.headers.cookie, s.data.key); sendInit(s); }
      for (const s of sockets()) if (s.data.ctx) s.emit('dkey', dkeyFor(s.data.ctx));
    }
    pushRemote();
  });

  // Turneringsprofiler: data/turneringer/*.json
  socket.on('tour:list', (_, cb) => { if (typeof cb !== 'function') return; if (!can(socket, 'EDIT_TOURNAMENT') && !can(socket, 'CREATE_TOURNAMENT')) return cb([]); cb(listTours()); });
  socket.on('tour:save', (m, cb) => {
    if (!can(socket, 'EDIT_TOURNAMENT')) return typeof cb === 'function' && cb({ error: 'FORBIDDEN – din rolle må ikke gemme turneringer.' });
    if (!m || !m.data || typeof m.data !== 'object') return typeof cb === 'function' && cb({ error: 'Ingen data' });
    const file = safeName(cleanTxt(m.file, 120) || ((cleanTxt(m.name, 80) || 'turnering').toLowerCase().replace(/[^a-z0-9æøå]+/gi, '-').replace(/^-|-$/g, '') + '-' + new Date().toISOString().slice(0, 10))).replace(/\.json$/i, '') + '.json';
    fs.writeFileSync(path.join(TOURS, file), JSON.stringify(m.data)); sysLog(socket.data.ctx, 'Gemte turnering', file, 'scoreboard'); typeof cb === 'function' && cb({ ok: true, file });
  });
  socket.on('tour:load', (m, cb) => {
    if (typeof cb !== 'function') return; if (!can(socket, 'CREATE_TOURNAMENT')) return cb({ error: 'FORBIDDEN – din rolle må ikke åbne turneringer.' });
    const f = path.join(TOURS, path.basename(cleanTxt(m && m.file, 200)));
    try { cb({ data: JSON.parse(fs.readFileSync(f, 'utf8')) }); } catch (e) { cb({ error: 'Kunne ikke læse filen' }); }
  });
  socket.on('tour:delete', (m, cb) => {
    if (!can(socket, 'DELETE_TOURNAMENT')) return typeof cb === 'function' && cb({ error: 'FORBIDDEN – din rolle må ikke slette turneringer.' });
    const fn = path.basename(cleanTxt(m && m.file, 200)); if (fn.endsWith('.json')) try { fs.unlinkSync(path.join(TOURS, fn)); sysLog(socket.data.ctx, 'Slettede gemt turnering', fn, 'scoreboard'); } catch (e) {}
    typeof cb === 'function' && cb(listTours());
  });
});
const TOURS = path.join(DATA, 'turneringer'); fs.mkdirSync(TOURS, { recursive: true });
function listTours() {
  return fs.readdirSync(TOURS).filter(f => f.endsWith('.json')).map(f => {
    try { const d = JSON.parse(fs.readFileSync(path.join(TOURS, f), 'utf8')); return { file: f, name: d.name, date: d.date, savedAt: d.savedAt, players: d.counts && d.counts.players, teams: d.counts && d.counts.teams, game: d.counts && d.counts.game }; }
    catch (e) { return { file: f, name: f }; }
  }).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

function openBrowser(url) {
  if (process.env.OPEN_BROWSER === '0') return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\nBanditBoard Live kører allerede på port ${PORT} – åbner scoreboardet i browseren.`);
    openBrowser(`http://localhost:${PORT}/`);
    setTimeout(() => process.exit(0), 1500);
  } else { console.error(err); process.exit(1); }
});
mediaSig = JSON.stringify(scanMedia()); brandSig = JSON.stringify(brandInfo());
setInterval(mediaChanged, 2500); // opdager nye eller udskiftede filer i mappen
writeSite();
// øvrige statiske filer i public/ (site.json, roller.json m.m.)
app.use(express.static(PUB, { index: false, maxAge: 0 }));
server.listen(PORT, '0.0.0.0', () => {
  const u = urls()[0];
  console.log('\n==============================================');
  console.log('  BANDITBOARD LIVE kører!');
  console.log('  Brug denne adresse på telefoner, tablets og TV:');
  console.log('     ' + u);
  console.log('  Test forbindelsen fra en telefon: ' + u + 'test');
  console.log('==============================================');
  if (USERS.count() === 0) console.log(`\n  FØRSTE GANG: åbn http://localhost:${PORT}/ på DENNE computer og opret\n  den første Administrator-manager (kun muligt herfra).\n`);
  console.log('Alle netværkskort: ' + (netNames().join(', ') || 'ingen – computeren er ikke på et netværk'));
  console.log(`\nLog ind:    ${u}login\nScoreboard: ${u}scoreboard\nRemote:     ${u}remote\nTV/OBS:     ${u}tv?key=…  ·  ${u}obs?key=…  (nøglen står under OBS & TV)\nOversigt:   ${u}turnering\n`);
  console.log('Mediemappe (logoer, sponsorer, bånd): ' + MEDIA);
  console.log('Systemlogo: ' + (brandInfo() ? 'fundet i ' + BRAND : 'læg logo.png i ' + BRAND));
  console.log('Glemt kodeord? Luk serveren og kør:  npm run nulstil-adgang -- <brugernavn> <nyt-kodeord>');
  console.log('Luk dette vindue for at stoppe BanditBoard Live.\n');
  openBrowser(`http://localhost:${PORT}/`);
});
