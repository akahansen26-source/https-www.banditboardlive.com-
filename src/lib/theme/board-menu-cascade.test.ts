/**
 * Regressionstest for menuens sidenavne: kører den rigtige CSS-kaskade fra
 * public/board.html (inkl. @media-regler) mod menuens DOM-sti og tjekker, at
 * teksten er synlig på mobil, tablet og desktop. Fanger fx en gammel
 * `@media (max-width:980px){.nav span{display:none}}`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss, { type Rule, type AtRule } from "postcss";

const board = readFileSync(process.env.BOARD_HTML || new URL("../../../public/board.html", import.meta.url), "utf8");
// Kun det statiske stylesheet i <head>; de øvrige <style> ligger i JS-skabeloner til TV/overlay.
const css = /<style[^>]*>([\s\S]*?)<\/style>/.exec(board.slice(0, board.indexOf("</head>")))?.[1] ?? "";

type El = { tag: string; id?: string; cls: string[]; attrs?: Record<string, string> };
// Stien fra header() i board.html: header.top > div.bbmenu > nav#bbmenulist.menulist > ul > li > button.nav > span.app-nav-label
const path: El[] = [
  { tag: "html", cls: [], attrs: { "data-mode": "dark", "data-scheme": "bandit", "data-font": "classic" } },
  { tag: "body", cls: [] },
  { tag: "div", id: "root", cls: [] },
  { tag: "header", cls: ["top"] },
  { tag: "div", cls: ["bbmenu"] },
  { tag: "nav", id: "bbmenulist", cls: ["menulist"], attrs: { "aria-label": "Sider" } },
  { tag: "ul", cls: [] },
  { tag: "li", cls: [] },
  { tag: "button", cls: ["nav"], attrs: { type: "button", "data-act": "tab", "data-v": "settings" } },
  { tag: "span", cls: ["app-nav-label"] },
];

function matchCompound(sel: string, el: El, isRoot: boolean): boolean {
  if (/::?(before|after|placeholder|selection|-webkit-)/.test(sel)) return false;
  let rest = sel.replace(/:not\(([^)]*)\)/g, (_, inner) => (matchCompound(inner, el, isRoot) ? "\u0000" : ""));
  if (rest.includes("\u0000")) return false;
  if (rest.includes(":root")) { if (!isRoot) return false; rest = rest.replace(":root", ""); }
  if (/:(hover|focus|focus-visible|active|disabled|checked|empty|first-child|last-child|nth-|only-)/.test(rest)) return false;
  const tag = /^[a-z][a-z0-9-]*/i.exec(rest)?.[0];
  if (tag && tag !== "*" && tag !== el.tag) return false;
  for (const m of rest.matchAll(/\.([\w-]+)/g)) if (!el.cls.includes(m[1])) return false;
  for (const m of rest.matchAll(/#([\w-]+)/g)) if (el.id !== m[1]) return false;
  for (const m of rest.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
    const v = el.attrs?.[m[1]];
    if (v === undefined || (m[2] !== undefined && v !== m[2])) return false;
  }
  return true;
}

function matches(selector: string, chain: El[]): boolean {
  const parts = selector.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
  let i = chain.length - 1;
  if (!matchCompound(parts[parts.length - 1], chain[i], i === 0)) return false;
  for (let p = parts.length - 2; p >= 0; p--) {
    const child = parts[p] === ">";
    if (child) p--;
    let found = false;
    for (let j = i - 1; j >= 0; j--) {
      if (matchCompound(parts[p], chain[j], j === 0)) { i = j; found = true; break; }
      if (child) break;
    }
    if (!found) return false;
  }
  return true;
}

const spec = (sel: string) => {
  const s = sel.replace(/:not\(([^)]*)\)/g, " $1");
  return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length, (s.match(/(^|[\s>])[a-z]+/gi) || []).length];
};
const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function mediaOk(params: string, width: number): boolean {
  if (/\bprint\b/.test(params) && !/screen/.test(params)) return false;
  for (const m of params.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)) {
    const v = Number(m[2]);
    if (m[1] === "max" && width > v) return false;
    if (m[1] === "min" && width < v) return false;
  }
  if (/orientation|hover|pointer|prefers-/.test(params) && !/width/.test(params)) return true;
  return true;
}

function computed(prop: string, width: number, chain: El[]): string | undefined {
  let best: { s: number[]; order: number; value: string; important: boolean } | undefined;
  let order = 0;
  postcss.parse(css).walkRules((rule: Rule) => {
    let parent = rule.parent;
    while (parent && parent.type === "atrule") {
      const at = parent as AtRule;
      if (at.name === "media" && !mediaOk(at.params, width)) return;
      if (at.name === "keyframes" || at.name === "supports") return;
      parent = parent.parent;
    }
    for (const sel of rule.selectors) {
      if (!matches(sel, chain)) continue;
      rule.walkDecls(prop, (d) => {
        const cand = { s: spec(sel), order: order++, value: d.value, important: d.important };
        if (!best || (cand.important && !best.important) || (cand.important === best.important && cmp(cand.s, best.s) >= 0)) best = cand;
      });
    }
  });
  return best?.value;
}

for (const width of [360, 460, 700, 952, 1280]) {
  test(`sidenavnet i rullelisten er synligt ved ${width}px`, () => {
    for (let depth = 5; depth <= path.length; depth++) {
      const display = computed("display", width, path.slice(0, depth));
      assert.notEqual(display, "none", `${path[depth - 1].tag}.${path[depth - 1].cls.join(".")} skjules ved ${width}px`);
      assert.notEqual(computed("visibility", width, path.slice(0, depth)), "hidden");
    }
    assert.notEqual(computed("font-size", width, path), "0");
  });
}

test("testen kan faktisk opdage en skjult tekst", () => {
  const broken = css + "\n@media (max-width:980px){.nav span{display:none}}";
  let found = false;
  postcss.parse(broken).walkRules((r) => { if (r.selectors.some((s) => matches(s, path)) && r.toString().includes("display:none")) found = true; });
  assert.ok(found, "selektor-matcheren genkender den gamle skjule-regel");
});

test("alle 8 sider har tekst i rullelisten", () => {
  assert.match(board, /\$\{ic\(k\)\}<span class="app-nav-label">\$\{l\}<\/span>/);
  assert.match(board, /\['game','Spil'\],\['players','Kartotek'\],\['tour','Turneringer'\],\['matrix','Oversigt'\],\['rank','Rangliste'\],\['history','Historik'\],\['media','Medier'\],\['settings','Indstillinger'\]/);
});
