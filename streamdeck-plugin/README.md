# BanditBoard Live – Stream Deck-plugin

Styrer scoreboardet (`/board.html`) fra et Elgato Stream Deck.

Tasten sender et knaptryk til `/api/streamdeck` med brugerens nøgle. Det åbne scoreboard henter trykket
(`/api/board/streamdeck`, long-poll) og klikker på præcis samme knap – så regler, pause og PIN gælder som
ved et almindeligt klik. Status (navne, point, tur) sendes tilbage og vises på "Score og tur"-taster.

- `src/plugin.ts` – pluginnet (Stream Deck SDK v1, Node 20, Stream Deck 6.5+)
- `com.banditboardlive.scoreboard.sdPlugin/ui` – indstillingsvinduer
- `harness.mjs` – simulerer Stream Deck-appen til test: `node harness.mjs <nøgle> <server>`

Byg og pak: `npm install && npm run pack` (lægger filen i `public/downloads/`).
