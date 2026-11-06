# BanditBoard Live

Live-scoreboard og turneringssystem til billard (skomager, kegle, pointtavle) og dart – med TV-visning, OBS/Streamlabs-overlay, remote control, turneringsoversigt og central timer.

Det samme projekt kan køre på **to måder**:

| | **Lokalt (klubbens computer)** | **Online (Cloudflare Pages)** |
|---|---|---|
| Start | Dobbeltklik på *Start BanditBoard Live* eller `npm start` | Automatisk fra GitHub |
| Adresse | `http://<ip>:3000/` | `https://<navn>.pages.dev/` |
| Scoreboard, spillere, hold, turneringer, designs, timer | ✅ | ✅ |
| TV / OBS-overlay i samme browser (andre faner/vinduer) | ✅ | ✅ |
| Live-synk mellem **forskellige** enheder (telefon-remote, TV, OBS på en anden pc) | ✅ | ❌ – kræver den lokale server |
| Mediemappen: vælg/upload logoer, sponsorer, bånd | ✅ | Kun visning (filerne fra GitHub) |
| Data gemmes | `data/` på computeren | I den browser, man bruger |

> Cloudflare Pages er *statisk hosting*: den serverer siden, men kan ikke køre Node-serveren, der synkroniserer enhederne. Online-udgaven er derfor perfekt til at **teste og vise systemet frem**, og til at køre alt fra én computer. Til turneringsaftener med tablets, telefoner og OBS på en anden pc bruges den lokale server.

---

## Mappestruktur

```
banditboard-live/
├── public/                  ← selve hjemmesiden (det Cloudflare Pages udgiver)
│   ├── index.html           ← hele appen
│   ├── branding/logo.png    ← systemlogo (kan udskiftes)
│   ├── medier/<sport>/…     ← logoer, sponsorer, bånd, baggrunde, designs, sponsorboards
│   ├── site.json            ← oversigt over mediemappen (bygges automatisk)
│   ├── _redirects           ← pæne adresser på Pages (/remote, /turnering, /obs …)
│   └── _headers
├── scripts/build-pages.js   ← bygger public/site.json  (npm run build)
├── server.js                ← lokal server (Express + Socket.IO)
├── package.json
├── wrangler.toml            ← kun til lokal test af Pages-udgaven
├── Start BanditBoard Live (Windows).bat / (Mac).command / start-banditboard-linux.sh
└── data/                    ← klubbens data – oprettes lokalt, kommer IKKE på GitHub
```

---

## 1. Kør lokalt (som hidtil)

**Nemmest:** dobbeltklik på `Start BanditBoard Live (Windows).bat` (Mac: `Start BanditBoard Live (Mac).command`). Første gang installeres det nødvendige automatisk.

