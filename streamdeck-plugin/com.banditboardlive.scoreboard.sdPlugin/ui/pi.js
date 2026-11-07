/* Fælles indstillingsvindue for BanditBoard Live-handlingerne (Stream Deck property inspector). */
var ws = null, uuid = "", actionUUID = "", settings = {}, globals = {}, remote = null;
const $ = (id) => document.getElementById(id);
const send = (event, extra) => ws && ws.readyState === 1 && ws.send(JSON.stringify(Object.assign({ event, context: uuid }, extra || {})));
const saveSettings = () => send("setSettings", { payload: settings });
const saveGlobals = () => send("setGlobalSettings", { payload: globals });
const toPlugin = (payload) => send("sendToPlugin", { action: actionUUID, payload });

window.connectElgatoStreamDeckSocket = function (port, inUUID, registerEvent, info, actionInfo) {
  uuid = inUUID;
  try { const a = JSON.parse(actionInfo); actionUUID = a.action; settings = a.payload.settings || {}; } catch (e) {}
  ws = new WebSocket("ws://127.0.0.1:" + port);
  ws.onopen = () => {
    ws.send(JSON.stringify({ event: registerEvent, uuid }));
    send("getGlobalSettings");
    toPlugin({ event: "refresh" });
    if (window.onSettings) window.onSettings(settings);
  };
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.event === "didReceiveGlobalSettings") { globals = d.payload.settings || {}; paintGlobals(); }
    if (d.event === "didReceiveSettings") { settings = d.payload.settings || {}; if (window.onSettings) window.onSettings(settings); }
    if (d.event === "sendToPropertyInspector" && d.payload && d.payload.event === "remote") { remote = d.payload; paintRemote(); if (window.onRemote) window.onRemote(remote); }
  };
};

function paintGlobals() {
  $("server").value = globals.server || "https://www.banditboardlive.com";
  $("token").value = globals.token || "";
  if ($("auto")) $("auto").value = globals.autoLayout || "";
}
function paintRemote() {
  const el = $("conn");
  if (!remote) return;
  if (!remote.hasToken) { el.innerHTML = '<span class="bad">●</span> Indsæt nøglen fra scoreboardet (knappen <b>🎛 Stream Deck</b>).'; return; }
  if (remote.error) { el.innerHTML = '<span class="bad">●</span> ' + esc(remote.error); return; }
  if (!remote.online) { el.innerHTML = '<span class="bad">●</span> Nøglen virker, men scoreboardet er ikke åbent. Åbn scoreboardet på BanditBoard Live.'; return; }
  const s = remote.status || {};
  const game = s.game && s.sides ? s.sides.map((x) => esc(x.name) + " " + esc(String(x.score))).join(" – ") : "ingen kamp i gang";
  el.innerHTML = '<span class="ok">●</span> Forbundet til ' + esc(s.table || "scoreboardet") + " · " + game;
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

document.addEventListener("DOMContentLoaded", () => {
  $("token").addEventListener("change", () => { globals.token = $("token").value.trim(); saveGlobals(); $("conn").textContent = "Forbinder …"; });
  $("server").addEventListener("change", () => { globals.server = $("server").value.trim(); saveGlobals(); });
  if ($("auto")) $("auto").addEventListener("change", () => { globals.autoLayout = $("auto").value; saveGlobals(); });
  $("refresh").addEventListener("click", () => { $("conn").textContent = "Henter …"; toPlugin({ event: "refresh" }); });
});
