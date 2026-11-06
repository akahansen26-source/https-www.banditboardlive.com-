// Nødadgang: giv en bruger et nyt kodeord og rollen Administrator-manager (eller opret brugeren).
// Kræver adgang til selve computeren. LUK BanditBoard Live først, ellers overskriver serveren ændringen.
//   npm run nulstil-adgang -- <brugernavn> <nyt-kodeord>
const path = require('path');
const fs = require('fs');
const DATA = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });
const USERS = require('../lib/users')(DATA);
const [, , username, password] = process.argv;
if (!username || !password) {
  console.log('Brug:  npm run nulstil-adgang -- <brugernavn> <nyt-kodeord>');
  console.log('Luk BanditBoard Live, før du kører kommandoen.');
  process.exit(1);
}
try {
  let u = USERS.byName(username);
  if (u) {
    USERS.setPassword(u, password);
    USERS.update(u, { role: 'manager', active: true });
    USERS.endAllFor(u.id);
    console.log(`✓ ${u.name} (${u.username}) har fået nyt kodeord og rollen Administrator-manager.`);
  } else {
    u = USERS.create({ username, name: username, password, role: 'manager' }, null);
    console.log(`✓ Ny Administrator-manager oprettet: ${u.username}`);
  }
  fs.appendFileSync(path.join(DATA, 'audit.jsonl'), JSON.stringify({ id: 'r' + Date.now(), at: Date.now(), user: 'Nødadgang (kommandolinje)', role: '', action: 'Nulstillede adgang for ' + u.username, obj: 'scripts/nulstil-adgang.js', cat: 'security', critical: true, src: 'server' }) + '\n');
  setTimeout(() => process.exit(0), 400);
} catch (e) { console.error('Fejl: ' + e.message); process.exit(1); }
