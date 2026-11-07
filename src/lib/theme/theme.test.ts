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

test("scoreboard/TV-temaet er uændret", () => {
  const tv = block(".theme-dark {");
  assert.equal(token(tv, "bg"), "#070d1f");
  assert.equal(token(tv, "primary"), "#19c3ff");
  assert.equal(token(tv, "accent"), "#ff7a1a");
});
