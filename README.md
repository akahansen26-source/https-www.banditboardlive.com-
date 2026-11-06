# BanditBoard Live

Live-scoreboard og turneringssystem til billard (skomager, kegle, pointtavle) og dart – med TV-visning, OBS/Streamlabs-overlay, remote control, turneringsoversigt og central timer.

Det samme projekt kan køre på **to måder**:

| | **Lokalt (klubbens computer)** | **Online (Cloudflare Pages eller Vercel)** |
|---|---|---|
| Start | Dobbeltklik på *Start BanditBoard Live* eller `npm start` | Automatisk fra GitHub |
| Adresse | `http://<ip>:3000/` | `https://<navn>.pages.dev/` · `https://<navn>.vercel.app/` |
| Scoreboard, spillere, hold, turneringer, designs, timer | ✅ | ✅ |
| TV / OBS-overlay i samme browser (andre faner/vinduer) | ✅ | ✅ |
| Live-synk mellem **forskellige** enheder (telefon-remote, TV, OBS på en anden pc) | ✅ | ❌ – kræver den lokale server |
| Mediemappen: vælg/upload logoer, sponsorer, bånd | ✅ | Kun visning (filerne fra GitHub) |
| Data gemmes | `data/` på computeren | I den browser, man bruger |
| Brugere, roller og login | ✅ håndhæves af serveren | ❌ ingen server – lokal demo uden fælles data |

> Cloudflare Pages og Vercel er her *statisk hosting*: den serverer siden, men kan ikke køre Node-serveren, der synkroniserer enhederne. Online-udgaven er derfor perfekt til at **teste og vise systemet frem**, og til at køre alt fra én computer. Til turneringsaftener med tablets, telefoner og OBS på en anden pc bruges den lokale server.

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
├── vercel.json              ← opsætning til Vercel (byg, mappe, korte adresser)
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

## Brugere, roller og rettigheder

Første gang scoreboardet åbnes **på klub-computeren**, opretter du den første **Administrator-manager**. Det kan kun gøres fra selve computeren (localhost). Derefter kan du oprette brugere under fanen **Brugere**.

| Rolle | Hovedadgang |
|---|---|
| Gæst | Kun offentlig information (turneringer, rangliste, historik, resultater, pubber) – **ingen scoreboard** |
| Bruger | Egen tavle ("Min tavle"), egen spillerprofil og egne resultater |
| Scoreboard-admin | Køre live scoreboard og turnering: point, spillere, timer, kampe, remote og OBS |
| Administrer scoreboard | Alt ovenfor + oprette/redigere/slette turneringer, spillere og hold, import, eksport, layout, TV/OBS-nøgle |
| Admin | Brugere, roller, pubber, sociale medier og systemindstillinger |
| Administrator-manager | Alt – også administratorer og andre managere |

**Sådan virker det**

- Rollerne bygger på konkrete permissions (`VIEW_PUBLIC`, `USE_SCOREBOARD`, `EDIT_SCORE`, `CONTROL_TIMER`, `MANAGE_USERS`, `MANAGE_MANAGERS` …). Den centrale oversigt ligger i `public/roller.json` og vises under fanen **Roller**.
- Serveren tjekker rettighederne fire steder:
  1. ved hver side (`/scoreboard`, `/remote`, `/obs`, `/brugere` …), som svarer **403 ACCESS DENIED**;
  2. ved hvert API-kald (`POST /api/score`, `/api/timer`, `/api/users` …), som svarer **401** uden login og **403 FORBIDDEN** uden rettighed;
  3. ved hver live-ændring via Socket.IO. Serveren sammenligner ændringen med sine egne data og tager kun det, rollen må;
  4. i de data, der sendes ud. Andres private tavler og interne oplysninger sendes ikke til gæster.
