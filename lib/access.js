// BanditBoard Live – roller og permissions.
// Én central oversigt (public/roller.json) som både serveren og appen bruger.
// Serveren må aldrig spørge "er det en admin?" – den spørger "har brugeren permission X?".
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'roller.json');
const BASE_ORDER = ['guest', 'user', 'scorer', 'scoremgr', 'admin', 'manager'];

let DEF = null, PERMS = [], ROLE = new Map(), CACHE = new Map();

function load() {
  DEF = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  PERMS = Object.keys(DEF.permissions);
  ROLE = new Map(DEF.roles.map(r => [r.id, r]));
  for (const id of BASE_ORDER) if (!ROLE.has(id)) throw new Error(`roller.json mangler rollen "${id}"`);
  CACHE = new Map();
  for (const r of DEF.roles) {
    const set = new Set(), seen = new Set();
    let cur = r;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      for (const p of cur.permissions || []) {
        if (p === '*') PERMS.forEach(x => set.add(x));
        else if (PERMS.includes(p)) set.add(p);
        else console.warn(`roller.json: ukendt permission "${p}" i rollen ${cur.id} – ignoreres`);
      }
      cur = cur.inherits ? ROLE.get(cur.inherits) : null;
    }
    CACHE.set(r.id, set);
  }
  // Hård sikring: Gæst er altid kun visning – uanset hvad der står i filen.
  const g = CACHE.get('guest');
  for (const p of [...g]) if (p !== 'VIEW_PUBLIC') { g.delete(p); console.warn(`roller.json: Gæst må ikke have ${p} – fjernet`); }
  g.add('VIEW_PUBLIC');
  // Kun Administrator-manager kan administrere managere.
  for (const [id, s] of CACHE) if (id !== 'manager' && s.has('MANAGE_MANAGERS')) { s.delete('MANAGE_MANAGERS'); console.warn(`roller.json: kun Administrator-manager må have MANAGE_MANAGERS – fjernet fra ${id}`); }
  return DEF;
}
load();

const roleIds = () => DEF.roles.map(r => r.id);
const isRole = id => ROLE.has(id);
const roleOf = id => ROLE.get(id) || ROLE.get('guest');
const rank = id => (ROLE.get(id) || { rank: -1 }).rank;
const roleName = id => (ROLE.get(id) || { name: id }).name;
// Visningsenheder (TV/OBS med visningsnøgle) får kun offentlig visning + overlay
const DISPLAY_PERMS = new Set(['VIEW_PUBLIC', 'USE_OVERLAY']);
function permsOf(role) {
  if (role === 'display') return new Set(DISPLAY_PERMS);
  return new Set(CACHE.get(role) || CACHE.get('guest'));
}
// Hvilken permission kræves for at administrere en bruger med denne rolle?
const assignPerm = role => (DEF.assign && DEF.assign[role]) || 'MANAGE_MANAGERS';

module.exports = { load, def: () => DEF, PERMS: () => PERMS, roleIds, isRole, roleOf, rank, roleName, permsOf, assignPerm };
