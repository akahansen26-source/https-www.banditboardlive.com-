import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPORTS } from "./catalog.ts";
import { sportSummaries } from "./summary.ts";

const html = readFileSync(process.env.BOARD_HTML ?? new URL("../../../public/board.html", import.meta.url), "utf8");

test("sportsoversigten dækker hele kataloget og linker til kampmotoren", () => {
  const list = sportSummaries();
  assert.equal(list.length, SPORTS.length);
  assert.deepEqual(list.map((s) => s.id), SPORTS.map((s) => s.id));
  for (const s of list) {
    assert.equal(s.href, `/kamp/ny?sport=${encodeURIComponent(s.id)}`);
    assert.ok(s.name && s.group && s.family);
  }
  for (const id of ["fodbold", "tennis", "badminton"]) assert.ok(list.some((s) => s.id === id), id);
});

test("tavlen henter /api/sports og viser kortet Flere sportsgrene", () => {
  assert.match(html, /fetch\('\/api\/sports'/);
  assert.match(html, /<h2 id="mshead">Flere sportsgrene<\/h2>/);
  assert.match(html, /startsWith\('\/kamp\/ny\?sport='\)/);
  // Billard/dart-flowet er uændret
  assert.match(html, /data-act="setsport" data-v="billard"/);
  assert.match(html, /data-act="setsport" data-v="dart"/);
});

test("rullemenuen har Forside øverst og bevarer de 8 sider", () => {
  assert.match(html, /<ul><li><a class="nav navhome" href="\/">\$\{ic\('home'\)\}<span class="app-nav-label">Forside<\/span><\/a><\/li>/);
  assert.match(html, /\[\['game','Spil'\],\['players','Kartotek'\],\['tour','Turneringer'\],\['matrix','Oversigt'\],\['rank','Rangliste'\],\['history','Historik'\],\['media','Medier'\],\['settings','Indstillinger'\]\]/);
  assert.match(html, /querySelectorAll\('#bbmenulist button, #bbmenulist a'\)/);
});
