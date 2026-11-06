// BanditBoard Live – server der kører på klubbens computer og synkroniserer alle enheder via Socket.IO.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');
const QR = require('qrcode');
const { exec } = require('child_process');

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
function tablesOf(c) { return Array.isArray(c.tables) && c.tables.length ? c.tables : [{ id: 'bord_1', no: 1, name: (c.settings || {}).table || 'Bord 1', game: c.game || null }]; }
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

const app = express();
app.use('/medier', express.static(MEDIA, { maxAge: 0 }));
app.use('/branding', express.static(BRAND, { maxAge: 0 }));
app.get('/api/branding', (req, res) => res.json(brandInfo()));
app.post('/api/branding', express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const ext = (path.extname(safeName(req.query.name)) || '').toLowerCase();
  if (!/^\.(png|jpe?g|webp|svg|gif)$/.test(ext) || !req.body || !req.body.length) return res.status(400).json({ error: 'Brug png, svg, webp eller jpg.' });
  for (const f of fs.readdirSync(BRAND)) if (LOGO_RE.test(f)) fs.unlinkSync(path.join(BRAND, f));
  fs.writeFileSync(path.join(BRAND, 'logo' + ext), req.body);
  mediaChanged(); res.json(brandInfo());
});
app.get('/api/medier', (req, res) => res.json(scanMedia()));
function writeSite() { try { fs.writeFileSync(path.join(PUB, 'site.json'), JSON.stringify({ generated: new Date().toISOString(), medier: scanMedia().map(sp => ({ name: sp.name, cats: Object.fromEntries(Object.entries(sp.cats).map(([c, fs2]) => [c, fs2.map(f => ({ name: f.name, path: f.path, url: f.url.replace(/\?v=.*/, '') }))])) })), brand: (brandInfo() || {}).url ? brandInfo().url.replace(/\?v=.*/, '') : null }, null, 1)); } catch (e) {} }
function mediaChanged() {
  const m = scanMedia(), sig = JSON.stringify(m); if (sig !== mediaSig) { mediaSig = sig; if (typeof io !== 'undefined') io.emit('medier', m); writeSite(); }
  const b = brandInfo(), bs = JSON.stringify(b); if (bs !== brandSig) { brandSig = bs; if (typeof io !== 'undefined') io.emit('branding', b); }
}
app.post('/api/medier/upload', express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
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
  mediaChanged();
  res.json({ path: `${sport}/${cat}/${name}` });
});
app.post('/api/medier/delete', (req, res) => { const f = inMedia(req.query.path); if (!f || !IMG.test(f)) return res.status(400).end(); try { fs.unlinkSync(f); } catch (e) {} mediaChanged(); res.json({ ok: true }); });
app.post('/api/medier/mkdir', (req, res) => {
  const sp = safeName(req.query.sport).toLowerCase(); if (!sp) return res.status(400).end();
  const d = inMedia(sp); if (!d) return res.status(400).end();
  for (const c of CATS) fs.mkdirSync(path.join(d, c), { recursive: true });
  mediaChanged(); res.json({ ok: true, name: sp });
});
app.post('/api/medier/open', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!/^(::1|127\.|::ffff:127\.)/.test(ip)) return res.status(403).json({ error: 'Mappen kan kun åbnes fra selve computeren, BanditBoard Live kører på.' });
  const cmd = process.platform === 'win32' ? `explorer "${MEDIA}"` : process.platform === 'darwin' ? `open "${MEDIA}"` : `xdg-open "${MEDIA}"`;
  exec(cmd, () => {}); res.json({ ok: true });
});
const INDEX = [path.join(PUB, 'index.html'), path.join(__dirname, 'cueboard.html')].find(f => fs.existsSync(f));
app.get(['/', '/index.html', '/cueboard.html'], (req, res) => res.sendFile(INDEX));
app.get('/remote', (req, res) => res.redirect('/#remote'));
// samme korte adresser som på Cloudflare Pages (public/_redirects)
app.get('/tv', (req, res) => res.redirect('/#tv'));
app.get('/obs', (req, res) => res.redirect('/#overlay/1'));
app.get('/sponsor', (req, res) => res.redirect('/#sponsor'));
// Sponsorboard alene (OBS-browserkilde)
['/sponsor', '/overlay/sponsor'].forEach(r => app.get(r, (req, res) => res.redirect('/#sponsor')));
// Turneringsoversigt til Streamlabs OBS / storskærm (1920×1080)
['/turnering', '/overlay/tournament', '/display/tournament', '/overlay/turnering', '/display/turnering'].forEach(r => app.get(r, (req, res) => res.redirect('/#turnering')));
app.get('/remote/:code', (req, res) => res.redirect('/#remote/' + encodeURIComponent(req.params.code)));
app.get('/test', (req, res) => res.type('html').send('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#070D1F;color:#E8EEF7;display:grid;place-items:center;height:90vh;text-align:center"><div><h1 style="color:#19C3FF">✓ BanditBoard Live svarer</h1><p>Forbindelsen fra denne enhed virker.</p><p><a style="color:#19C3FF" href="/">Åbn scoreboard</a> · <a style="color:#19C3FF" href="/#tv">TV</a> · <a style="color:#19C3FF" href="/#mig">Spillere</a></p></div></body>'));
// Central timer som data (fx til andre overlays): {duration, remaining, status, label, text}
function timerInfo() {
  const tm = (state.core && state.core.tourney && state.core.tourney.timer) || null;
  if (!tm) return { duration: 0, remaining: 0, status: 'idle', label: '', text: '00:00' };
  const left = tm.run ? Math.max(0, (tm.endAt || 0) - Date.now()) : Math.max(0, +tm.left || 0);
  const status = tm.run ? (left <= 0 ? 'finished' : 'running') : (tm.fin || (left <= 0 && +tm.dur > 0)) ? 'finished' : (left < +tm.dur ? 'paused' : 'idle');
  const s = Math.ceil(left / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = v => String(v).padStart(2, '0');
  return { duration: Math.round((+tm.dur || 0) / 1000), remaining: s, status, label: tm.label || '', text: h ? `${p(h)}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}` };
}
app.get('/api/timer', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.json(timerInfo()); });
app.get('/api/live', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.json(liveSummary(req.query.bord)); });
app.get('/api/live/:bord', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.json(req.params.bord === 'alle' ? tablesOf(state.core || {}).map(t => liveSummary(t.id)) : liveSummary(req.params.bord)); });
app.get('/api/audit', (req, res) => res.json(audit));
app.get('/qr.svg', async (req, res) => {
  try { res.type('image/svg+xml').send(await QR.toString(String(req.query.t || ''), { type: 'svg', margin: 1, width: 260 })); }
  catch (e) { res.status(400).end(); }
});

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 25e6 });
// ---------- Remote control: roller og koder ----------
// Hovedcomputeren (localhost) er altid ADMIN. Andre enheder er DISPLAY (kun visning),
// medmindre remote control er aktiv og de har en gyldig kode (ADMIN / OPERATOR / DISPLAY).
const REMOTE = path.join(DATA, 'remote.json');
let remote = { enabled: false, codes: { admin: '', operator: '', display: '' } };
try { remote = Object.assign(remote, JSON.parse(fs.readFileSync(REMOTE, 'utf8'))); } catch (e) {}
const saveRemote = () => fs.writeFileSync(REMOTE, JSON.stringify(remote, null, 2));
function genCode(prefix) { const chars = '23456789'; let n = ''; for (let i = 0; i < 4; i++) n += chars[Math.floor(Math.random() * chars.length)]; return `${prefix}-${n}`; }
function newCodes() { remote.codes = { admin: genCode('AD'), operator: genCode('OP'), display: genCode('VS') }; }
if (!remote.codes.admin) { newCodes(); saveRemote(); }
const isLocal = ip => /^(::1|127\.|::ffff:127\.)/.test(ip || '');
function roleFor(socket) {
  socket.data.coded = false;
  if (isLocal(socket.handshake.address)) return 'admin';
  const code = String((socket.handshake.auth && socket.handshake.auth.code) || '').trim().toUpperCase();
  if (remote.enabled && code) for (const r of ['admin', 'operator', 'display']) if (remote.codes[r] === code) { socket.data.coded = true; return r; }
  return 'display';
}
const devices = new Map();
function remoteStatus() {
  return { enabled: remote.enabled, codes: remote.codes,
    devices: [...devices.values()].map(d => ({ id: d.id, role: d.role, ip: d.ip, name: d.name, local: d.local, mode: d.mode, since: d.since })) };
}
function pushRemote() { for (const [id, d] of devices) { const s = io.sockets.sockets.get(id); if (s) s.emit('remote', d.role === 'admin' ? remoteStatus() : { enabled: remote.enabled }); } }
function setRole(socket, role) { socket.data.role = role; const d = devices.get(socket.id); if (d) d.role = role; socket.emit('role', { role, coded: !!socket.data.coded || isLocal(socket.handshake.address) }); }
// OPERATOR må kun ændre kampen (point, spiller, tur) – ikke spillere, hold, indstillinger osv.
const OPERATOR_KEYS = ['tables', 'history', 'replay', 'lastSetup', 'tourney'];
// Fletning pr. bord (højeste rev vinder) og historik (union minus slettede), så to enheder
// på hvert sit bord aldrig overskriver hinandens kampe.
function mergeTables(a, b) {
  if (!Array.isArray(b)) return a || [];
  if (!Array.isArray(a)) return b;
  const byId = new Map(a.map(t => [t.id, t])), seen = new Set();
  const out = b.map(t => { seen.add(t.id); const s = byId.get(t.id); return !s || (t.rev || 0) >= (s.rev || 0) ? t : s; });
  for (const t of a) if (!seen.has(t.id) && !removedTables.has(t.id)) out.push(t);
  return out.filter(t => !removedTables.has(t.id));
}
function mergeHistory(a, b, del) {
  const dead = new Set(del || []), byId = new Map();
  for (const h of (a || [])) if (!dead.has(h.id)) byId.set(h.id, h);
  for (const h of (b || [])) { if (dead.has(h.id)) continue; const s = byId.get(h.id); if (!s || (h.rev || 0) >= (s.rev || 0)) byId.set(h.id, h); }
  return [...byId.values()].sort((x, y) => (y.at || 0) - (x.at || 0));
}
const removedTables = new Set();
function mergeCore(base, inc, keys) {
  const out = Object.assign({}, base || {});
  for (const k of Object.keys(inc)) { if (keys && !keys.includes(k)) continue; if (k === 'tables' || k === 'history' || k === 'histDel') continue; out[k] = inc[k]; }
  if ((!keys || keys.includes('tables')) && inc.tables) { out.tables = mergeTables(out.tables, inc.tables); delete out.game; delete out.reserve; }
  if (!keys || keys.includes('history')) out.history = mergeHistory(out.history, inc.history, out.histDel);
  return out;
}

