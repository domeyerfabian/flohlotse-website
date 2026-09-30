// Flohlotse – Website-Generator
// Liest die Redaktionstabelle (Google Sheets oder lokale CSV-Dateien) und baut die komplette Website in den Ordner dist/.
// Keine Abhängigkeiten, läuft mit Node 18 oder neuer:  node build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "dist");
const TABS = ["Einstellungen", "Bezirke", "Märkte", "Serien", "Termine", "Bereiche", "Ratgeber", "Neuigkeiten"];
// Fehler in der Tabelle ohne technischen Ballast melden (in GitHub als rote Meldung und in der Zusammenfassung)
process.on("uncaughtException", e => {
  const msg = e && e.message ? e.message : String(e);
  console.error((process.env.GITHUB_ACTIONS ? "::error title=Website nicht gebaut::" : "Website nicht gebaut: ") + msg);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# Website nicht gebaut\n\n${msg}\n\nDie bisherige Website bleibt unverändert online.\n`);
  if (process.env.DEBUG) console.error(e && e.stack);
  process.exit(1);
});
const warnings = [], warnSeen = new Set();
const warn = (bereich, text) => { const k = bereich + "|" + text; if (!warnSeen.has(k)) { warnSeen.add(k); warnings.push([bereich, text]); } };

/* ---------------------------------------------------------------- Daten laden */
function parseCSV(text) {
  const rows = []; let row = []; let cell = ""; let q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (q) throw new Error("Eine Zelle hat ein öffnendes Anführungszeichen ohne schließendes. Die Daten wären ab dort unvollständig, deshalb wurde nicht gebaut.");
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchSheet(url, name) {
  const TRIES = 3, TIMEOUT = 20000;
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
      if (res.ok) return await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || i >= TRIES) throw new Error(`Tabellenblatt „${name}“ konnte nicht geladen werden (HTTP ${res.status}). Ist die Google-Tabelle für „Jeder, der über den Link verfügt“ freigegeben?`);
    } catch (e) {
      if (e.message.startsWith("Tabellenblatt")) throw e;
      if (i >= TRIES) throw new Error(`Tabellenblatt „${name}“ konnte nach ${TRIES} Versuchen nicht geladen werden (${e.name === "TimeoutError" ? "Zeitüberschreitung" : e.message}).`);
    }
    await sleep(2000 * i);
  }
}
async function loadTab(name) {
  let text;
  const id = process.env.SHEET_ID;
  if (id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("SHEET_ID enthält ungültige Zeichen. Bitte nur die ID aus dem Tabellen-Link eintragen.");
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(name)}`;
    text = await fetchSheet(url, name);
    if (/^\s*</.test(text)) throw new Error(`Tabellenblatt „${name}“ liefert keine Tabellendaten. Ist die Google-Tabelle für „Jeder, der über den Link verfügt“ freigegeben und heißt das Blatt genau „${name}“?`);
  } else {
    text = fs.readFileSync(path.join(ROOT, "daten", name + ".csv"), "utf8");
  }
  const rows = parseCSV(text).filter(r => r.some(c => c.trim() !== ""));
  const head = (rows.shift() || []).map(h => h.trim());
  const missing = (REQUIRED[name] || []).filter(c => !head.includes(c));
  if (missing.length) throw new Error(`Im Tabellenblatt „${name}“ fehlen die Spalten ${missing.map(c => "„" + c + "“").join(", ")}. Bitte die Überschriften in Zeile 1 und die Namen der Blätter nicht ändern.`);
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
const REQUIRED = {
  "Einstellungen": ["Einstellung", "Wert"], "Bezirke": ["Kennung", "Name", "Umland", "Überschrift", "SEO-Titel", "SEO-Beschreibung"],
  "Märkte": ["Kennung", "Aktiv", "Name", "Adresse", "Bezirk", "Kategorien", "SEO-Titel", "SEO-Beschreibung"],
  "Serien": ["Markt", "Rhythmus", "Wochentag", "Beginn", "Ende", "Gültig ab", "Gültig bis", "Nur Monate", "Ausnahmen"],
  "Termine": ["Markt", "Datum", "Beginn", "Ende", "Status"], "Bereiche": ["Kennung", "Name"],
  "Ratgeber": ["Kennung", "Aktiv", "Bereich", "SEO-Titel", "SEO-Beschreibung", "Überschrift", "Kurz gesagt", "Abschnitte"], "Neuigkeiten": ["Titel", "Link"]
};

/* ---------------------------------------------------------------- Hilfen */
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const yes = v => /^(ja|yes|x|1|true|wahr)$/i.test(String(v).trim());
const list = v => String(v || "").split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
const lines = v => String(v || "").split(/\n/).map(x => x.trim()).filter(Boolean);
const pad = n => String(n).padStart(2, "0");
const WDL = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function parseDate(v, ctx) {
  v = String(v || "").trim(); if (!v) return null;
  let m;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(v))) return mk(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(v))) return mk(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) return mk(+m[3], +m[1], +m[2]);
  warn("Datum", `„${v}“ ist kein gültiges Datum (${ctx}). Bitte im Format TT.MM.JJJJ eintragen.`); return null;
  function mk(y, mo, d) { const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() !== mo - 1) { warn("Datum", `„${v}“ gibt es nicht (${ctx}).`); return null; } return dt; }
}
function parseTime(v, ctx) {
  v = String(v || "").trim().replace(/\s*uhr$/i, ""); if (!v) return "";
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?$/.exec(v);
  if (!m || +m[1] > 24 || +(m[2] || 0) > 59 || (+m[1] === 24 && +(m[2] || 0) > 0)) { warn("Uhrzeit", `„${v}“ ist keine gültige Uhrzeit (${ctx}). Bitte als 08:30 eintragen.`); return ""; }
  return pad(+m[1]) + ":" + (m[2] || "00");
}
const key = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const fmtDate = d => `${WDL[d.getUTCDay()]}, ${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`;
const fmtShort = d => `${WD[d.getUTCDay()]} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.`;
const hmText = t => t.replace(/^0(\d)/, "$1").replace(/:00$/, "");
function timeText(e) {
  if (!e.start) return "Uhrzeit folgt";
  return e.end ? `${hmText(e.start)} bis ${hmText(e.end)} Uhr` : `ab ${hmText(e.start)} Uhr`;
}
function lastSun(y, mo) { const d = new Date(Date.UTC(y, mo + 1, 0)); return addDays(d, -d.getUTCDay()); }
const berlinOff = d => { const y = d.getUTCFullYear(); return d >= lastSun(y, 2) && d < lastSun(y, 9) ? "+02:00" : "+01:00"; };
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function validSlug(v, blatt, name) {
  if (SLUG.test(v)) return true;
  warn(blatt, `Kennung „${v}“${name ? " (" + name + ")" : ""} ist ungültig und wurde übersprungen. Erlaubt sind nur Kleinbuchstaben, Ziffern und Bindestriche, z. B. flohmarkt-musterplatz.`);
  return false;
}
// Erlaubt nur echte Web-Adressen, E-Mail-Links und interne Pfade – niemals javascript: o. Ä.
function safeHref(v, ctx) {
  v = String(v || "").trim();
  if (!v) return "";
  if (/^https?:\/\/[^\s"<>]+$/i.test(v) || /^mailto:[^\s"<>]+$/i.test(v) || /^\/(?![\/\\])[^\s"<>\\]*$/.test(v)) return v;
  warn("Links", `Link „${v}“ (${ctx}) ist nicht erlaubt und wurde entfernt. Erlaubt sind https://…, mailto:… und Pfade wie /termine/.`);
  return "";
}
// Zeiten prüfen: Ende muss nach Beginn liegen
function checkEnd(start, end, ctx) {
  if (start && end && end <= start) { warn("Uhrzeit", `${ctx}: Ende ${end} liegt nicht nach Beginn ${start}. Das Ende wurde ignoriert, bitte prüfen.`); return ""; }
  return end;
}

/* ---------------------------------------------------------------- Laden und aufbereiten */
const data = {};
const loaded = await Promise.all(TABS.map(loadTab));
TABS.forEach((t, i) => { data[t] = loaded[i]; });
const S = Object.fromEntries(data.Einstellungen.map(r => [r["Einstellung"], r["Wert"]]));
const siteRaw = (S["Website-Adresse"] || "").replace(/\/+$/, "");
const SITE = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(siteRaw) ? siteRaw : "https://www.example.org";
if (!siteRaw) warn("Einstellungen", "Website-Adresse fehlt. Links für Google zeigen so lange auf www.example.org.");
else if (SITE !== siteRaw) warn("Einstellungen", `Website-Adresse „${siteRaw}“ ist ungültig. Bitte nur die Domain eintragen, z. B. https://www.flohlotse.de.`);
const NAME = S["Name"] || "Flohlotse";
const REGION = S["Region"] || "Hamburg + 30 km";
const horizonRaw = parseInt(S["Tage im Voraus"], 10) || 120;
const HORIZON = Math.min(400, Math.max(14, horizonRaw));
if (horizonRaw !== HORIZON) warn("Einstellungen", `„Tage im Voraus“ = ${horizonRaw} liegt außerhalb von 14 bis 400. Es werden ${HORIZON} Tage verwendet.`);
const FORM = safeHref(S["Formular-Link"], "Einstellungen, Formular-Link");
const PUBLIC = yes(S["Für Google freigeben"]);
const BASE = (process.env.BASE_PATH || "").replace(/\/+$/, "");

const todayStr = process.env.TODAY || new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const TODAY = new Date(todayStr + "T00:00:00Z");
const STAND = `${pad(TODAY.getUTCDate())}.${pad(TODAY.getUTCMonth() + 1)}.${TODAY.getUTCFullYear()}`;
const END = addDays(TODAY, HORIZON);

const REGIONS = data.Bezirke.filter(r => validSlug(r["Kennung"], "Bezirke", r["Name"])).map(r => ({ k: r["Kennung"], name: r["Name"], umland: yes(r["Umland"]), im: r["Im Satz"] || "in " + r["Name"], kw: r["Suchbegriff"], h: r["Überschrift"], t: r["SEO-Titel"], d: r["SEO-Beschreibung"], intro: r["Einleitung"] }));
const RBY = Object.fromEntries(REGIONS.map(r => [r.k, r]));
const CLUSTERS = Object.fromEntries(data.Bereiche.filter(r => validSlug(r["Kennung"], "Bereiche", r["Name"])).map(r => [r["Kennung"], { t: r["Name"], p: r["Beschreibung"] }]));

const MARKETS = data["Märkte"].filter(r => yes(r["Aktiv"]) && r["Kennung"] && validSlug(r["Kennung"], "Märkte", r["Name"])).map(r => ({
  slug: r["Kennung"], name: r["Name"], short: r["Kurzname"] || r["Name"], satz: r["Satzanfang"] || r["Name"], place: r["Ort (Platz)"] || r["Name"],
  area: r["Stadtteil"], addr: r["Adresse"], bez: r["Bezirk"], org: r["Veranstalter"], tags: list(r["Kategorien"]), rhythm: r["Rhythmus kurz"],
  when: r["Rhythmus im Satz"], note: r["Kurzbeschreibung"], intro: r["Einleitung"], tips: lines(r["Tipps"]), hint: r["Hinweis"], oepnv: r["Haltestelle"],
  kw: r["Suchbegriff"], t: r["SEO-Titel"], d: r["SEO-Beschreibung"], kb: list(r["Ratgeber-Artikel"]), events: []
}));
if (!MARKETS.length) throw new Error("Keine aktiven Märkte gefunden (Blatt „Märkte“, Spalte „Aktiv“). Die Website wurde nicht veröffentlicht, damit keine leere Seite online geht.");
const MBY = Object.fromEntries(MARKETS.map(m => [m.slug, m]));
function assertUnique(items, blatt) {
  const dup = items.filter((s, i, a) => a.indexOf(s) !== i);
  if (dup.length) throw new Error(`Im Blatt „${blatt}“ ist die Kennung ${[...new Set(dup)].map(x => "„" + x + "“").join(", ")} mehrfach vergeben. Sonst würde eine Seite die andere überschreiben, deshalb wurde nicht gebaut.`);
}
assertUnique(MARKETS.map(m => m.slug), "Märkte");
assertUnique(REGIONS.map(r => r.k), "Bezirke");
for (const m of MARKETS) if (!RBY[m.bez]) warn("Märkte", `${m.name}: Bezirk „${m.bez}“ gibt es nicht im Blatt Bezirke.`);

/* Termine aus Serien und Einzelterminen */
const WDMAP = Object.fromEntries(WDL.map((w, i) => [w.toLowerCase(), i]));
function monthSet(v) {
  if (!v) return null; const s = new Set();
  for (const part of list(v)) { const m = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(part); if (m) { for (let i = +m[1]; i <= +m[2]; i++) s.add(i); } else if (/^\d{1,2}$/.test(part)) s.add(+part); }
  return s.size ? s : null;
}
const evMap = new Map();
for (const r of data.Serien) {
  const m = MBY[r["Markt"]]; if (!m) { if (r["Markt"]) warn("Serien", `Markt „${r["Markt"]}“ ist unbekannt oder nicht aktiv.`); continue; }
  const wd = WDMAP[String(r["Wochentag"]).toLowerCase()]; if (wd === undefined) { warn("Serien", `${m.name}: Wochentag „${r["Wochentag"]}“ ist ungültig.`); continue; }
  const rhythm = String(r["Rhythmus"]).toLowerCase(); const nth = /^(\d)\./.exec(rhythm); const last = rhythm.startsWith("letzt");
  if (!nth && !last && !rhythm.startsWith("jede")) { warn("Serien", `${m.name}: Rhythmus „${r["Rhythmus"]}“ ist ungültig.`); continue; }
  const from = parseDate(r["Gültig ab"], m.name) || TODAY, to = parseDate(r["Gültig bis"], m.name) || END;
  const months = monthSet(r["Nur Monate"]); const skip = new Set(list(r["Ausnahmen"]).map(x => { const d = parseDate(x, m.name + " Ausnahmen"); return d && key(d); }));
  const start = parseTime(r["Beginn"], m.name), end = checkEnd(start, parseTime(r["Ende"], m.name), `${m.name} (${r["Wochentag"]})`);
  if (r["Gültig bis"] && to >= TODAY && to < addDays(TODAY, 45)) warn("Serie endet bald", `${m.name} (${r["Wochentag"]}): Die Serie läuft nur bis ${fmtDate(to)}. Bei Bedarf „Gültig bis“ verlängern, sobald der Veranstalter neue Termine bestätigt.`);
  for (let d = new Date(Math.max(TODAY, from)); d <= to && d <= END; d = addDays(d, 1)) {
    if (d.getUTCDay() !== wd || skip.has(key(d))) continue;
    if (months && !months.has(d.getUTCMonth() + 1)) continue;
    if (nth && Math.ceil(d.getUTCDate() / 7) !== +nth[1]) continue;
    if (last && addDays(d, 7).getUTCMonth() === d.getUTCMonth()) continue;
    evMap.set(m.slug + key(d), { m, date: d, k: key(d), start, end, cancelled: false, note: "" });
  }
}
for (const r of data.Termine) {
  const m = MBY[r["Markt"]]; if (!m) { if (r["Markt"]) warn("Termine", `Markt „${r["Markt"]}“ ist unbekannt oder nicht aktiv.`); continue; }
  if (!r["Datum"]) { warn("Termine", `${m.name}: Zeile ohne Datum. Falls ein Datum eingetragen ist, die Spalte als „Nur Text“ formatieren und das Datum neu eintippen.`); continue; }
  const d = parseDate(r["Datum"], m.name); if (!d || d < TODAY || d > END) continue;
  const k = key(d), ex = evMap.get(m.slug + k);
  const e = ex || { m, date: d, k, start: "", end: "", cancelled: false, note: "" };
  const st = parseTime(r["Beginn"], m.name), en = parseTime(r["Ende"], m.name);
  if (st) e.start = st; if (en) e.end = en;
  e.end = checkEnd(e.start, e.end, `${m.name} am ${fmtDate(d)}`);
  e.cancelled = /abgesagt|fällt aus|entfällt/i.test(r["Status"] || "");
  e.note = r["Hinweis"] || "";
  evMap.set(m.slug + k, e);
}
const EVENTS = [...evMap.values()].sort((a, b) => a.k === b.k ? (a.start || "99").localeCompare(b.start || "99") : a.k.localeCompare(b.k));
for (const e of EVENTS) e.m.events.push(e);
for (const e of EVENTS) if (!e.start && !e.cancelled && (e.date - TODAY) / 864e5 < 21) warn("Uhrzeit fehlt", `${e.m.name} am ${fmtDate(e.date)}`);
for (const m of MARKETS) if (!m.events.length) warn("Keine Termine", `${m.name} hat in den nächsten ${HORIZON} Tagen keinen Termin.`);

const KB = data.Ratgeber.filter(r => yes(r["Aktiv"]) && r["Kennung"] && validSlug(r["Kennung"], "Ratgeber", r["Überschrift"])).map(r => ({
  s: r["Kennung"], c: r["Bereich"], kw: r["Suchbegriff"], i: r["Suchabsicht"], t: r["SEO-Titel"], d: r["SEO-Beschreibung"], h: r["Überschrift"], a: r["Kurz gesagt"],
  b: String(r["Abschnitte"] || "").split(/\n(?=## )/).map(block => { const [h, ...p] = block.replace(/^## /, "").split("\n"); return [h.trim(), p.join("\n").trim()]; }).filter(x => x[0]),
  f: String(r["Häufige Fragen"] || "").split(/\n\s*\n/).map(b => { const q = /F:\s*([\s\S]*?)\nA:\s*([\s\S]*)/.exec(b.trim()); return q ? [q[1].trim(), q[2].trim()] : null; }).filter(Boolean),
  r: list(r["Verwandte Artikel"]), x: yes(r["Rechtshinweis"]), top: yes(r["Auf Startseite"])
}));
assertUnique(KB.map(a => a.s), "Ratgeber");
const KBY = Object.fromEntries(KB.map(a => [a.s, a]));
if (!KB.length) warn("Ratgeber", "Keine aktiven Ratgeber-Artikel gefunden.");
const NEWS = data.Neuigkeiten.filter(r => r["Titel"] && (!r["Anzeigen bis"] || (parseDate(r["Anzeigen bis"], "Neuigkeiten") || END) >= TODAY));

/* ---------------------------------------------------------------- Text mit Links */
function rich(text) {
  return esc(text).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    if (/^https?:\/\//.test(href)) return `<a href="${href}" rel="noopener">${label}</a>`;
    if (/^\/(?![\/\\])[^\\]*$/.test(href)) return `<a href="${href}">${label}</a>`;
    if (KBY[href]) return `<a href="/ratgeber/${href}/">${label}</a>`;
    if (MBY[href]) return `<a href="/flohmarkt/${href}/">${label}</a>`;
    warn("Links", `Unbekanntes Linkziel „${href}“`); return label;
  }).replace(/\n/g, "<br>");
}
const plain = t => String(t || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

/* ---------------------------------------------------------------- Schriften */
// Schriftdateien einfach in den Ordner fonts legen (so wie sie von fonts.google.com heruntergeladen werden, .ttf oder .woff2)
const FONT_RULES = [[/bricolage.*\.(woff2|ttf)$/i, "Bricolage Grotesque", "200 800"], [/figtree.*variable.*\.(woff2|ttf)$|^figtree\.(woff2|ttf)$/i, "Figtree", "300 900"], [/dm.?mono.*(regular|400).*\.(woff2|ttf)$/i, "DM Mono", "400"], [/dm.?mono.*(medium|500).*\.(woff2|ttf)$/i, "DM Mono", "500"]];
const fontDir = path.join(ROOT, "fonts");
const fontFilesAll = fs.existsSync(fontDir) ? fs.readdirSync(fontDir) : [];
// Kursive Varianten nie nehmen; bei mehreren Treffern woff2 und variable Schriften bevorzugen
const fontScore = x => (x.endsWith("woff2") ? 2 : 0) + (/variable/i.test(x) ? 1 : 0);
const fontsFound = FONT_RULES.map(([re, fam, w]) => { const f = fontFilesAll.filter(x => re.test(x) && !/italic/i.test(x)).sort((a, b) => fontScore(b) - fontScore(a) || a.localeCompare(b))[0]; return f && { f, fam, w }; }).filter(Boolean);
const fontCSS = fontsFound.map(x => `@font-face{font-family:"${x.fam}";src:url("/fonts/${encodeURIComponent(x.f)}") format("${x.f.endsWith("woff2") ? "woff2" : "truetype"}");font-weight:${x.w};font-style:normal;font-display:swap}`).join("\n");
if (fontsFound.length < 4) warn("Schriften", `Im Ordner fonts fehlen ${4 - fontsFound.length} von 4 Schriftdateien. Die Seite nutzt so lange Systemschriften.`);

/* ---------------------------------------------------------------- Seitenrahmen */
const pages = new Map();
const TAGS_ALL = [...new Set(MARKETS.flatMap(m => m.tags))];
function menuHTML() {
  const cnt = k => MARKETS.filter(m => m.bez === k).length;
  const li = (h, l) => `<li><a href="${h}">${l}</a></li>`;
  return `<details class="menu-wrap"><summary class="menu-btn"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg><span>Menü</span></summary>
<div class="menu"><nav class="menu-grid" aria-label="Alle Bereiche">
<div><h3>Flohmärkte finden</h3><ul>${li("/heute/", "Heute")}${li("/wochenende/", "Am Wochenende")}${li("/sonntag/", "Am Sonntag")}${li("/termine/", "Alle Termine")}${li("/flohmaerkte/", "Alle Märkte")}</ul></div>
<div><h3>Hamburg</h3><ul>${REGIONS.filter(r => !r.umland).map(r => li(`/flohmarkt-hamburg/${r.k}/`, `${esc(r.name)} <small>${cnt(r.k)}</small>`)).join("")}</ul></div>
<div><h3>Umland bis 30 km</h3><ul>${REGIONS.filter(r => r.umland).map(r => li(`/flohmarkt-hamburg/${r.k}/`, `${esc(r.name)} <small>${cnt(r.k)}</small>`)).join("")}</ul></div>
<div><h3>Ratgeber</h3><ul>${Object.entries(CLUSTERS).map(([c, v]) => li(`/ratgeber/#${c}`, esc(v.t))).join("")}${li("/ratgeber/", "Alle Artikel")}</ul></div>
<div><h3>${esc(NAME)}</h3><ul>${li("/veranstalter/", "Für Veranstalter")}${li("/impressum/", "Impressum")}${li("/datenschutz/", "Datenschutz")}</ul></div>
</nav></div></details>`;
}
const MENU = () => menuHTML();
function layout({ p, title, desc, body, ld, noindex, nav, extraHead = "" }) {
  const url = SITE + p;
  const navItems = [["/termine/", "Termine", "termine"], ["/flohmaerkte/", "Märkte", "maerkte"], ["/ratgeber/", "Ratgeber", "ratgeber"], ["/veranstalter/", "Für Veranstalter", "org"]];
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${noindex || !PUBLIC ? "noindex,follow" : "index,follow"}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:locale" content="de_DE"><meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}${extraHead}
</head>
<body>
<a class="skip" href="#inhalt">Zum Inhalt springen</a>
<header class="top"><div class="wrap">
<a class="brand" href="/"><i>€</i>${esc(NAME)}</a>
<nav class="nav" aria-label="Hauptmenü">${navItems.map(([h, l, k]) => `<a href="${h}"${k === nav ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
${MENU()}
</div></header>
<main class="wrap" id="inhalt">
${body}
</main>
<footer class="wrap site-foot">
<div>Termine nach öffentlichen Angaben der Veranstalter, Stand ${STAND}. Bitte vor dem Besuch beim Veranstalter prüfen, Märkte können kurzfristig ausfallen. Ratgeber-Artikel ersetzen keine Rechts- oder Steuerberatung.</div>
<div>Flohmarkt Hamburg: <a href="/heute/">Heute</a> · <a href="/wochenende/">Wochenende</a> · <a href="/sonntag/">Sonntag</a> · ${REGIONS.map(r => `<a href="/flohmarkt-hamburg/${r.k}/">${esc(r.name)}</a>`).join(" · ")}</div>
<div>${esc(NAME)} · <a href="/ratgeber/">Ratgeber</a> · <a href="/veranstalter/">Für Veranstalter</a> · <a href="/impressum/">Impressum</a> · <a href="/datenschutz/">Datenschutz</a></div>
</footer>
<script src="/assets/site.js" defer></script>
</body>
</html>`;
  pages.set(p, { html, noindex, title, desc });
}
const crumbs = items => `<nav class="crumbs" aria-label="Brotkrümel">${items.map((it, i) => (i ? "<span>›</span>" : "") + (it[1] ? `<a href="${it[1]}">${esc(it[0])}</a>` : `<span>${esc(it[0])}</span>`)).join("")}</nav>`;
const crumbLD = items => ({ "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it[0], ...(it[1] ? { item: SITE + it[1] } : {}) })) });
const G = graph => ({ "@context": "https://schema.org", "@graph": graph });

/* ---------------------------------------------------------------- Bausteine */
function eventLD(e) {
  const m = e.m, parts = m.addr.split(", "), pm = /(\d{5})\s+(.+)/.exec(parts[parts.length - 1] || "");
  const ev = {
    "@type": "Event", name: m.name, url: `${SITE}/flohmarkt/${m.slug}/`,
    startDate: e.start ? `${e.k}T${e.start}:00${berlinOff(e.date)}` : e.k,
    eventStatus: e.cancelled ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", description: m.note || m.name,
    location: { "@type": "Place", name: m.place, address: { "@type": "PostalAddress", streetAddress: parts[0], addressLocality: pm ? pm[2] : (parts.length > 1 ? parts[parts.length - 1] : (m.area || "Hamburg")), addressCountry: "DE", ...(pm ? { postalCode: pm[1] } : {}) } }
  };
  if (e.start && e.end) ev.endDate = `${e.k}T${e.end}:00${berlinOff(e.date)}`;
  if (m.org) ev.organizer = { "@type": "Organization", name: m.org };
  return ev;
}
function evHTML(e) {
  const m = e.m, q = encodeURIComponent(m.name + ", " + m.addr);
  const t = e.cancelled ? "<small>Termin</small>fällt aus" : !e.start ? "<small>Uhrzeit</small>folgt" : e.end ? `<small>${e.start}</small>bis<br>${e.end}` : `<small>Beginn</small>${e.start}`;
  return `<article class="ev${e.cancelled ? " off" : ""}" data-tags="${esc(m.tags.join("|"))}"><div class="time" aria-label="${esc(e.cancelled ? "Abgesagt" : timeText(e))}">${t}</div><div class="ev-body">
<h3><a href="/flohmarkt/${m.slug}/">${esc(m.name)}</a></h3><div class="meta">${esc(m.area)} · ${esc(m.addr)}</div>
${e.cancelled ? `<p class="note warn-text">Dieser Termin fällt aus.${e.note ? " " + esc(e.note) : ""}</p>` : m.note ? `<p class="note">${esc(m.note)}${e.note ? " " + esc(e.note) : ""}</p>` : ""}
<div class="row">${m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}<span class="rhythm">${esc(m.rhythm)}</span><a href="https://www.google.com/maps/search/?api=1&amp;query=${q}" rel="noopener">Route</a></div>
${m.org ? `<div class="meta small">Veranstalter: ${esc(m.org)}</div>` : ""}</div></article>`;
}
function groupList(evs) {
  const g = new Map(); for (const e of evs) { if (!g.has(e.k)) g.set(e.k, []); g.get(e.k).push(e); }
  return [...g].map(([k, list]) => `<div class="group" data-day="${k}"><h2 class="group-h">${fmtDate(list[0].date)}</h2><div class="list">${list.map(evHTML).join("")}</div></div>`).join("");
}
const kbCard = s => { const r = KBY[s]; if (!r) { warn("Ratgeber", `Verweis auf unbekannten Artikel „${s}“`); return ""; } return `<a class="card" href="/ratgeber/${r.s}/"><span class="kicker">Ratgeber · ${esc(CLUSTERS[r.c]?.t || "")}</span><h3>${esc(r.h)}</h3><p>${esc(short(plain(r.a), 110))}</p></a>`; };
function short(t, n) { t = String(t || ""); if (t.length <= n) return t; const cut = t.slice(0, n); return (cut.lastIndexOf(" ") > n * 0.6 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,.;:–-]+$/, "") + " …"; }
const mCard = m => { const n = m.events.find(e => !e.cancelled); return `<a class="card" href="/flohmarkt/${m.slug}/"><span class="kicker">${esc(m.area)}</span><h3>${esc(m.name)}</h3><p>${esc(m.rhythm)}${n ? " · nächster Termin " + fmtShort(n.date) : ""}</p></a>`; };
const grid = cards => { cards = cards.filter(Boolean); const n = cards.length; return `<div class="news ${n % 3 === 0 ? "cols3" : n % 2 === 0 ? "cols2" : "fit"}">${cards.join("")}</div>`; };
const regionChips = skip => `<div class="chips">${[["/heute/", "Heute"], ["/wochenende/", "Wochenende"], ["/sonntag/", "Sonntag"]].filter(x => x[0] !== skip).map(([h, l]) => `<a class="chip" href="${h}">${l}</a>`).join("")}${REGIONS.filter(r => `/flohmarkt-hamburg/${r.k}/` !== skip).map(r => `<a class="chip" href="/flohmarkt-hamburg/${r.k}/">${esc(r.name)}</a>`).join("")}</div>`;
const KBMAP = { "Überdacht": ["flohmarkt-bei-regen", "beste-uhrzeit-flohmarkt", "handeln-auf-dem-flohmarkt"], "Umland": ["was-mitnehmen-flohmarkt", "beste-uhrzeit-flohmarkt", "handeln-auf-dem-flohmarkt"], "Kinder & Spielzeug": ["flohmarkt-mit-kindern", "kinderflohmarkt-verkaufen", "handeln-auf-dem-flohmarkt"], "Sammler & Vinyl": ["antiquitaeten-erkennen-flohmarkt", "faelschungen-erkennen-flohmarkt", "handeln-auf-dem-flohmarkt"], "Nachbarschaft": ["flohmarkt-knigge", "flohmarkt-mit-kindern", "handeln-auf-dem-flohmarkt"], "Abends": ["nachtflohmarkt", "bezahlen-auf-dem-flohmarkt", "handeln-auf-dem-flohmarkt"] };
const kbFor = m => (m.kb.length ? m.kb : KBMAP[m.tags.find(t => KBMAP[t])] || ["beste-uhrzeit-flohmarkt", "handeln-auf-dem-flohmarkt", "was-mitnehmen-flohmarkt"]).filter(s => KBY[s]);
function whenOf(m) {
  if (m.when) return m.when;
  const ds = m.events.filter(e => !e.cancelled).map(e => e.date);
  if (!ds.length) return "";
  if (ds.length === 1) return "am " + fmtDate(ds[0]);
  const shown = ds.slice(0, 4), last = shown[shown.length - 1];
  return "am " + shown.slice(0, -1).map(d => d.getUTCDate() + "." + (d.getUTCMonth() !== last.getUTCMonth() ? " " + MON[d.getUTCMonth()] : "")).join(", ") + " und " + last.getUTCDate() + ". " + MON[last.getUTCMonth()];
}
const regionLabel = r => (r.umland ? "Region " : "Bezirk ") + r.name;
const thin = k => MARKETS.filter(m => m.bez === k).length < 2;
// Aktuelles Wochenende: samstags und sonntags das laufende, sonst das kommende
function weekendDays() {
  const wd = TODAY.getUTCDay();
  if (wd === 0) return { sat: addDays(TODAY, -1), sun: TODAY, sunOnly: true };
  const sat = addDays(TODAY, (6 - wd + 7) % 7);
  return { sat, sun: addDays(sat, 1), sunOnly: false };
}
const upcoming = (days, filter = () => true) => EVENTS.filter(e => (e.date - TODAY) / 864e5 < days && filter(e));

/* ---------------------------------------------------------------- Startseite */
{
  const { sat, sun, sunOnly } = weekendDays();
  const weN = EVENTS.filter(e => !e.cancelled && (e.k === key(sat) || e.k === key(sun))).length;
  const weLabel = sunOnly ? `Termine heute, Sonntag ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()].slice(0, 3)}.` : `Termine am Wochenende ${sat.getUTCDate()}.–${sun.getUTCDate()}. ${MON[sun.getUTCMonth()].slice(0, 3)}.`;
  const next = []; let days = new Set();
  for (const e of upcoming(14)) { if (next.length >= 8 && !days.has(e.k)) break; next.push(e); days.add(e.k); }
  const all14 = upcoming(14).length;
  const body = `<section class="hero"><div>
<span class="proto">${esc(REGION)}</span>
<h1>Flohmarkt Hamburg: alle Termine, aufgeräumt.</h1>
<p>Wann, wo und wie lange. Ohne Werbebanner, ohne alte Termine.</p>
<div class="quick"><a class="chip" href="/heute/">Heute</a><a class="chip" href="/wochenende/">Wochenende</a><a class="chip" href="/sonntag/">Sonntag</a><a class="chip" href="/flohmaerkte/">Märkte nach Bezirk</a><a class="chip" href="/ratgeber/">Ratgeber</a></div>
</div><a class="big-sticker" href="/wochenende/"><b>${weN}</b><span>${weLabel}</span></a></section>
<section class="sec"><div class="sec-head"><h2>Die nächsten Flohmärkte</h2><a href="/termine/">Alle Termine</a></div>
${groupList(next) || '<div class="empty">Gerade stehen keine Termine im Kalender.</div>'}
${all14 > next.length ? `<a class="more" href="/termine/">Alle ${all14} Termine der nächsten 14 Tage anzeigen</a>` : ""}</section>
<section class="sec"><div class="sec-head"><h2>Flohmärkte nach Bezirk und Region</h2><a href="/flohmaerkte/">Alle Märkte</a></div>${regionChips()}</section>
${NEWS.length ? `<section class="sec"><div class="sec-head"><h2>Neuigkeiten</h2></div>${grid(NEWS.map(n => `<a class="card" href="${esc(safeHref(n["Link"], "Neuigkeiten: " + n["Titel"]) || "/")}"><span class="kicker">${esc(n["Kicker"])}</span><h3>${esc(n["Titel"])}</h3><p>${esc(n["Text"])}</p></a>`))}</section>` : ""}
<section class="sec"><div class="sec-head"><h2>Häufige Fragen</h2><a href="/ratgeber/">Alle Ratgeber-Artikel</a></div>${grid(KB.filter(a => a.top).map(a => `<a class="card" href="/ratgeber/${a.s}/"><span class="kicker">${esc(CLUSTERS[a.c]?.t || "")}</span><h3>${esc(a.h)}</h3></a>`))}</section>
<section class="sec" id="veranstalter"><div class="org"><h2>Du veranstaltest einen Flohmarkt?</h2><p>Trag deinen Termin kostenlos ein. Wir prüfen jeden Eintrag, bevor er erscheint.</p><a class="btn" href="/veranstalter/">Termin eintragen</a></div></section>`;
  layout({ p: "/", title: `Flohmarkt Hamburg: Alle Termine ${TODAY.getUTCFullYear()} | ${NAME}`, desc: "Alle Flohmärkte in Hamburg und Umgebung, aufgeräumt: Termine, Zeiten, Adressen und ein Ratgeber mit Antworten auf die wichtigsten Flohmarkt-Fragen.", body, nav: "", ld: { "@context": "https://schema.org", "@type": "WebSite", name: NAME, url: SITE + "/" } });
}

/* ---------------------------------------------------------------- Alle Termine */
{
  const evs = upcoming(60);
  const body = crumbs([[NAME, "/"], ["Termine"]]) + `<section class="hub-head"><h1>Flohmarkt-Termine in Hamburg und Umgebung</h1><p>Alle Termine der nächsten 60 Tage in Hamburg und im Umland bis 30 Kilometer, nach Tagen sortiert.</p>
<div class="chips" id="filter" role="group" aria-label="Art des Markts"><button class="chip" type="button" data-t="" aria-pressed="true">Alle Arten</button>${TAGS_ALL.map(t => `<button class="chip" type="button" data-t="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("")}</div></section>
<div id="liste">${groupList(evs)}</div><div class="empty" id="leer" hidden>Keine Märkte dieser Art in den nächsten 60 Tagen.</div>`;
  layout({ p: "/termine/", title: `Flohmarkt-Termine Hamburg: die nächsten 60 Tage | ${NAME}`, desc: "Alle Flohmarkt-Termine in Hamburg und im Umland bis 30 Kilometer für die nächsten 60 Tage, mit Uhrzeiten, Adressen und Veranstaltern.", body, nav: "termine", ld: G([crumbLD([[NAME, "/"], ["Termine"]])].concat(evs.slice(0, 60).map(eventLD))) });
}

/* ---------------------------------------------------------------- Alle Märkte */
{
  const body = crumbs([[NAME, "/"], ["Alle Märkte"]]) + `<section class="hub-head"><h1>Alle Flohmärkte in Hamburg und Umgebung</h1><p>${MARKETS.length} Märkte in Hamburg und im Umland bis 30 Kilometer, sortiert nach Bezirk und Region.</p></section>
${REGIONS.map(r => { const ms = MARKETS.filter(m => m.bez === r.k); return ms.length ? `<section class="cluster"><div class="sec-head"><h2>${esc(r.name)}</h2><a href="/flohmarkt-hamburg/${r.k}/">Seite ${esc(r.name)}</a></div><div class="qlist">${ms.map(m => `<a href="/flohmarkt/${m.slug}/"><span>${esc(m.name)}<br><small class="meta">${esc(m.area)} · ${esc(m.rhythm)}</small></span><span aria-hidden="true">›</span></a>`).join("")}</div></section>` : ""; }).join("")}`;
  layout({ p: "/flohmaerkte/", title: `Alle Flohmärkte in Hamburg und Umgebung | ${NAME}`, desc: `Alle ${MARKETS.length} Flohmärkte in Hamburg und im Umland bis 30 Kilometer auf einen Blick, sortiert nach Bezirk und Region, mit Rhythmus und Terminen.`, body, nav: "maerkte", ld: G([crumbLD([[NAME, "/"], ["Alle Märkte"]]), { "@type": "ItemList", itemListElement: MARKETS.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name, url: `${SITE}/flohmarkt/${m.slug}/` })) }]) });
}

/* ---------------------------------------------------------------- Marktseiten */
for (const m of MARKETS) {
  const r = RBY[m.bez] || { name: m.bez, im: "", umland: false, k: m.bez };
  const nx = m.events.slice(0, 8), first = m.events.find(e => !e.cancelled);
  const route = "https://www.google.com/maps/dir/?api=1&amp;travelmode=transit&amp;destination=" + encodeURIComponent(m.name + ", " + m.addr);
  const others = MARKETS.filter(x => x.bez === m.bez && x !== m);
  const singleDates = !m.when && m.events.filter(e => !e.cancelled).length === 1;
  const when = whenOf(m);
  const timeVariants = new Set(m.events.filter(e => !e.cancelled).map(timeText));
  const mixed = timeVariants.size > 1;
  const answer = when ? `${esc(m.satz)} findet ${esc(when)}${first && first.start && !mixed ? (first.end ? ` von ${hmText(first.start)} bis ${hmText(first.end)} Uhr` : ` ab ${hmText(first.start)} Uhr`) : ""} statt. Adresse: ${esc(m.addr)}. ${first ? (singleDates ? "" : "Nächster Termin: " + fmtDate(first.date) + (mixed && first.start ? ", " + (first.end ? `${hmText(first.start)} bis ${hmText(first.end)} Uhr` : `ab ${hmText(first.start)} Uhr`) : "") + ".") : ""}`
    : `${esc(m.satz)} hat derzeit keinen angekündigten Termin. Adresse: ${esc(m.addr)}.`;
  const body = crumbs([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name, `/flohmarkt-hamburg/${r.k}/`], [m.short]]) + `<article class="kb">
<h1>${esc(m.name)}: Öffnungszeiten und Termine</h1>
<div class="byline"><span>${esc(m.area)}</span><span>${esc(regionLabel(r))}</span><span>Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${answer}</p></div>
<dl class="facts"><div><dt>Wann</dt><dd>${esc(cap(when) || "Derzeit kein Termin")}</dd></div><div><dt>Uhrzeit</dt><dd>${!first ? "–" : mixed ? "je nach Termin, siehe unten" : timeText(first)}</dd></div>
<div><dt>Adresse</dt><dd>${esc(m.addr)}<br><a href="${route}" rel="noopener">Route planen</a></dd></div>
${m.oepnv ? `<div><dt>Nächste Haltestelle</dt><dd>${esc(m.oepnv)}</dd></div>` : ""}${m.org ? `<div><dt>Veranstalter</dt><dd>${esc(m.org)}</dd></div>` : ""}</dl>
${m.intro ? `<section class="block kb-body"><h2>Über den Markt</h2><p>${rich(m.intro)}</p></section>` : ""}
<section class="block"><h2>Nächste Termine</h2>${nx.length ? `<ul class="dates">${nx.map(e => `<li${e.cancelled ? ' class="off"' : ""}><span class="dt">${fmtDate(e.date)}</span><span class="tm">${e.cancelled ? "fällt aus" : timeText(e)}</span>${e.note ? `<span class="meta">${esc(e.note)}</span>` : ""}</li>`).join("")}</ul>` : '<p class="meta">Die nächsten Termine sind noch nicht angekündigt.</p>'}</section>
${m.tips.length ? `<section class="block kb-body"><h2>Gut zu wissen</h2><ul class="tips">${m.tips.map(t => `<li>${rich(t)}</li>`).join("")}</ul></section>` : ""}
${m.hint ? `<p class="hint">${rich(m.hint)}</p>` : ""}
<p class="hint">Angaben nach öffentlichen Informationen des Veranstalters, ohne Gewähr. Märkte können kurzfristig ausfallen.</p>
<section class="related"><div class="sec-head"><h2>Tipps für deinen Besuch</h2><a href="/ratgeber/">Zum Ratgeber</a></div>${grid(kbFor(m).map(kbCard))}</section>
<section class="related"><div class="sec-head"><h2>Weitere Flohmärkte ${esc(r.im)}</h2><a href="/flohmarkt-hamburg/${r.k}/">Alle anzeigen</a></div>${others.length ? grid(others.map(mCard)) : '<p class="meta">Weitere Märkte folgen.</p>'}</section></article>`;
  if (!m.t) warn("SEO", `${m.name}: SEO-Titel fehlt.`);
  layout({ p: `/flohmarkt/${m.slug}/`, title: `${m.t || m.name + ": Termine & Öffnungszeiten"} | ${NAME}`, desc: m.d || plain(m.note), body, nav: "maerkte", ld: G([crumbLD([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name, `/flohmarkt-hamburg/${r.k}/`], [m.name]])].concat(nx.map(eventLD))) });
}

