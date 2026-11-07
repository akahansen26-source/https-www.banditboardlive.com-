import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const board = readFileSync(new URL("../../../public/board.html", import.meta.url), "utf8");
const header = board.slice(board.indexOf("function header(){"), board.indexOf("function sideTeams(){"));

test("menuen har præcis de samme 8 sider og handlinger som den gamle ikonrække", () => {
  assert.match(header, /\['game','Spil'\],\['players','Kartotek'\],\['tour','Turneringer'\],\['matrix','Oversigt'\],\['rank','Rangliste'\],\['history','Historik'\],\['media','Medier'\],\['settings','Indstillinger'\]/);
  assert.match(header, /data-act="tab" data-v="\$\{k\}"/, "punkterne bruger samme tab-handling");
  assert.match(board, /case 'tab':menuOpen=false;tab=v;render\(\);scrollTo\(0,0\);break;/);
  assert.match(board, /a==='tab'&&\(v==='settings'\|\|v==='media'\)\)\)&&!isAdmin\(\)\)\{askPin\(\);return\}/, "PIN-kravet til Medier/Indstillinger er bevaret");
  assert.doesNotMatch(header, /<nav>\$\{tabs\.map/, "den gamle ikonrække er væk");
});

test("knap og liste er tilgængelige", () => {
  assert.match(header, /id="bbmenubtn" data-act="menu" aria-haspopup="true" aria-expanded="\$\{menuOpen\}" aria-controls="bbmenulist"/);
  assert.match(header, /<nav id="bbmenulist" class="menulist" aria-label="Sider"\$\{menuOpen\?'':' hidden'\}>/);
  assert.match(header, /aria-current="page"/);
  assert.match(header, /brandMark\('hdr'\)/, "logoet er bevaret");
  assert.match(board, /let menuOpen=false,/, "menuen starter lukket");
  assert.match(board, /e\.key==='Escape'\)\{e\.preventDefault\(\);e\.stopPropagation\(\);setMenu\(false,'btn'\)/, "Escape lukker og giver fokus tilbage");
  assert.match(board, /if\(menuOpen&&!e\.target\.closest\('\.bbmenu'\)\)setMenu\(false\)/, "klik udenfor lukker");
  assert.match(board, /if\(e\.key==='Enter'\|\|e\.key===' '\)e\.stopPropagation\(\)/, "Enter/mellemrum i menuen giver ikke point");
});

test("listen ruller lodret og passer til små skærme", () => {
  assert.match(board, /max-height:calc\(100dvh - 96px\)/);
  assert.match(board, /overflow-x:hidden;overflow-y:auto/);
  assert.match(board, /width:min\(280px,calc\(100vw - 16px\)\)/);
  assert.match(board, /\.top \.menulist\[hidden\]\{display:none\}/);
});

test("board.html-scriptet er gyldig JavaScript", () => {
  const script = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/.exec(board)?.[1] ?? "";
  assert.ok(script.length > 1000);
  const file = join(mkdtempSync(join(tmpdir(), "board-")), "board.js");
  writeFileSync(file, script);
  execFileSync(process.execPath, ["--check", file]);
});