io.on('connection', socket => {
  const role = roleFor(socket), ua = String(socket.handshake.headers['user-agent'] || '');
  socket.data.role = role;
  devices.set(socket.id, { id: socket.id, role, ip: (socket.handshake.address || '').replace('::ffff:', ''), local: isLocal(socket.handshake.address),
    name: /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Telefon' : /OBS|Streamlabs/i.test(ua) ? 'OBS' : 'Computer',
    mode: String((socket.handshake.auth && socket.handshake.auth.mode) || 'scoreboard').slice(0, 20), since: Date.now() });
  socket.emit('init', { core: state.core, imgs: state.imgs, audit, urls: urls(), medier: scanMedia(), brand: brandInfo(), role, coded: !!socket.data.coded || isLocal(socket.handshake.address), remote: role === 'admin' ? remoteStatus() : { enabled: remote.enabled } });
  pushRemote();
  // fælles ur: klienterne regner timeren ud fra serverens tid
  socket.emit('srvtime', { t: Date.now() });
  socket.on('srvtime?', c => socket.emit('srvtime', { t: Date.now(), c: typeof c === 'number' ? c : undefined }));
  socket.on('disconnect', () => { devices.delete(socket.id); pushRemote(); });

  socket.on('core', c => {
    if (!c || typeof c !== 'object') return;
    const r = socket.data.role;
    if (r === 'admin' || (r === 'operator' && state.core)) {
      const merged = mergeCore(state.core, c, r === 'admin' ? null : OPERATOR_KEYS);
      state.core = merged; persist();
      // Afsenderen får kun svar, hvis fletningen ændrede noget i forhold til det den sendte
      if (JSON.stringify(merged.tables) !== JSON.stringify(c.tables) || (merged.history || []).length !== (c.history || []).length) io.emit('core', merged);
      else socket.broadcast.emit('core', merged);
      return;
    }
    socket.emit('denied', { reason: 'Denne enhed har kun visningsadgang.' });
    if (state.core) socket.emit('core', state.core);
  });
  socket.on('img', m => { if (!m || !m.id || socket.data.role !== 'admin') return; state.imgs[m.id] = m.data; persist(); socket.broadcast.emit('img', m); });
  socket.on('audit', e => { if (addAudit(e)) socket.broadcast.emit('audit', e); });
  socket.on('auditBulk', list => { (Array.isArray(list) ? list : []).forEach(e => { if (addAudit(e)) socket.broadcast.emit('audit', e); }); });

  // Spillerens egen profil via QR (telefon) – må kun røre egen spiller og tilmelding
  socket.on('profile', m => {
    if (!m || !m.player || !m.player.id || !state.core) return;
    const p = m.player, core = Object.assign({}, state.core), players = (core.players || []).slice();
    const clean = { id: String(p.id).slice(0, 40), first: String(p.first || '').slice(0, 60), last: String(p.last || '').slice(0, 60), club: String(p.club || '').slice(0, 80), sponsor: String(p.sponsor || '').slice(0, 80) };
    if (!clean.first) return;
    const i = players.findIndex(x => x.id === clean.id);
    if (typeof p.photo === 'string' && p.photo.startsWith('data:image/') && p.photo.length < 3e6) { state.imgs[clean.id] = p.photo; io.emit('img', { id: clean.id, data: p.photo }); clean.photo = 1; }
    if (i >= 0) players[i] = Object.assign({}, players[i], clean, clean.photo ? {} : { photo: players[i].photo });
    else players.push(Object.assign({ pin: '', photo: '', number: null }, clean));
    core.players = players;
    let su = (core.signups || []).slice();
    if (m.sign === true && !su.includes(clean.id)) su.push(clean.id);
    if (m.sign === false) su = su.filter(x => x !== clean.id);
    core.signups = su; state.core = core; persist(); io.emit('core', core);
  });

  socket.on('hist:del', ids => {
    if (socket.data.role !== 'admin' || !Array.isArray(ids) || !state.core) return;
    const del = new Set((state.core.histDel || []).concat(ids.map(String)));
    state.core = Object.assign({}, state.core, { histDel: [...del].slice(-20000) });
    state.core.history = (state.core.history || []).filter(h => !del.has(h.id)); persist(); io.emit('core', state.core);
  });
  socket.on('table:remove', id => {
    if (socket.data.role !== 'admin' || !state.core || typeof id !== 'string') return;
    removedTables.add(id); state.core = Object.assign({}, state.core, { tables: (state.core.tables || []).filter(t => t.id !== id) }); persist(); io.emit('core', state.core);
  });
  // Remote control (kun admin)
  socket.on('remote:set', m => {
    if (socket.data.role !== 'admin' || !m) return;
    if (typeof m.enabled === 'boolean') remote.enabled = m.enabled;
    if (m.regen) newCodes();
    saveRemote();
    for (const [id] of devices) { const s = io.sockets.sockets.get(id); if (!s || isLocal(s.handshake.address)) continue; setRole(s, roleFor(s)); }
    pushRemote();
  });

  // Turneringsprofiler: data/turneringer/*.json (kun admin)
  socket.on('tour:list', (_, cb) => { if (typeof cb !== 'function') return; if (socket.data.role !== 'admin') return cb([]); cb(listTours()); });
  socket.on('tour:save', (m, cb) => {
    if (socket.data.role !== 'admin' || !m || !m.data) return cb && cb({ error: 'Kun admin' });
    const file = safeName(m.file || (String(m.name || 'turnering').toLowerCase().replace(/[^a-z0-9æøå]+/gi, '-').replace(/^-|-$/g, '') + '-' + new Date().toISOString().slice(0, 10))).replace(/\.json$/i, '') + '.json';
    fs.writeFileSync(path.join(TOURS, file), JSON.stringify(m.data)); cb && cb({ ok: true, file });
  });
  socket.on('tour:load', (m, cb) => {
    if (typeof cb !== 'function') return; if (socket.data.role !== 'admin') return cb({ error: 'Kun admin' });
    const f = path.join(TOURS, path.basename(String(m && m.file || '')));
    try { cb({ data: JSON.parse(fs.readFileSync(f, 'utf8')) }); } catch (e) { cb({ error: 'Kunne ikke læse filen' }); }
  });
  socket.on('tour:delete', (m, cb) => { if (socket.data.role !== 'admin') return; try { fs.unlinkSync(path.join(TOURS, path.basename(String(m && m.file || '')))); } catch (e) {} cb && cb(listTours()); });
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
// øvrige statiske filer i public/ (site.json m.m.)
app.use(express.static(PUB, { index: false, maxAge: 0 }));
server.listen(PORT, '0.0.0.0', () => {
  const u = urls()[0];
  console.log('\n==============================================');
  console.log('  BANDITBOARD LIVE kører!');
  console.log('  Brug denne adresse på telefoner, tablets og TV:');
  console.log('     ' + u);
  console.log('  Test forbindelsen fra en telefon: ' + u + 'test');
  console.log('==============================================');
  console.log('Alle netværkskort: ' + (netNames().join(', ') || 'ingen – computeren er ikke på et netværk'));
  console.log(`\nRemote:     ${u}remote  (aktivér under Indstillinger → Remote control)\nScoreboard: ${u}\nTV:         ${u}#tv\nOBS:        ${u}#overlay\nSpillere:   ${u}#mig\nLive data:  ${u}api/live\n`);
  console.log('Mediemappe (logoer, sponsorer, bånd): ' + MEDIA);
  console.log('Systemlogo: ' + (brandInfo() ? 'fundet i ' + BRAND : 'læg logo.png i ' + BRAND));
  console.log('Luk dette vindue for at stoppe BanditBoard Live.\n');
  openBrowser(`http://localhost:${PORT}/`);
});