/* ---------------------------------------------------------------- Bezirke und Regionen */
for (const r of REGIONS) {
  const ms = MARKETS.filter(m => m.bez === r.k), ev = upcoming(31, e => e.m.bez === r.k), first = ev.find(e => !e.cancelled);
  const body = crumbs([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name]]) + `<article class="kb"><h1>${esc(r.h)}</h1>
<div class="byline"><span>${esc(regionLabel(r))}</span><span>${ms.length === 1 ? "1 Markt" : ms.length + " Märkte"}</span><span>Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(cap(r.im))} ${ms.length === 1 ? "steht ein Flohmarkt" : `stehen ${ms.length} Flohmärkte`} im ${esc(NAME)}-Kalender.${first ? ` Der nächste Termin: ${esc(first.m.name)} am ${fmtDate(first.date)}, ${timeText(first)}.` : ""}</p></div>
${r.intro ? `<section class="block kb-body"><p>${rich(r.intro)}</p></section>` : ""}
<section class="related"><div class="sec-head"><h2>Die Märkte</h2></div>${grid(ms.map(mCard))}</section>
<section class="related"><div class="sec-head"><h2>Nächste Termine</h2><small>nächste 30 Tage</small></div>${groupList(ev) || '<p class="meta">In den nächsten 30 Tagen keine Termine.</p>'}</section>
<section class="related"><div class="sec-head"><h2>Weitere Bezirke und Zeiträume</h2></div>${regionChips(`/flohmarkt-hamburg/${r.k}/`)}</section>
<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2></div>${grid(["flohmaerkte-hamburg", "flohmarkt-knigge"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p: `/flohmarkt-hamburg/${r.k}/`, title: `${r.t} | ${NAME}`, desc: r.d, body, nav: "maerkte", noindex: thin(r.k), ld: G([crumbLD([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name]]), { "@type": "ItemList", itemListElement: ms.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name, url: `${SITE}/flohmarkt/${m.slug}/` })) }].concat(ev.map(eventLD))) });
}

/* ---------------------------------------------------------------- Heute, Wochenende, Sonntag */
{
  const byDay = new Map(); for (const e of EVENTS) { if (!byDay.has(e.k)) byDay.set(e.k, []); byDay.get(e.k).push(e); }
  const live = k => (byDay.get(k) || []).filter(e => !e.cancelled);
  const names = evs => evs.map(e => e.m.name).join(", ");
  const Z = {
    heute: () => {
      let evs = byDay.get(key(TODAY)) || [], ans;
      if (live(key(TODAY)).length) ans = `Heute, ${fmtDate(TODAY)}, ${live(key(TODAY)).length === 1 ? "hat ein Flohmarkt" : "haben " + live(key(TODAY)).length + " Flohmärkte"} in Hamburg und im Umland geöffnet: ${names(live(key(TODAY)))}.`;
      else { const nk = [...byDay.keys()].sort().find(k => k > key(TODAY) && live(k).length); evs = nk ? byDay.get(nk) : []; ans = `Heute, ${fmtDate(TODAY)}, findet laut Kalender kein Flohmarkt in Hamburg und im Umland statt.${nk ? ` Der nächste Markttag ist ${fmtDate(evs[0].date)}: ${names(live(nk))}.` : ""}`; }
      return { h: "Flohmarkt Hamburg heute", sub: fmtDate(TODAY), t: "Flohmarkt Hamburg heute: Welche Märkte sind offen?", d: "Welche Flohmärkte haben heute in Hamburg geöffnet? Tagesaktuelle Übersicht mit Uhrzeiten und Adressen, und falls heute nichts ist, der nächste Termin.", evs, ans };
    },
    wochenende: () => {
      const { sat, sun, sunOnly } = weekendDays(), a = sunOnly ? [] : live(key(sat)), b = live(key(sun));
      const evs = (sunOnly ? [] : (byDay.get(key(sat)) || [])).concat(byDay.get(key(sun)) || []), n = a.length + b.length, c = x => x === 0 ? "keiner" : x === 1 ? "einer" : String(x);
      const ans = sunOnly
        ? `Heute, am Sonntag, ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}, ${b.length === 0 ? "findet laut Kalender kein Flohmarkt" : b.length === 1 ? "findet ein Flohmarkt" : "finden " + b.length + " Flohmärkte"} in Hamburg und im Umland statt.${b.length ? " " + names(b) + "." : ""}`
        : `Am Wochenende ${sat.getUTCDate()}. und ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]} ${n === 1 ? "findet ein Flohmarkt" : "finden " + n + " Flohmärkte"} in Hamburg und im Umland statt, ${c(a.length)} am Samstag und ${c(b.length)} am Sonntag.`;
      return { h: "Flohmarkt Hamburg am Wochenende", sub: sunOnly ? `Sonntag, ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}` : `${sat.getUTCDate()}. und ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}`, t: "Flohmarkt Hamburg am Wochenende: alle Termine", d: "Alle Flohmärkte in Hamburg am kommenden Wochenende, Samstag und Sonntag, mit Uhrzeiten, Adressen und Links zu jedem Markt. Täglich aktualisiert.", evs, ans };
    },
    sonntag: () => {
      const s0 = addDays(TODAY, (7 - TODAY.getUTCDay()) % 7), ks = [0, 7, 14, 21].map(n => key(addDays(s0, n))), first = live(ks[0]);
      return { h: "Flohmarkt Hamburg am Sonntag", sub: "ab " + fmtDate(s0), t: "Flohmarkt Hamburg Sonntag: die nächsten Termine", d: "Flohmarkt in Hamburg am Sonntag: die nächsten Sonntagstermine mit Uhrzeiten und Adressen, in der Stadt und im Umland bis 30 Kilometer.", evs: ks.flatMap(k => byDay.get(k) || []),
        ans: (first.length ? `Am ${fmtDate(s0)} ${first.length === 1 ? "findet ein Flohmarkt" : "finden " + first.length + " Flohmärkte"} in Hamburg und im Umland statt: ${names(first)}.` : "Am kommenden Sonntag steht kein Flohmarkt im Kalender.") + " In der Stadt sind es sonntags vor allem Nachbarschaftsmärkte, im Umland kommen viele Märkte auf Bau- und Supermarktparkplätzen dazu." };
    }
  };
  for (const [k, fn] of Object.entries(Z)) {
    const z = fn();
    const body = crumbs([[NAME, "/"], ["Termine", "/termine/"], [z.h.replace("Flohmarkt Hamburg ", "")]]) + `<article class="kb"><h1>${z.h}</h1><div class="byline"><span>${esc(z.sub)}</span><span>Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(z.ans)}</p></div><section class="block">${groupList(z.evs) || '<p class="meta">Keine Termine im Kalender.</p>'}</section>
