// BanditBoard Live – brugere, kodeord og sessioner.
// Kodeord gemmes kun som scrypt-hash med salt. Sessioner er tilfældige tokens; på disken ligger kun et sha256-hash af dem.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./access');

module.exports = function makeUsers(DATA) {
  const UFILE = path.join(DATA, 'users.json');
  const SFILE = path.join(DATA, 'sessions.json');
  const writeJSON = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), { mode: 0o600 }); fs.renameSync(t, f); };
  let users = [];
  try { users = JSON.parse(fs.readFileSync(UFILE, 'utf8')); if (!Array.isArray(users)) users = []; } catch (e) {}
  let sessions = {};
  try { sessions = JSON.parse(fs.readFileSync(SFILE, 'utf8')) || {}; } catch (e) {}
  const saveUsers = () => writeJSON(UFILE, users);
  let sT = null; const saveSessions = () => { clearTimeout(sT); sT = setTimeout(() => writeJSON(SFILE, sessions), 200); };

  // ---------- kodeord ----------
  const N = 16384;
  function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString('hex'); return { s: salt, h: crypto.scryptSync(String(pw), salt, 64, { N }).toString('hex') }; }
  const DUMMY = hashPw('ingen-bruger-' + Math.random());
  function checkPw(u, pw) {
    const rec = (u && u.pw) || DUMMY;
    const h = crypto.scryptSync(String(pw), rec.s, 64, { N });
    const ok = crypto.timingSafeEqual(h, Buffer.from(rec.h, 'hex'));
    return !!(u && u.pw && ok);
  }
  function pwProblem(pw) {
    pw = String(pw || '');
    if (pw.length < 8) return 'Kodeordet skal være mindst 8 tegn.';
    if (pw.length > 200) return 'Kodeordet er for langt.';
    if (/^(.)\1+$/.test(pw) || /^(12345678|password|kodeord1|qwerty12)/i.test(pw)) return 'Vælg et kodeord, der er sværere at gætte.';
    return null;
  }

  // ---------- brugere ----------
  const norm = s => String(s || '').trim().toLowerCase();
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
  const byId = id => users.find(u => u.id === id) || null;
  const byName = n => users.find(u => u.username === norm(n)) || null;
  const pub = u => u && ({ id: u.id, username: u.username, name: u.name, role: u.role, roleName: A.roleName(u.role), active: u.active !== false, playerId: u.playerId || null, createdAt: u.createdAt, createdBy: u.createdBy || null, updatedAt: u.updatedAt || null, lastLogin: u.lastLogin || null });
  const activeManagers = () => users.filter(u => u.role === 'manager' && u.active !== false);
  function create({ username, name, password, role, playerId }, by) {
    username = norm(username);
    if (!/^[a-z0-9æøå._-]{3,32}$/.test(username)) throw new Error('Brugernavn: 3–32 tegn – bogstaver, tal, punktum, bindestreg eller understreg.');
    if (byName(username)) throw new Error('Brugernavnet er allerede i brug.');
    if (!A.isRole(role)) throw new Error('Ukendt rolle.');
    const p = pwProblem(password); if (p) throw new Error(p);
    const u = { id: 'u_' + crypto.randomBytes(6).toString('hex'), username, name: clean(name, 60) || username, role, active: true, playerId: playerId ? clean(playerId, 40) : null,
      pw: hashPw(password), createdAt: Date.now(), createdBy: by ? by.id : null };
    users.push(u); saveUsers(); return u;
  }
  function setPassword(u, pw) { const p = pwProblem(pw); if (p) throw new Error(p); u.pw = hashPw(pw); u.updatedAt = Date.now(); saveUsers(); }
  function update(u, fields) { Object.assign(u, fields, { updatedAt: Date.now() }); saveUsers(); }
  function remove(u) { users = users.filter(x => x !== u); saveUsers(); }

  // ---------- sessioner ----------
  const DAY = 864e5, SHORT = 12 * 3600e3, LONG = 30 * DAY;
  const th = t => crypto.createHash('sha256').update(String(t)).digest('hex');
  function newSession(u, remember, meta) {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions[th(token)] = { uid: u.id, exp: Date.now() + (remember ? LONG : SHORT), long: !!remember, at: Date.now(), ip: meta && meta.ip, ua: meta && String(meta.ua || '').slice(0, 120) };
    u.lastLogin = Date.now(); saveUsers(); saveSessions(); return token;
  }
  function fromToken(token) {
    if (!token) return null;
    const k = th(token), s = sessions[k];
    if (!s) return null;
    if (s.exp < Date.now()) { delete sessions[k]; saveSessions(); return null; }
    const u = byId(s.uid);
    if (!u || u.active === false) { delete sessions[k]; saveSessions(); return null; }
    if (!s.long && s.exp - Date.now() < SHORT - 600e3) { s.exp = Date.now() + SHORT; saveSessions(); } // glidende udløb for korte sessioner
    return u;
  }
  function endSession(token) { if (token) { delete sessions[th(token)]; saveSessions(); } }
  function endAllFor(uid, exceptToken) { const keep = exceptToken ? th(exceptToken) : null; for (const k of Object.keys(sessions)) if (sessions[k].uid === uid && k !== keep) delete sessions[k]; saveSessions(); }
  setInterval(() => { const n = Date.now(); let ch = false; for (const k of Object.keys(sessions)) if (sessions[k].exp < n) { delete sessions[k]; ch = true; } if (ch) saveSessions(); }, 3600e3).unref();

  // ---------- bremse på forkerte kodeord ----------
  const fails = new Map(); // nøgle → {n, until}
  function throttled(keys) { const n = Date.now(); for (const k of keys) { const f = fails.get(k); if (f && f.until > n) return Math.ceil((f.until - n) / 1000); } return 0; }
  function failed(keys) { const n = Date.now(); for (const k of keys) { const f = fails.get(k) || { n: 0, until: 0, first: n }; if (n - f.first > 15 * 60e3) { f.n = 0; f.first = n; } f.n++; const lim = k.startsWith('ip:') ? 20 : 5; if (f.n >= lim) f.until = n + Math.min(15 * 60e3, 30e3 * Math.pow(2, f.n - lim)); fails.set(k, f); } }
  function succeeded(keys) { keys.forEach(k => fails.delete(k)); }

  return { list: () => users, byId, byName, pub, create, update, remove, setPassword, checkPw, pwProblem, activeManagers,
    newSession, fromToken, endSession, endAllFor, throttled, failed, succeeded, count: () => users.length };
};
