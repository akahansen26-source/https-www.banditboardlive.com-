/**
 * Neon pastes often include quotes, a psql command, or DATABASE_URL= in front.
 * `pg` then falls back to the dummy host "base" and the build dies with
 * `getaddrinfo ENOTFOUND base`. Pull out the real postgres URL first.
 */
export function normalizeDatabaseUrl(raw, { direct = false } = {}) {
  let value = String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!value) return undefined;
  value = value.replace(/^DATABASE_URL\s*=\s*/i, "");
  value = value.replace(/^psql\s+/i, "");
  value = value.replace(/^['"`]+|['"`]+$/g, "").trim();
  const embedded = value.match(/postgres(?:ql)?:\/\/\S+/i);
  if (embedded) value = embedded[0].replace(/['"`]+$/g, "");
  value = value.replace(/\s+/g, "");
  if (!/^postgres(?:ql)?:\/\//i.test(value) && value.includes("@") && value.includes(".")) {
    value = `postgresql://${value}`;
  }
  if (direct) value = value.replace(/(@[^/?#]+)-pooler(?=[.:/?#]|$)/i, "$1");
  value = value
    .replace(/([?&])channel_binding=require&/gi, "$1")
    .replace(/[?&]channel_binding=require$/i, "");
  return value;
}

/** Hostname only when the string is a real absolute postgres URL. */
export function databaseHost(raw) {
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname;
    if (!host || host === "base") return "";
    return host;
  } catch {
    return "";
  }
}