<section class="related"><div class="sec-head"><h2>Weitere Zeiträume und Bezirke</h2></div>${regionChips(`/${k}/`)}</section>
<section class="related"><div class="sec-head"><h2>Vor dem Besuch lesen</h2></div>${grid(["beste-uhrzeit-flohmarkt", "was-mitnehmen-flohmarkt", "flohmarkt-knigge"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
    layout({ p: `/${k}/`, title: `${z.t} | ${NAME}`, desc: z.d, body, nav: "termine", ld: G([crumbLD([[NAME, "/"], ["Termine", "/termine/"], [z.h]])].concat(z.evs.map(eventLD))) });
  }
}

/* ---------------------------------------------------------------- Ratgeber */
{
  const body = crumbs([[NAME, "/"], ["Ratgeber"]]) + `<section class="hub-head"><h1>Flohmarkt-Ratgeber: Antworten auf die häufigsten Fragen</h1>
<p>Kaufen, verkaufen, handeln, Knigge, Steuern und Genehmigungen. Jeder Artikel beginnt mit einer kurzen Antwort, danach folgen die Details.</p>
<div class="search"><label for="kbSearch" class="kicker">Frage suchen</label><input id="kbSearch" type="search" placeholder="z. B. handeln, Steuern, Standgebühr" autocomplete="off"></div></section>
${Object.entries(CLUSTERS).map(([c, info]) => { const items = KB.filter(a => a.c === c); return items.length ? `<section class="cluster" id="${c}"><h2>${esc(info.t)}</h2><p>${esc(info.p)}</p><div class="qlist">${items.map(a => `<a href="/ratgeber/${a.s}/" data-q="${esc((a.h + " " + a.kw + " " + plain(a.a)).toLowerCase())}"><span>${esc(a.h)}</span><span aria-hidden="true">›</span></a>`).join("")}</div></section>` : ""; }).join("")}
<div class="empty" id="kbLeer" hidden>Dazu gibt es noch keinen Artikel. Versuch einen anderen Begriff, etwa „Steuern“ oder „Stand“.</div>`;
  layout({ p: "/ratgeber/", title: `Flohmarkt-Ratgeber: Die wichtigsten Fragen | ${NAME}`, desc: "Kaufen, verkaufen, handeln, Steuern, Genehmigungen: Der Ratgeber beantwortet die häufigsten Fragen rund um den Flohmarkt, kurz und verständlich.", body, nav: "ratgeber", ld: G([crumbLD([[NAME, "/"], ["Ratgeber"]]), { "@type": "CollectionPage", name: "Flohmarkt-Ratgeber", hasPart: KB.map(a => ({ "@type": "Article", headline: a.h, url: `${SITE}/ratgeber/${a.s}/` })) }]) });
}
for (const a of KB) {
  const cl = CLUSTERS[a.c] || { t: a.c };
  const words = (plain(a.a) + " " + a.b.map(x => x.join(" ")).join(" ")).split(/\s+/).length;
  const body = crumbs([[NAME, "/"], ["Ratgeber", "/ratgeber/"], [cl.t, `/ratgeber/#${a.c}`]]) + `<article class="kb"><h1>${esc(a.h)}</h1>
<div class="byline"><span>${esc(NAME)} Ratgeber</span><span>Stand: ${STAND}</span><span>${Math.max(2, Math.round(words / 200))} Min. Lesezeit</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${rich(a.a)}</p></div>
<div class="kb-body">${a.b.map(([h, p]) => `<h2>${esc(h)}</h2><p>${rich(p)}</p>`).join("")}</div>
${a.f.length ? `<section class="faq"><h2>Häufige Fragen</h2>${a.f.map(([q, x]) => `<details><summary>${esc(q)}</summary><p>${rich(x)}</p></details>`).join("")}</section>` : ""}
${a.x ? '<p class="hint">Dieser Artikel gibt einen allgemeinen Überblick und ersetzt keine Rechts- oder Steuerberatung. Im Einzelfall helfen eine Steuerberatung, eine Anwaltskanzlei oder das zuständige Amt.</p>' : ""}
<section class="related"><div class="sec-head"><h2>Das könnte dich auch interessieren</h2></div>${grid(a.r.map(kbCard))}</section></article>`;
  layout({ p: `/ratgeber/${a.s}/`, title: `${a.t} | ${NAME}`, desc: a.d, body, nav: "ratgeber", ld: G([
    { "@type": "Article", headline: a.h, description: a.d, dateModified: key(TODAY), author: { "@type": "Organization", name: NAME }, publisher: { "@type": "Organization", name: NAME }, mainEntityOfPage: `${SITE}/ratgeber/${a.s}/` },
    ...(a.f.length ? [{ "@type": "FAQPage", mainEntity: a.f.map(([q, x]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(x) } })) }] : []),
    crumbLD([[NAME, "/"], ["Ratgeber", "/ratgeber/"], [cl.t, `/ratgeber/#${a.c}`], [a.h]])]) });
}

