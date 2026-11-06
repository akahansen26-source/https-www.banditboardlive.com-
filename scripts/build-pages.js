// Bygger den statiske udgave til Cloudflare Pages (eller anden statisk hosting).
// Kører på Node 18+ uden ekstra pakker:  npm run build
// Laver public/site.json med indholdet af mediemappen (logoer, sponsorer, bånd, designs, sponsorboards) og systemlogoet,
// så sponsorlogoer og designs fra mappen også virker online, hvor der ikke er nogen server.
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const MEDIA = path.join(PUB, 'medier');
const BRAND = path.join(PUB, 'branding');
const IMG = /\.(png|jpe?g|webp|svg|gif)$/i;
const LOOK_DIRS = ['designs', 'sponsorboards'];
const CATS = ['logoer', 'sponsorer', 'baand', 'baggrunde'];
const enc = encodeURIComponent;
const dirs = p => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch (e) { return []; } };

if (!fs.existsSync(path.join(PUB, 'index.html'))) { console.error('Fejl: public/index.html mangler.'); process.exit(1); }

const order = n => (n === 'faelles' ? 1 : 0);
const rank = c => { const i = CATS.indexOf(c); return i < 0 ? 99 : i; };
const medier = dirs(MEDIA).sort((a, b) => order(a) - order(b) || a.localeCompare(b, 'da')).map(sp => {
  const cats = {};
  for (const c of dirs(path.join(MEDIA, sp)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'da'))) {
    let files = [];
    try { files = fs.readdirSync(path.join(MEDIA, sp, c)).filter(f => LOOK_DIRS.includes(c) ? /\.json$/i.test(f) : IMG.test(f)).sort((a, b) => a.localeCompare(b, 'da')); } catch (e) {}
    cats[c] = files.map(f => ({ name: f, path: `${sp}/${c}/${f}`, url: `/medier/${enc(sp)}/${enc(c)}/${enc(f)}` }));
  }
  return { name: sp, cats };
});

let brand = null;
try { const f = fs.readdirSync(BRAND).find(x => /^logo\.(png|jpe?g|webp|svg|gif)$/i.test(x)); if (f) brand = `/branding/${enc(f)}`; } catch (e) {}

// Tjek at design-filerne er gyldig JSON, så en stavefejl ikke ødelægger siden online
let bad = 0;
for (const sp of medier) for (const c of LOOK_DIRS) for (const f of (sp.cats[c] || [])) {
  try { JSON.parse(fs.readFileSync(path.join(MEDIA, sp.name, c, f.name), 'utf8')); }
  catch (e) { bad++; console.warn(`Advarsel: ${f.path} er ikke gyldig JSON og springes over (${e.message})`); sp.cats[c] = sp.cats[c].filter(x => x !== f); }
}

fs.writeFileSync(path.join(PUB, 'site.json'), JSON.stringify({ generated: new Date().toISOString(), medier, brand }, null, 1));
const n = medier.reduce((a, sp) => a + Object.values(sp.cats).reduce((x, l) => x + l.length, 0), 0);
console.log(`BanditBoard Live: public/site.json bygget – ${medier.length} sportsgrene, ${n} filer${bad ? `, ${bad} ugyldige springet over` : ''}. Klar til udgivelse fra mappen public/.`);