- Menuerne i appen følger rollen, men de er kun pynt. Sikkerheden ligger i serveren.
- En **Gæst** kan aldrig få andet end offentlig visning, heller ikke hvis `roller.json` ændres. Kun en **Administrator-manager** kan oprette, ændre eller fjerne managere. En **Admin** kan ikke oprette eller ændre administratorer og managere og kan ikke give sig selv højere rettigheder. Ingen kan ændre sin egen rolle, og der er altid mindst én aktiv manager.
- Alle administrative handlinger logges med bruger, rolle, tidspunkt og turnering, fx *"Anne Admin ændrede Bo Brugers rolle fra Bruger til Scoreboard-admin"*. Afviste forsøg logges også. Serveren stempler selv, hvem der gjorde hvad (fanen **Log**).
- Kodeord gemmes som scrypt-hash, og login-cookien er `HttpOnly` og `SameSite=Strict`. Efter 5 forkerte forsøg på en bruger bremses login. Rolleskift og deaktivering slår igennem med det samme på åbne enheder.
- **TV og OBS** bruger klubbens visningsnøgle (`/obs/1?key=VS-…`). En skærm med nøglen kan kun vise, aldrig styre. Lav en ny nøgle, hvis et link er kommet ud.
- **Glemt kodeord, og ingen manager kan logge ind?** Luk serveren og kør `npm run nulstil-adgang -- <brugernavn> <nyt-kodeord>`.
- **Opdatering fra en ældre version:** Den gamle admin-PIN og AD-/OP-/VS-remote-koderne er erstattet af brugerkonti. Jeres data i `data/` bevares.

Brugere (`data/users.json`) og sessioner (`data/sessions.json`) ligger i `data/` og kommer aldrig på GitHub.

**Online (Cloudflare Pages/Vercel):** Der er ingen server og derfor ingen login. Siden kører som lokal demo, hvor alt kun gemmes i den besøgendes egen browser og aldrig deles med klubbens data.

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

## 3b. Udgiv på Vercel (alternativ eller sammen med Cloudflare)

Projektet har allerede en `vercel.json`, så Vercel ved selv, hvad der skal bygges.

1. Log ind på [vercel.com](https://vercel.com) med din GitHub-konto (gratis *Hobby*-plan).
2. **Add New… → Project** → vælg repository'et `banditboard-live` → **Import**.
3. Lad indstillingerne stå – de læses fra `vercel.json`:

   | Felt | Værdi (automatisk) |
   |---|---|
   | Framework Preset | Other |
   | Build Command | `npm run build` |
   | Output Directory | `public` |
   | Root Directory | `./` *(eller mappenavnet, hvis projektet ligger i en undermappe på GitHub)* |

4. **Deploy**. Efter ca. et minut ligger siden på `https://banditboard-live.vercel.app` (eller lignende).

Hver gang du pusher til GitHub, udgiver Vercel automatisk en ny version – præcis som Cloudflare. Du kan sagtens have begge kørende samtidig fra samme repository.

**Vercel-plugin til Claude Code / Cursor (valgfrit):** Bruger du Claude Code eller Cursor på din egen computer, kan du give den Vercel-viden med `npx plugins add vercel/vercel-plugin` i en terminal. Det er ikke nødvendigt for at udgive BanditBoard.

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
| Remote control (login) | `/remote` | – (kræver lokal server) |
| Log ind | `/login` | – |
| Scoreboard | `/scoreboard` (kræver Scoreboard-admin) | `/scoreboard` |
| Brugere / roller | `/brugere` · `/roller` | – |
| Live data (JSON) | `/api/live?bord=1&key=VS-…` · `/api/live/alle` · `/api/timer` | – |
| Handlingslog (JSON) | `/api/audit` (kræver rettighed) | – |
| Ret score / timer via API | `POST /api/score` `{bord, side, score\|delta}` · `POST /api/timer` `{action}` | – |

TV- og OBS-links med visningsnøgle står under fanen **OBS & TV**.

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
- Hvis Windows' firewall spørger, så tillad Node.js på privat netværk – ellers kan tablets og TV ikke forbinde (eller kør *Reparér netværk (Windows).bat*).

## Næste skridt (valgfrit): live-synk online

Skal telefoner, TV og OBS synkronisere via internettet uden den lokale server, kan serverdelen flyttes til **Cloudflare Workers + Durable Objects** (WebSockets). Det er en større ombygning af `server.js`, men kan køre på Cloudflares gratis plan ved klub-brug.