/* ---------------------------------------------------------------- Für Veranstalter */
{
  const body = crumbs([[NAME, "/"], ["Für Veranstalter"]]) + `<article class="kb"><h1>Flohmarkt eintragen: kostenlos für Veranstalter</h1>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>Du veranstaltest einen Flohmarkt in Hamburg oder im Umland bis 30 Kilometer? Trag deine Termine kostenlos ein. Wir prüfen jeden Eintrag, bevor er erscheint, und verlinken auf deine Website.</p></div>
<div class="kb-body"><h2>So funktioniert es</h2><ul class="tips"><li>Du füllst ein kurzes Formular aus: Name des Markts, Datum, Uhrzeit, Adresse und eine E-Mail-Adresse für Rückfragen.</li><li>Wir prüfen die Angaben und veröffentlichen den Termin im Kalender, auf der Seite deines Bezirks und auf einer eigenen Seite für deinen Markt.</li><li>Regelmäßige Märkte tragen wir als Serie ein. Du musst nicht jeden Termin einzeln melden.</li><li>Ändert sich etwas oder fällt ein Termin aus, gib uns kurz Bescheid. Wir kennzeichnen den Termin dann als abgesagt.</li></ul>
<h2>Was wir veröffentlichen</h2><p>Name und Adresse des Markts, Termine, Uhrzeiten und den Namen des Veranstalters. Deine E-Mail-Adresse veröffentlichen wir nicht. Mehr dazu in den <a href="/datenschutz/">Datenschutzhinweisen</a>. Du planst einen neuen Markt? Lies vorher, <a href="/ratgeber/flohmarkt-organisieren-genehmigung/">welche Genehmigungen du in Hamburg brauchst</a>.</p></div>
<div class="org block"><h2>Termin eintragen</h2><p>Mit dem Absenden bestätigst du, dass du den Markt veranstaltest oder dazu beauftragt bist und wir die Angaben veröffentlichen dürfen.</p>${FORM ? `<a class="btn" href="${esc(FORM)}" rel="noopener">Zum Formular</a><p class="small">Das Formular wird von Google Formulare bereitgestellt.</p>` : `<p class="small">Das Formular ist bald verfügbar.</p>`}</div></article>`;
  if (!FORM) warn("Einstellungen", "Formular-Link fehlt. Auf der Seite Für Veranstalter steht so lange „bald verfügbar“.");
  layout({ p: "/veranstalter/", title: `Flohmarkt eintragen: kostenlos für Veranstalter | ${NAME}`, desc: "Veranstaltest du einen Flohmarkt in Hamburg oder im Umland? Trag deine Termine kostenlos ein. Wir prüfen jeden Eintrag und verlinken auf deine Seite.", body, nav: "org", ld: G([crumbLD([[NAME, "/"], ["Für Veranstalter"]])]) });
}

