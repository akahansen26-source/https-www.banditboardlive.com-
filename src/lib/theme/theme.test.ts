import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const block = (name: string) => css.slice(css.indexOf(name), css.indexOf("}", css.indexOf(name)));
const token = (src: string, key: string) => {
  const m = new RegExp(`--color-${key}:\\s*(#[0-9a-fA-F]{6})`).exec(src);
  assert.ok(m, `mangler --color-${key}`);
  return m[1].toLowerCase();
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const site = block("@theme {");

test("Arena Live-paletten er den godkendte", () => {
  assert.equal(token(site, "bg"), "#12161f");
  assert.equal(token(site, "surface"), "#1a2332");
  assert.equal(token(site, "primary"), "#ff5a1f");
  assert.equal(token(site, "accent"), "#00d4ff");
  assert.equal(token(site, "heading"), "#ffffff");
  assert.equal(token(site, "fg"), "#e8e8e8");
});

test("tekst og knapper har mindst 4.5:1 kontrast (WCAG AA)", () => {
  for (const bg of ["bg", "surface", "surface-2"]) {
    for (const fg of ["fg", "heading", "muted", "primary", "accent", "danger", "ok"]) {
      const r = ratio(token(site, fg), token(site, bg));
      assert.ok(r >= 4.5, `${fg} på ${bg}: ${r.toFixed(2)}`);
    }
  }
  assert.ok(ratio(token(site, "primary-fg"), token(site, "primary")) >= 4.5, "tekst på orange knap");
});

test("scoreboard/TV-fladerne (.theme-dark) bruger også Arena Live", () => {
  const tv = block(".theme-dark {");
  for (const key of ["bg", "surface", "primary", "accent", "fg", "muted", "line"]) assert.equal(token(tv, key), token(site, key), key);
});

const board = readFileSync(new URL("../../../public/board.html", import.meta.url), "utf8");
const rule = (selector: string) => {
  const at = board.indexOf(selector + "{");
  assert.ok(at >= 0, `mangler ${selector}`);
  return board.slice(at, board.indexOf("}", at));
};
const v = (src: string, key: string) => {
  const m = new RegExp(`--${key}:(#[0-9A-Fa-f]{6})`).exec(src);
  assert.ok(m, `mangler --${key}`);
  return m[1].toLowerCase();
};

test("scoreboard-appen (board.html) har Arena Live som standardtema", () => {
  assert.match(board, /<html[^>]*data-scheme="bandit"/);
  assert.match(board, /<meta name="theme-color" content="#12161F">/);
  const accents = rule(':root[data-scheme="bandit"]');
  const dark = rule(':root[data-scheme="bandit"]:not([data-mode="light"])');
  assert.equal(v(accents, "a1"), "#ff5a1f");
  assert.equal(v(accents, "a2"), "#00d4ff");
  assert.equal(v(dark, "bg"), "#12161f");
  assert.equal(v(dark, "panel"), "#1a2332");
  assert.ok(ratio(v(accents, "on-a1"), v(accents, "a1")) >= 4.5, "tekst på valgt/handling");
  for (const bg of ["bg", "panel", "panel2"]) {
    for (const fg of ["text", "muted", "danger", "ok"]) assert.ok(ratio(v(dark, fg), v(dark, bg)) >= 4.5, `${fg} på ${bg}`);
    assert.ok(ratio(v(accents, "a2"), v(dark, bg)) >= 4.5, `cyan på ${bg}`);
  }
  const light = rule(':root[data-scheme="bandit"][data-mode="light"]');
  assert.ok(ratio(v(light, "a1"), "#ffffff") >= 4.5, "lyst tema: valgt-farve på hvidt");
  assert.ok(ratio(v(light, "on-a1"), v(light, "a1")) >= 4.5, "lyst tema: tekst på knap");
});

test("brugerens øvrige farvetemaer og den gamle navy kan stadig vælges", () => {
  assert.match(board, /\['bandit','Arena Live'\],\['navy','Navy'\],\['ocean','Ocean'\],\['ember','Ember'\],\['neon','Neon'\]/);
  assert.equal(v(rule(':root[data-scheme="navy"]:not([data-mode="light"])'), "bg"), "#070d1f");
  assert.equal(v(rule(':root[data-scheme="ember"]'), "a1"), "#ff6b35");
  assert.equal(v(rule(':root[data-scheme="neon"]'), "a1"), "#7b61ff");
  assert.match(board, /scheme:'bandit'/, "standardindstillingen er uændret, så gemte valg ikke nulstilles");
});