Manuelt (kræver [Node.js LTS](https://nodejs.org/)):

```
npm install
npm start
```

Serveren skriver sine adresser, fx `http://192.168.1.20:3000/`. Brug den adresse på alle enheder på samme WiFi.

**Opgradering fra en ældre version:** Lå `medier/` og `branding/` tidligere ved siden af `server.js`, kopierer serveren selv jeres egne filer ind i `public/` ved første start. Mappen `data/` bruges uændret.

---

## 2. Læg projektet på GitHub

### A) Via hjemmesiden (ingen installation)
1. Log ind på [github.com](https://github.com) → **New repository**.
2. Navn fx `banditboard-live` → vælg **Private** (anbefales) → **Create repository**.
3. Klik **uploading an existing file**.
4. Træk **indholdet** af mappen `banditboard-live` ind (ikke selve mappen) – dvs. `public`, `scripts`, `server.js`, `package.json` osv.
   *Upload IKKE* `node_modules` eller `data` (de er udeladt i GitHub-pakken).
5. Skriv en kort besked, fx "Første version" → **Commit changes**.

### B) Med GitHub Desktop (nemmest ved mange opdateringer)
1. Installér [GitHub Desktop](https://desktop.github.com/) → **File → Add local repository** → vælg mappen → **Create repository**.
2. **Publish repository** (sæt flueben ved *Keep this code private*).
3. Fremover: lav ændringer → skriv en besked → **Commit** → **Push origin**.

`.gitignore` sørger for, at `node_modules/` og `data/` (klubbens spillere og kampe) aldrig kommer på GitHub.

---

## 3. Udgiv på Cloudflare Pages

1. Log ind på [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → fanen **Pages** → **Connect to Git** (kan hedde *Import an existing Git repository*).
2. Forbind din GitHub-konto og vælg repository'et `banditboard-live`.
3. Byggeindstillinger:

   | Felt | Værdi |
   |---|---|
   | Framework preset | **None** |
   | Build command | `npm run build` |
   | Build output directory | `public` |
   | Root directory | *(tom)* |

4. **Save and Deploy**. Efter ca. et minut er siden klar på `https://banditboard-live.pages.dev` (eller det navn, du valgte).

Hver gang du pusher en ændring til GitHub, bygger og udgiver Cloudflare automatisk en ny version. Andre grene end `main` får deres egen test-adresse (preview).

**Vil du have adgangskode på online-udgaven?** Brug *Cloudflare Zero Trust → Access* på Pages-projektet (gratis til få brugere), så kun jeres e-mails kan åbne siden.

---

## 4. Test Pages-udgaven på din egen computer (valgfrit)

```
npm run pages:dev
```

Starter Cloudflares egen emulator på `http://localhost:8788` – præcis som den kører online (uden server-synk). Første gang hentes værktøjet `wrangler` automatisk.

---

## Adresser

| Hvad | Lokalt | Online (Pages) |
|---|---|---|
| Scoreboard | `http://<ip>:3000/` | `https://<navn>.pages.dev/` |
| TV / storskærm, bord 1 | `/#tv/1` (eller `/tv`) | `/tv` |
| Alle borde på én skærm | `/#tv/alle` | `/#tv/alle` |
| OBS-overlay, bord 1 (1920×1080) | `/#overlay/1` (eller `/obs`) | `/obs` |
| OBS med grøn baggrund | `/#overlay-green` | `/#overlay-green` |
| Turneringsoversigt (1920×1080) | `/turnering` | `/turnering` |
| Sponsorboard alene | `/#sponsor` | `/sponsor` |
| Spillernes QR-side | `/#mig` | `/#mig` |
| Remote control | `/remote` | – (kræver lokal server) |
| Live data (JSON) | `/api/live?bord=1` · `/api/live/alle` · `/api/timer` | – |
| Handlingslog (JSON) | `/api/audit` | – |

**OBS med online-udgaven:** Browserkilden i OBS er sin egen browser og kan ikke se data fra din almindelige browser. Brug i stedet **Vinduesoptagelse** af et browser-vindue, der viser `/obs`. Med den lokale server virker browserkilden som normalt.

---

## Opdatering af mediemappen og designs

- Læg billeder i `public/medier/<sportsgren>/logoer | sponsorer | baand | baggrunde`.
- Læg designs som `.json` i `public/medier/<billard|dart|fodbold>/designs` og sponsorboards i `…/sponsorboards`.
- Lokalt opdager serveren nye filer af sig selv og holder `site.json` opdateret. Online opdateres den ved næste deploy (`npm run build` kører automatisk på Cloudflare).
- Systemlogoet udskiftes ved at erstatte `public/branding/logo.png`.

## Data og backup (lokalt)

- `data/state.json` – spillere, hold, kampe, indstillinger og billeder.
- `data/audit.jsonl` – handlingsloggen (der tilføjes kun linjer).
- `data/turneringer/` – gemte turneringer.

Tag en kopi af `data`-mappen for at lave backup. Online ligger data i browseren – brug **Turneringer → Gem som fil** for at tage en kopi med.

## Godt at vide

- Lokalt er serveren "master": når en enhed forbinder, henter den serverens data.
- Admin-PIN (Indstillinger) er en lokal lås – ikke et fuldt login-system.
- Hvis Windows' firewall spørger, så tillad Node.js på privat netværk – ellers kan tablets og TV ikke forbinde (eller kør *Reparér netværk (Windows).bat*).

## Næste skridt (valgfrit): live-synk online

Skal telefoner, TV og OBS synkronisere via internettet uden den lokale server, kan serverdelen flyttes til **Cloudflare Workers + Durable Objects** (WebSockets). Det er en større ombygning af `server.js`, men kan køre på Cloudflares gratis plan ved klub-brug.