/* ---------------------------------------------------------------- Impressum und Datenschutz */
{
  const f = k => S[k] || "";
  const ph = (k, label) => f(k) ? esc(f(k)) : `<mark class="ph">${esc(label)}</mark>`;
  const need = ["Impressum: Name oder Firma", "Impressum: Straße", "Impressum: PLZ und Ort", "Impressum: E-Mail", "Impressum: Telefon", "Impressum: Verantwortlich nach § 18 MStV"];
  const missing = need.filter(k => !f(k));
  if (missing.length) warn("Impressum", `Noch nicht ausgefüllt: ${missing.map(k => k.replace("Impressum: ", "")).join(", ")}. Die Seite ist bis dahin als Vorlage markiert.`);
  const note = missing.length ? '<div class="legal-note"><b>Vorlage, noch nicht vollständig.</b> Die gelb markierten Angaben fehlen noch im Blatt Einstellungen.</div>' : "";
  const imp = crumbs([[NAME, "/"], ["Impressum"]]) + `<article class="kb"><h1>Impressum</h1>${note}<div class="kb-body legal">
<h2>Angaben gemäß § 5 DDG</h2><p>${ph("Impressum: Name oder Firma", "Name oder Firma mit Rechtsform")}<br>${ph("Impressum: Straße", "Straße und Hausnummer")}<br>${ph("Impressum: PLZ und Ort", "PLZ und Ort")}</p>
${f("Impressum: Vertreten durch") ? `<p>Vertreten durch: ${esc(f("Impressum: Vertreten durch"))}</p>` : ""}
<h2>Kontakt</h2><p>E-Mail: ${ph("Impressum: E-Mail", "E-Mail-Adresse")}<br>Telefon: ${ph("Impressum: Telefon", "Telefonnummer")}</p>
${f("Impressum: Register") || f("Impressum: USt-IdNr.") ? `<h2>Register und Umsatzsteuer</h2><p>${esc(f("Impressum: Register"))}${f("Impressum: Register") && f("Impressum: USt-IdNr.") ? "<br>" : ""}${f("Impressum: USt-IdNr.") ? "USt-IdNr.: " + esc(f("Impressum: USt-IdNr.")) : ""}</p>` : ""}
<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2><p>${ph("Impressum: Verantwortlich nach § 18 MStV", "Name und Anschrift der verantwortlichen Person")}</p>
<h2>Verbraucherstreitbeilegung</h2><p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
<h2>Hinweis zu Termindaten</h2><p>Alle Termine beruhen auf öffentlichen Angaben der jeweiligen Veranstalter. Wir prüfen sie sorgfältig, können aber nicht garantieren, dass ein Markt wie angegeben stattfindet. Maßgeblich sind die Angaben des Veranstalters.</p></div></article>`;
  layout({ p: "/impressum/", title: `Impressum | ${NAME}`, desc: `Impressum von ${NAME}.`, body: imp, noindex: true });
  const dsMissing = ["Datenschutz: Hoster", "Datenschutz: Löschfrist Logdateien (Tage)", "Datenschutz: Löschfrist Formular", "Datenschutz: Stand"].filter(k => !f(k));
  if (dsMissing.length) warn("Datenschutz", `Noch nicht ausgefüllt: ${dsMissing.map(k => k.replace("Datenschutz: ", "")).join(", ")}.`);
  const ds = crumbs([[NAME, "/"], ["Datenschutz"]]) + `<article class="kb"><h1>Datenschutzerklärung</h1>${missing.length || dsMissing.length ? '<div class="legal-note"><b>Vorlage, noch nicht vollständig.</b> Gelb markierte Angaben im Blatt Einstellungen ergänzen und die Erklärung vor dem Livegang fachlich prüfen lassen.</div>' : ""}<div class="kb-body legal">
<h2>1. Verantwortlicher</h2><p>Verantwortlich für die Datenverarbeitung auf dieser Website ist ${ph("Impressum: Name oder Firma", "Name oder Firma")}, erreichbar über die Angaben im <a href="/impressum/">Impressum</a>.</p>
<h2>2. Hosting und Server-Logdateien</h2><p>Die Website wird bei ${ph("Datenschutz: Hoster", "Name und Sitz des Hosters")} betrieben. Beim Aufruf speichert der Server automatisch technische Daten wie IP-Adresse, Datum und Uhrzeit, aufgerufene Seite und Browser. Das ist nötig, um die Website sicher auszuliefern (Art. 6 Abs. 1 lit. f DSGVO). Die Daten werden nach ${ph("Datenschutz: Löschfrist Logdateien (Tage)", "Anzahl")} Tagen gelöscht, soweit der Hoster sie nicht länger zur Abwehr von Angriffen benötigt.</p>
<h2>3. Schriftarten</h2><p>Die Website lädt keine Schriftarten von fremden Servern. Beim Aufruf wird keine Verbindung zu Google oder anderen Schriftanbietern aufgebaut.</p>
<h2>4. Cookies und Reichweitenmessung</h2><p>Diese Website setzt keine Cookies und nutzt keine Analyse- oder Werbedienste.</p>
<h2>5. Termine eintragen</h2><p>Veranstalter können Termine über ein Formular von Google Formulare (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland) einreichen. Das Formular öffnet sich erst, wenn du den Link anklickst. Dabei gelten zusätzlich die Datenschutzbestimmungen von Google. Wir verarbeiten die Angaben zum Markt und deine E-Mail-Adresse. Die Marktdaten veröffentlichen wir nach Prüfung. Die E-Mail-Adresse nutzen wir nur für Rückfragen zu deinem Eintrag und veröffentlichen sie nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und f DSGVO. Wir löschen die E-Mail-Adresse ${ph("Datenschutz: Löschfrist Formular", "Frist, z. B. zwölf Monate nach dem letzten Termin")}.</p>
<h2>6. Kontakt per E-Mail</h2><p>Schreibst du uns eine E-Mail, verarbeiten wir deine Angaben, um die Anfrage zu beantworten (Art. 6 Abs. 1 lit. b oder f DSGVO), und löschen sie, wenn sie nicht mehr benötigt werden.</p>
<h2>7. Links zu anderen Websites</h2><p>Links wie „Route planen“ führen zu Google Maps oder zu Websites der Veranstalter. Erst wenn du einen solchen Link anklickst, werden Daten an den jeweiligen Anbieter übertragen.</p>
<h2>8. Deine Rechte</h2><p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel beim Hamburgischen Beauftragten für Datenschutz und Informationsfreiheit.</p>
<p>Stand: ${ph("Datenschutz: Stand", "Datum")}</p></div></article>`;
  layout({ p: "/datenschutz/", title: `Datenschutz | ${NAME}`, desc: `Datenschutzerklärung von ${NAME}.`, body: ds, noindex: true });
}

/* ---------------------------------------------------------------- 404 */
layout({ p: "/404.html", title: `Seite nicht gefunden | ${NAME}`, desc: "Diese Seite gibt es nicht.", noindex: true, body: `<section class="hub-head"><h1>Diese Seite gibt es nicht</h1><p>Vielleicht wurde ein Markt umbenannt oder ein Artikel verschoben. Hier geht es weiter:</p>${regionChips()}<p><a class="btn" href="/">Zur Startseite</a></p></section>` });

/* ---------------------------------------------------------------- SEO-Prüfung und Links */
const existing = new Set([...pages.keys()]);
for (const [p, pg] of pages) {
  if (!pg.noindex && p !== "/404.html") {
    const tl = pg.title.replace(` | ${NAME}`, "").length, dl = pg.desc.length;
    if (tl > 60) warn("SEO", `${p}: Titel hat ${tl} Zeichen (Ziel höchstens 60).`);
    if (dl < 110 || dl > 160) warn("SEO", `${p}: Beschreibung hat ${dl} Zeichen (Ziel 120 bis 155).`);
  }
  for (const m of pg.html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) {
    const target = m[1];
    if (target.startsWith("/assets/") || target.startsWith("/fonts/")) continue;
    if (!existing.has(target)) warn("Links", `${p} verlinkt auf ${target}, diese Seite gibt es nicht.`);
  }
}

/* ---------------------------------------------------------------- Schreiben */
fs.rmSync(OUT, { recursive: true, force: true });
const withBase = t => BASE ? t.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`).replace(/url\("\/fonts\//g, `url("${BASE}/fonts/`) : t;
for (const [p, pg] of pages) {
  const file = p.endsWith("/") ? path.join(OUT, p, "index.html") : path.join(OUT, p);
  if (!path.resolve(file).startsWith(path.resolve(OUT) + path.sep)) throw new Error(`Ungültiger Seitenpfad „${p}“. Es wurde nichts außerhalb des Ausgabeordners geschrieben.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, withBase(pg.html));
}
fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
fs.writeFileSync(path.join(OUT, "assets/style.css"), withBase(fontCSS) + "\n" + fs.readFileSync(path.join(ROOT, "src/style.css"), "utf8"));
fs.copyFileSync(path.join(ROOT, "src/site.js"), path.join(OUT, "assets/site.js"));
fs.copyFileSync(path.join(ROOT, "src/icon.svg"), path.join(OUT, "assets/icon.svg"));
if (fontsFound.length) { fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true }); for (const x of fontsFound) fs.copyFileSync(path.join(fontDir, x.f), path.join(OUT, "fonts", x.f)); }
const indexable = [...pages].filter(([p, pg]) => !pg.noindex && p !== "/404.html").map(([p]) => p);
fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map(p => `  <url><loc>${esc(SITE + p)}</loc><lastmod>${key(TODAY)}</lastmod></url>`).join("\n")}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT, "robots.txt"), PUBLIC ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n");
if (!PUBLIC) warn("Google", "Die Website ist noch nicht für Google freigegeben (Einstellung „Für Google freigeben“ = Nein). Das ist richtig, solange ihr testet.");
if (process.env.CNAME) fs.writeFileSync(path.join(OUT, "CNAME"), process.env.CNAME + "\n");

/* ---------------------------------------------------------------- Bericht */
const evCount = [...pages.values()].reduce((n, pg) => n + (pg.html.match(/"@type":"Event"/g) || []).length, 0);
const summary = [`# ${NAME}: Website gebaut`, "", `Stand ${STAND} · ${pages.size} Seiten (${PUBLIC ? indexable.length + " für Google" : "noch nicht für Google freigegeben"}) · ${MARKETS.length} Märkte · ${EVENTS.length} Termine in den nächsten ${HORIZON} Tagen · ${KB.length} Ratgeber-Artikel · ${evCount} Event-Auszeichnungen`, ""];
if (warnings.length) {
  summary.push(`## ${warnings.length} Hinweise zum Prüfen`, "", "| Bereich | Hinweis |", "|---|---|");
  for (const [b, t] of warnings) summary.push(`| ${b} | ${t.replace(/\|/g, "/")} |`);
} else summary.push("Keine Hinweise. Alles in Ordnung.");
const report = summary.join("\n") + "\n";
fs.writeFileSync(path.join(ROOT, "bericht.md"), report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
