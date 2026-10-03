// Flohlotse – Website-Generator
// Liest die Redaktionstabelle (Google Sheets oder lokale CSV-Dateien) und baut die komplette Website in den Ordner dist/.
// Keine Abhängigkeiten, läuft mit Node 18 oder neuer:  node build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash as hashOf } from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "dist");
// Versionskürzel für Stil und Skript: Ändert sich die Datei, ändert sich die Adresse, und Browser laden sofort die neue Fassung statt der gespeicherten.
const ver = f => { try { return "?v=" + hashOf("sha1").update(fs.readFileSync(path.join(ROOT, f))).digest("hex").slice(0, 8); } catch { return ""; } };
const CSS_V = ver("src/style.css"), JS_V = ver("src/site.js");
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
  // Nimmt die reine ID oder den ganzen Tabellen-Link; Leerzeichen und Zeilenumbrüche beim Kopieren werden ignoriert
  const rawId = (process.env.SHEET_ID || "").replace(/\s+/g, "");
  const id = (rawId.match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || rawId;
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
// Uhrzeit als "08:30"; unsichere Zeiten als Rahmen "14:00/15:00" (geschrieben 14/15, 14-15 oder 14 oder 15)
function parseTime(v, ctx) {
  v = String(v || "").trim().replace(/\s*uhr$/i, ""); if (!v) return "";
  const range = v.split(/\s*(?:\/|–|-|oder|bis)\s*/i);
  if (range.length === 2) {
    const a = parseTime(range[0], ctx), b = parseTime(range[1], ctx);
    if (!a || !b) return a || b;
    if (b <= a) { warn("Uhrzeit", `„${v}“ (${ctx}): Die zweite Uhrzeit muss später sein als die erste. Es wird nur ${a.replace(/^0/, "")} verwendet.`); return a; }
    return a + "/" + b;
  }
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?$/.exec(v);
  if (!m || +m[1] > 24 || +(m[2] || 0) > 59 || (+m[1] === 24 && +(m[2] || 0) > 0)) { warn("Uhrzeit", `„${v}“ ist keine gültige Uhrzeit (${ctx}). Bitte als 08:30 eintragen.`); return ""; }
  return pad(+m[1]) + ":" + (m[2] || "00");
}
const key = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const fmtDate = d => `${WDL[d.getUTCDay()]}, ${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`;
const fmtShort = d => `${WD[d.getUTCDay()]} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.`;
const hmText = t => t.split("/").map(x => x.replace(/^0(\d)/, "$1").replace(/:00$/, "")).join("/");
const tFirst = t => t.split("/")[0], tLast = t => t.split("/").pop();
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
  if (start && end && tFirst(end) <= tLast(start)) { warn("Uhrzeit", `${ctx}: Ende ${end} liegt nicht nach Beginn ${start}. Das Ende wurde ignoriert, bitte prüfen.`); return ""; }
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
// Instagram-Profil: Einstellung „Instagram“ (Adresse des Profils). Ohne Eintrag gilt das Flohlotse-Profil, mit „Nein“ entfällt der Link.
const INSTA_RAW = String(S["Instagram"] ?? "https://www.instagram.com/flohlotse/").trim();
const INSTA = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]+\/?$/.test(INSTA_RAW) ? INSTA_RAW.replace(/\/?$/, "/") : "";
const INSTA_AT = INSTA ? "@" + INSTA.split("/").filter(Boolean).pop() : "";
const instaA = label => `<a href="${INSTA}" rel="noopener me">${label}</a>`;
const REGION = S["Region"] || "Hamburg + 30 km";
const horizonRaw = parseInt(S["Tage im Voraus"], 10) || 120;
const HORIZON = Math.min(400, Math.max(14, horizonRaw));
if (horizonRaw !== HORIZON) warn("Einstellungen", `„Tage im Voraus“ = ${horizonRaw} liegt außerhalb von 14 bis 400. Es werden ${HORIZON} Tage verwendet.`);
const FORM_LINK = safeHref(S["Formular-Link"], "Einstellungen, Formular-Link");
// Ohne eigenes Formular reichen Veranstalter Termine per E-Mail an die Impressum-Adresse ein
const IMP_MAIL = (S["Impressum: E-Mail"] || "").trim();
const FORM = FORM_LINK || (/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(IMP_MAIL) ? `mailto:${IMP_MAIL}?subject=${encodeURIComponent("Flohmarkt eintragen")}` : "");
const FORM_MAIL = /^mailto:/i.test(FORM);
const IMP_NEED = ["Impressum: Name oder Firma", "Impressum: Straße", "Impressum: PLZ und Ort", "Impressum: E-Mail", "Impressum: Telefon"];
const IMP_OK = IMP_NEED.every(k => S[k]);
const PUBLIC = yes(S["Für Google freigeben"]) && IMP_OK;
if (yes(S["Für Google freigeben"]) && !IMP_OK) warn("Google", "„Für Google freigeben“ steht auf Ja, aber das Impressum ist noch nicht vollständig. Die Website bleibt für Google gesperrt, bis alle Pflichtangaben im Blatt Einstellungen stehen.");
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
  kw: r["Suchbegriff"], t: r["SEO-Titel"], d: r["SEO-Beschreibung"], kb: list(r["Ratgeber-Artikel"]), events: [],
  geo: r["Koordinaten"] || "",
  web: /^https?:\/\/[^\s"<>]+$/i.test(String(r["Veranstalter-Website"] || "").trim()) ? String(r["Veranstalter-Website"]).trim() : ""
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
  const d = parseDate(r["Datum"], m.name); if (!d || d < TODAY) continue;
  // Termine jenseits der Vorschau („Tage im Voraus“) stehen nicht im Kalender, aber auf der Marktseite als nächster bekannter Termin.
  if (d > END) { if (!/abgesagt|fällt aus|entfällt/i.test(r["Status"] || "")) (m.later = m.later || []).push({ date: d, start: parseTime(r["Beginn"], m.name) || "", end: parseTime(r["Ende"], m.name) || "" }); continue; }
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
for (const m of MARKETS) if (m.later) m.later.sort((a, b) => a.date - b.date);
const fmtDateY = d => `${fmtDate(d)} ${d.getUTCFullYear()}`;
for (const m of MARKETS) if (!m.events.length && !m.later) warn("Keine Termine", `${m.name} hat in den nächsten ${HORIZON} Tagen keinen Termin.`);

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
const OFL_TEXT = "This Font Software is licensed under the SIL Open Font License, Version 1.1.\nThis license is copied below, and is also available with a FAQ at:\nhttps://openfontlicense.org\n\n\n-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n-----------------------------------------------------------\n\nPREAMBLE\nThe goals of the Open Font License (OFL) are to stimulate worldwide\ndevelopment of collaborative font projects, to support the font creation\nefforts of academic and linguistic communities, and to provide a free and\nopen framework in which fonts may be shared and improved in partnership\nwith others.\n\nThe OFL allows the licensed fonts to be used, studied, modified and\nredistributed freely as long as they are not sold by themselves. The\nfonts, including any derivative works, can be bundled, embedded, \nredistributed and/or sold with any software provided that any reserved\nnames are not used by derivative works. The fonts and derivatives,\nhowever, cannot be released under any other type of license. The\nrequirement for fonts to remain under this license does not apply\nto any document created using the fonts or their derivatives.\n\nDEFINITIONS\n\"Font Software\" refers to the set of files released by the Copyright\nHolder(s) under this license and clearly marked as such. This may\ninclude source files, build scripts and documentation.\n\n\"Reserved Font Name\" refers to any names specified as such after the\ncopyright statement(s).\n\n\"Original Version\" refers to the collection of Font Software components as\ndistributed by the Copyright Holder(s).\n\n\"Modified Version\" refers to any derivative made by adding to, deleting,\nor substituting -- in part or in whole -- any of the components of the\nOriginal Version, by changing formats or by porting the Font Software to a\nnew environment.\n\n\"Author\" refers to any designer, engineer, programmer, technical\nwriter or other person who contributed to the Font Software.\n\nPERMISSION & CONDITIONS\nPermission is hereby granted, free of charge, to any person obtaining\na copy of the Font Software, to use, study, copy, merge, embed, modify,\nredistribute, and sell modified and unmodified copies of the Font\nSoftware, subject to the following conditions:\n\n1) Neither the Font Software nor any of its individual components,\nin Original or Modified Versions, may be sold by itself.\n\n2) Original or Modified Versions of the Font Software may be bundled,\nredistributed and/or sold with any software, provided that each copy\ncontains the above copyright notice and this license. These can be\nincluded either as stand-alone text files, human-readable headers or\nin the appropriate machine-readable metadata fields within text or\nbinary files as long as those fields can be easily viewed by the user.\n\n3) No Modified Version of the Font Software may use the Reserved Font\nName(s) unless explicit written permission is granted by the corresponding\nCopyright Holder. This restriction only applies to the primary font name as\npresented to the users.\n\n4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font\nSoftware shall not be used to promote, endorse or advertise any\nModified Version, except to acknowledge the contribution(s) of the\nCopyright Holder(s) and the Author(s) or with their explicit written\npermission.\n\n5) The Font Software, modified or unmodified, in part or in whole,\nmust be distributed entirely under this license, and must not be\ndistributed under any other license. The requirement for fonts to\nremain under this license does not apply to any document created\nusing the Font Software.\n\nTERMINATION\nThis license becomes null and void if any of the above conditions are\nnot met.\n\nDISCLAIMER\nTHE FONT SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT\nOF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE\nCOPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nINCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL\nDAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM\nOTHER DEALINGS IN THE FONT SOFTWARE.";
const FONT_RULES = [[/bricolage.*\.(woff2|ttf)$/i, "Bricolage Grotesque", "200 800"], [/figtree.*variable.*\.(woff2|ttf)$|^figtree\.(woff2|ttf)$/i, "Figtree", "300 900"]];
const fontDir = path.join(ROOT, "fonts");
const fontFilesAll = fs.existsSync(fontDir) ? fs.readdirSync(fontDir) : [];
// Kursive Varianten nie nehmen; bei mehreren Treffern woff2 und variable Schriften bevorzugen
const fontScore = x => (x.endsWith("woff2") ? 2 : 0) + (/variable/i.test(x) ? 1 : 0);
const fontsFound = FONT_RULES.map(([re, fam, w]) => { const f = fontFilesAll.filter(x => re.test(x) && !/italic/i.test(x)).sort((a, b) => fontScore(b) - fontScore(a) || a.localeCompare(b))[0]; return f && { f, fam, w }; }).filter(Boolean);
const FONT_PRELOAD = fontsFound.filter(x => x.f.endsWith("woff2")).map(x => `<link rel="preload" href="/fonts/${encodeURIComponent(x.f)}" as="font" type="font/woff2" crossorigin>`).join("");
const fontCSS = fontsFound.map(x => `@font-face{font-family:"${x.fam}";src:url("/fonts/${encodeURIComponent(x.f)}") format("${x.f.endsWith("woff2") ? "woff2" : "truetype"}");font-weight:${x.w};font-style:normal;font-display:swap}`).join("\n");
if (fontsFound.length < 2) warn("Schriften", `Im Ordner fonts fehlen ${2 - fontsFound.length} von 2 Schriftdateien. Die Seite nutzt so lange Systemschriften.`);

/* ---------------------------------------------------------------- Symbolbilder */
// Bilder liegen im Ordner bilder. Endet der Name auf -ki (z. B. start-1-ki.webp), ist es ein KI-Bild
// und wird als „KI-generiert“ gekennzeichnet. Fehlt ein Bild, wird die Stelle einfach ohne Bild gebaut.
const imgDir = path.join(ROOT, "bilder");
const IMGS = new Set(fs.existsSync(imgDir) ? fs.readdirSync(imgDir).filter(x => /^[a-z0-9-]+\.(webp|jpg)$/.test(x)) : []);
// Ein echtes Foto (start-1.webp) hat Vorrang vor dem KI-Bild (start-1-ki.webp).
const pickImg = (base, ext = "webp") => IMGS.has(`${base}.${ext}`) ? { f: `${base}.${ext}`, ki: false } : IMGS.has(`${base}-ki.${ext}`) ? { f: `${base}-ki.${ext}`, ki: true } : null;
// Bildnachweis je Foto: bilder/nachweis.json (Quelle mit Pflichttext und Link, Bildbeschreibung, Urheber).
const CREDITS = (() => { try { return JSON.parse(fs.readFileSync(path.join(imgDir, "nachweis.json"), "utf8")); } catch { return {}; } })();
const CRED_SRC = CREDITS.quelle && /^https:\/\//.test(CREDITS.quelle.url || "") && CREDITS.quelle.text ? CREDITS.quelle : null;
const credOf = f => (CREDITS.bilder || {})[f] || (CREDITS.bilder || {})[String(f).replace(/(-klein)?\.(webp|jpg)$/, "")] || null;
const credLink = () => `<a href="${esc(CRED_SRC.url)}" rel="noopener nofollow">${esc(CRED_SRC.text)}</a>`;
// Dateiname auf der Website: sprechender Name aus nachweis.json (gut für die Google-Bildersuche), sonst der Dateiname aus dem Ordner.
const imgOut = f => { const c = credOf(f), m = /^(.*?)(-klein)?\.(webp|jpg)$/.exec(f); return c && /^[a-z0-9-]+$/.test(c.name || "") ? `${c.name}${m[2] || ""}.${m[3]}` : f; };
const imgUrl = f => `/assets/img/${imgOut(f)}`;
const IMG_BY_URL = Object.fromEntries([...IMGS].map(f => [imgUrl(f), f]));
const OG = pickImg("teilen", "jpg");
const OG_IMG = OG ? imgUrl(OG.f) : "";
const REAL_PHOTOS = [...IMGS].filter(x => !/-ki\.(webp|jpg)$/.test(x) && !/-klein\./.test(x) && !(CRED_SRC && credOf(x)));
if (REAL_PHOTOS.length && !S["Bildnachweis"]) warn("Bilder", `Für ${REAL_PHOTOS.length === 1 ? "das Foto" : "die Fotos"} ${REAL_PHOTOS.join(", ")} fehlt der Bildnachweis. Quelle und Lizenz im Blatt Einstellungen unter „Bildnachweis“ eintragen, z. B. „Fotos: Unsplash (Unsplash-Lizenz)“, und einen Screenshot der Lizenzseite aufbewahren.`);
const ANY_KI = [...IMGS].some(x => /-ki\.(webp|jpg)$/.test(x));
const altOf = x => (!x.ki && credOf(x.f) && credOf(x.f).alt) || altFor(x.ki);
// Kleines Foto neben dem Text: hoch (4:5) oder quer (4:3). Der Nachweis steht darunter.
// Formen (form): "" hochkant, "quer", "rund", "kante", "links" – auch kombiniert. So sieht nicht jede Seite gleich aus.
const sideImg = (base, form = "") => { const x = pickImg(base), quer = /quer/.test(form); return x ? `<figure class="side-photo${form ? " " + form : ""}"><img src="${imgUrl(x.f)}" width="${quer ? 800 : 480}" height="600" alt="${esc(altOf(x))}" loading="lazy" decoding="async"><figcaption>${capOf(x)}</figcaption></figure>` : ""; };
const capOf = x => x.ki ? labelFor(true) : CRED_SRC && credOf(x.f) ? `Symbolfoto · ${credLink()}` : labelFor(false);
const altFor = ki => ki ? "KI-generiertes Symbolbild: Flohmarkt in einer Stadt" : "Symbolfoto: Stöbern an Flohmarktständen";
const labelFor = ki => ki ? "Symbolbild, KI-generiert" : "Symbolfoto";
const clusterImg = (c, cls = "kb-photo", lazy = false, base = `ratgeber-${c}`) => {
  const big = pickImg(base), small = pickImg(`${base}-klein`);
  if (!big && !small) return "";
  const ki = (big || small).ki, s1 = (small || big).f, x = big || small;
  const set = [small && `${imgUrl(small.f)} 760w`, big && `${imgUrl(big.f)} 1520w`].filter(Boolean).join(", ");
  return `<figure class="${cls}"><img src="${imgUrl(s1)}" srcset="${set}" sizes="(max-width: 800px) 100vw, 760px" width="760" height="333" alt="${esc(altOf(x))}"${lazy ? ' loading="lazy"' : ""} decoding="async"><figcaption>${capOf(x)}</figcaption></figure>`;
};

/* ---------------------------------------------------------------- Seitenrahmen */
const pages = new Map();
/* ---------------------------------------------------------------- Icons
   Phosphor Icons, Stil „Light“ (feine Outlines), https://phosphoricons.com
   MIT License, Copyright (c) 2023 Phosphor Icons. Der Lizenztext (ICON_LICENSE) wird als /assets/icons-lizenz.txt veröffentlicht.
   Einmal pro Seite als Sprite, Einsatz mit ic("name"). */
const ICONS = {
  pin: "<path d=\"M128,66a38,38,0,1,0,38,38A38,38,0,0,0,128,66Zm0,64a26,26,0,1,1,26-26A26,26,0,0,1,128,130Zm0-112a86.1,86.1,0,0,0-86,86c0,30.91,14.34,63.74,41.47,94.94a252.32,252.32,0,0,0,41.09,38,6,6,0,0,0,6.88,0,252.32,252.32,0,0,0,41.09-38c27.13-31.2,41.47-64,41.47-94.94A86.1,86.1,0,0,0,128,18Zm0,206.51C113,212.93,54,163.62,54,104a74,74,0,0,1,148,0C202,163.62,143,212.93,128,224.51Z\"/>",
  clock: "<path d=\"M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218Zm62-90a6,6,0,0,1-6,6H128a6,6,0,0,1-6-6V72a6,6,0,0,1,12,0v50h50A6,6,0,0,1,190,128Z\"/>",
  cal: "<path d=\"M208,34H182V24a6,6,0,0,0-12,0V34H86V24a6,6,0,0,0-12,0V34H48A14,14,0,0,0,34,48V208a14,14,0,0,0,14,14H208a14,14,0,0,0,14-14V48A14,14,0,0,0,208,34ZM48,46H74V56a6,6,0,0,0,12,0V46h84V56a6,6,0,0,0,12,0V46h26a2,2,0,0,1,2,2V82H46V48A2,2,0,0,1,48,46ZM208,210H48a2,2,0,0,1-2-2V94H210V208A2,2,0,0,1,208,210Z\"/>",
  repeat: "<path d=\"M26,128A70.08,70.08,0,0,1,96,58H209.51L195.76,44.24a6,6,0,0,1,8.48-8.48l24,24a6,6,0,0,1,0,8.48l-24,24a6,6,0,0,1-8.48-8.48L209.51,70H96a58.07,58.07,0,0,0-58,58,6,6,0,0,1-12,0Zm198-6a6,6,0,0,0-6,6,58.07,58.07,0,0,1-58,58H46.49l13.75-13.76a6,6,0,0,0-8.48-8.48l-24,24a6,6,0,0,0,0,8.48l24,24a6,6,0,0,0,8.48-8.48L46.49,198H160a70.08,70.08,0,0,0,70-70A6,6,0,0,0,224,122Z\"/>",
  route: "<path d=\"M236.65,108.1,60.72,42.83l-.13,0A14,14,0,0,0,42.78,60.59s0,.09,0,.13L108.1,236.65A13.77,13.77,0,0,0,121.28,246h.26a13.8,13.8,0,0,0,13.14-9.88l0-.15,22.14-79.1L236,134.73l.15,0a14,14,0,0,0,.53-26.58Zm-4,15.1-82.26,23a6,6,0,0,0-4.16,4.16l-23,82.26a1.85,1.85,0,0,1-1.86,1.36,1.82,1.82,0,0,1-1.92-1.35.61.61,0,0,0,0-.12L54.11,56.62a2,2,0,0,1,2.51-2.51l175.91,65.26.12,0a2,2,0,0,1,0,3.79Z\"/>",
  tram: "<path d=\"M184,50H134V22h34a6,6,0,0,0,0-12H88a6,6,0,0,0,0,12h34V50H72A30,30,0,0,0,42,80V184a30,30,0,0,0,30,30H84L67.2,236.4a6,6,0,1,0,9.6,7.2L99,214h58l22.2,29.6a6,6,0,0,0,9.6-7.2L172,214h12a30,30,0,0,0,30-30V80A30,30,0,0,0,184,50ZM72,62H184a18,18,0,0,1,18,18v42H54V80A18,18,0,0,1,72,62ZM184,202H72a18,18,0,0,1-18-18V134H202v50A18,18,0,0,1,184,202ZM94,172a10,10,0,1,1-10-10A10,10,0,0,1,94,172Zm88,0a10,10,0,1,1-10-10A10,10,0,0,1,182,172Z\"/>",
  user: "<path d=\"M229.19,213c-15.81-27.32-40.63-46.49-69.47-54.62a70,70,0,1,0-63.44,0C67.44,166.5,42.62,185.67,26.81,213a6,6,0,1,0,10.38,6C56.4,185.81,90.34,166,128,166s71.6,19.81,90.81,53a6,6,0,1,0,10.38-6ZM70,96a58,58,0,1,1,58,58A58.07,58.07,0,0,1,70,96Z\"/>",
  chev: "<path d=\"M180.24,132.24l-80,80a6,6,0,0,1-8.48-8.48L167.51,128,91.76,52.24a6,6,0,0,1,8.48-8.48l80,80A6,6,0,0,1,180.24,132.24Z\"/>",
  book: "<path d=\"M232,50H160a38,38,0,0,0-32,17.55A38,38,0,0,0,96,50H24a6,6,0,0,0-6,6V200a6,6,0,0,0,6,6H96a26,26,0,0,1,26,26,6,6,0,0,0,12,0,26,26,0,0,1,26-26h72a6,6,0,0,0,6-6V56A6,6,0,0,0,232,50ZM96,194H30V62H96a26,26,0,0,1,26,26V204.31A37.86,37.86,0,0,0,96,194Zm130,0H160a37.87,37.87,0,0,0-26,10.32V88a26,26,0,0,1,26-26h66Z\"/>",
  map: "<path d=\"M227.69,51.27a6,6,0,0,0-5.15-1.09L160.7,65.64l-62-31a6,6,0,0,0-4.14-.45l-64,16A6,6,0,0,0,26,56V200a6,6,0,0,0,7.46,5.82L95.3,190.36l62,31a6,6,0,0,0,4.14.45l64-16A6,6,0,0,0,230,200V56A6,6,0,0,0,227.69,51.27ZM102,49.71l52,26V206.29l-52-26Zm-64,11,52-13V179.32l-52,13ZM218,195.32l-52,13V76.68l52-13Z\"/>",
  sun: "<path d=\"M122,40V16a6,6,0,0,1,12,0V40a6,6,0,0,1-12,0Zm68,88a62,62,0,1,1-62-62A62.07,62.07,0,0,1,190,128Zm-12,0a50,50,0,1,0-50,50A50.06,50.06,0,0,0,178,128ZM59.76,68.24a6,6,0,1,0,8.48-8.48l-16-16a6,6,0,0,0-8.48,8.48Zm0,119.52-16,16a6,6,0,1,0,8.48,8.48l16-16a6,6,0,1,0-8.48-8.48ZM192,70a6,6,0,0,0,4.24-1.76l16-16a6,6,0,0,0-8.48-8.48l-16,16A6,6,0,0,0,192,70Zm4.24,117.76a6,6,0,0,0-8.48,8.48l16,16a6,6,0,0,0,8.48-8.48ZM46,128a6,6,0,0,0-6-6H16a6,6,0,0,0,0,12H40A6,6,0,0,0,46,128Zm82,82a6,6,0,0,0-6,6v24a6,6,0,0,0,12,0V216A6,6,0,0,0,128,210Zm112-88H216a6,6,0,0,0,0,12h24a6,6,0,0,0,0-12Z\"/>",
  update: "<path d=\"M222,48V96a6,6,0,0,1-6,6H168a6,6,0,0,1,0-12h33.52L183.47,72a81.51,81.51,0,0,0-57.53-24h-.46A81.5,81.5,0,0,0,68.19,71.28a6,6,0,1,1-8.38-8.58,93.38,93.38,0,0,1,65.67-26.76H126a93.45,93.45,0,0,1,66,27.53l18,18V48a6,6,0,0,1,12,0ZM187.81,184.72a81.5,81.5,0,0,1-57.29,23.34h-.46a81.51,81.51,0,0,1-57.53-24L54.48,166H88a6,6,0,0,0,0-12H40a6,6,0,0,0-6,6v48a6,6,0,0,0,12,0V174.48l18,18.05a93.45,93.45,0,0,0,66,27.53h.52a93.38,93.38,0,0,0,65.67-26.76,6,6,0,1,0-8.38-8.58Z\"/>",
  mail: "<path d=\"M224,50H32a6,6,0,0,0-6,6V192a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A6,6,0,0,0,224,50ZM208.58,62,128,135.86,47.42,62ZM216,194H40a2,2,0,0,1-2-2V69.64l86,78.78a6,6,0,0,0,8.1,0L218,69.64V192A2,2,0,0,1,216,194Z\"/>",
  tag: "<path d=\"M241.91,137.42,142.59,38.1a13.94,13.94,0,0,0-9.9-4.1H40a6,6,0,0,0-6,6v92.69a13.94,13.94,0,0,0,4.1,9.9l99.32,99.32a14,14,0,0,0,19.8,0l84.69-84.69A14,14,0,0,0,241.91,137.42Zm-8.49,11.31-84.69,84.69a2,2,0,0,1-2.83,0L46.59,134.1a2,2,0,0,1-.59-1.41V46h86.69a2,2,0,0,1,1.41.59l99.32,99.31A2,2,0,0,1,233.42,148.73ZM94,84A10,10,0,1,1,84,74,10,10,0,0,1,94,84Z\"/>",
  star: "<path d=\"M237.28,97.87A14.18,14.18,0,0,0,224.76,88l-60.25-4.87-23.22-56.2a14.37,14.37,0,0,0-26.58,0L91.49,83.11,31.24,88a14.18,14.18,0,0,0-12.52,9.89A14.43,14.43,0,0,0,23,113.32L69,152.93l-14,59.25a14.4,14.4,0,0,0,5.59,15,14.1,14.1,0,0,0,15.91.6L128,196.12l51.58,31.71a14.1,14.1,0,0,0,15.91-.6,14.4,14.4,0,0,0,5.59-15l-14-59.25L233,113.32A14.43,14.43,0,0,0,237.28,97.87Zm-12.14,6.37-48.69,42a6,6,0,0,0-1.92,5.92l14.88,62.79a2.35,2.35,0,0,1-.95,2.57,2.24,2.24,0,0,1-2.6.1L131.14,184a6,6,0,0,0-6.28,0L70.14,217.61a2.24,2.24,0,0,1-2.6-.1,2.35,2.35,0,0,1-1-2.57l14.88-62.79a6,6,0,0,0-1.92-5.92l-48.69-42a2.37,2.37,0,0,1-.73-2.65,2.28,2.28,0,0,1,2.07-1.65l63.92-5.16a6,6,0,0,0,5.06-3.69l24.63-59.6a2.35,2.35,0,0,1,4.38,0l24.63,59.6a6,6,0,0,0,5.06,3.69l63.92,5.16a2.28,2.28,0,0,1,2.07,1.65A2.37,2.37,0,0,1,225.14,104.24Z\"/>",
  moon: "<path d=\"M232.13,143.64a6,6,0,0,0-6-1.49A90.07,90.07,0,0,1,113.86,29.85a6,6,0,0,0-7.49-7.48A102.88,102.88,0,0,0,54.48,58.68,102,102,0,0,0,197.32,201.52a102.88,102.88,0,0,0,36.31-51.89A6,6,0,0,0,232.13,143.64Zm-42,48.29a90,90,0,0,1-126-126A90.9,90.9,0,0,1,99.65,37.66,102.06,102.06,0,0,0,218.34,156.35,90.9,90.9,0,0,1,190.1,191.93Z\"/>",
  home: "<path d=\"M217.9,110.1l-80-80a14,14,0,0,0-19.8,0l-80,80A13.92,13.92,0,0,0,34,120v96a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V158h36v58a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V120A13.92,13.92,0,0,0,217.9,110.1ZM210,210H158V152a6,6,0,0,0-6-6H104a6,6,0,0,0-6,6v58H46V120a2,2,0,0,1,.58-1.42l80-80a2,2,0,0,1,2.84,0l80,80A2,2,0,0,1,210,120Z\"/>",
  disc: "<path d=\"M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218Zm0-148a58.07,58.07,0,0,0-58,58,6,6,0,0,1-12,0,70.08,70.08,0,0,1,70-70,6,6,0,0,1,0,12Zm70,58a70.08,70.08,0,0,1-70,70,6,6,0,0,1,0-12,58.07,58.07,0,0,0,58-58,6,6,0,0,1,12,0Zm-40,0a30,30,0,1,0-30,30A30,30,0,0,0,158,128Zm-48,0a18,18,0,1,1,18,18A18,18,0,0,1,110,128Z\"/>",
  smile: "<path d=\"M219.21,160.24a6,6,0,0,0-5.78-.35,22,22,0,1,1-11.05-41.83,22.15,22.15,0,0,1,11.05,2.06A6,6,0,0,0,222,114.7V72a14,14,0,0,0-14-14H169.48a35,35,0,0,0,.52-6,34.1,34.1,0,0,0-10.73-24.78,33.64,33.64,0,0,0-25.45-9.15A34,34,0,0,0,102.54,58H64A14,14,0,0,0,50,72v34.53a34,34,0,0,0-30.79,10.2,34,34,0,0,0,22.31,57.18,34.34,34.34,0,0,0,8.48-.44V208a14,14,0,0,0,14,14H208a14,14,0,0,0,14-14V165.31A6,6,0,0,0,219.21,160.24ZM210,208a2,2,0,0,1-2,2H64a2,2,0,0,1-2-2V165.31a6,6,0,0,0-6-6,5.92,5.92,0,0,0-2.57.58,22,22,0,0,1-31.38-18.46,22,22,0,0,1,31.38-21.31A6,6,0,0,0,62,114.7V72a2,2,0,0,1,2-2h46.69a6,6,0,0,0,5.42-8.57,22.25,22.25,0,0,1-2-11,22,22,0,1,1,41.83,11A6,6,0,0,0,161.3,70H208a2,2,0,0,1,2,2v34.54a34,34,0,0,0-39.93,31.28,33.71,33.71,0,0,0,9.14,25.45A34.15,34.15,0,0,0,210,173.48Z\"/>",
  umbrella: "<path d=\"M238,126.79A110.43,110.43,0,0,0,53.11,55.22a109.51,109.51,0,0,0-35.06,71.57A14,14,0,0,0,32,142h90v58a30,30,0,0,0,60,0,6,6,0,0,0-12,0,18,18,0,0,1-36,0V142h90a14,14,0,0,0,14-15.21ZM94.11,130C95.8,78.79,118.81,49.84,128,40.27c9.2,9.58,32.2,38.53,33.89,89.73Zm-63.57-.65a2,2,0,0,1-.53-1.56,98.14,98.14,0,0,1,82.91-88.62c-12,15-29.43,44.44-30.83,90.83H32A2,2,0,0,1,30.54,129.35Zm194.92,0A2,2,0,0,1,224,130H173.91c-1.4-46.39-18.81-75.87-30.83-90.83A98.14,98.14,0,0,1,226,127.79,2,2,0,0,1,225.46,129.35Z\"/>",
  tree: "<path d=\"M196.55,64.09a74,74,0,0,0-137.1,0A69.71,69.71,0,0,0,18,127.8C17.9,164.91,49.13,197,86.19,198A70.32,70.32,0,0,0,122,189.16V232a6,6,0,0,0,12,0V189.16A70.1,70.1,0,0,0,168,198l1.77,0C206.87,197,238.1,164.9,238,127.8A69.71,69.71,0,0,0,196.55,64.09ZM169.5,186A57.88,57.88,0,0,1,134,175V131.71l44.68-22.34a6,6,0,1,0-5.36-10.74L134,118.29V88a6,6,0,0,0-12,0v54.29L82.68,122.63a6,6,0,0,0-5.36,10.74L122,155.71V175a58.09,58.09,0,0,1-35.5,11c-30.71-.77-56.58-27.4-56.5-58.14A57.78,57.78,0,0,1,66.37,74.19a6,6,0,0,0,3.39-3.51,62,62,0,0,1,116.48,0,6,6,0,0,0,3.39,3.51A57.77,57.77,0,0,1,226,127.83C226.08,158.58,200.21,185.2,169.5,186Z\"/>",
  bike: "<path d=\"M208,114a45.88,45.88,0,0,0-17.8,3.58L162.45,70H192a10,10,0,0,1,10,10,6,6,0,0,0,12,0,22,22,0,0,0-22-22H152a6,6,0,0,0-5.18,9l13.4,23H98.11L81.18,61A6,6,0,0,0,76,58H48a6,6,0,0,0,0,12H72.55l15,25.64L70,119.62a46.22,46.22,0,1,0,9.68,7.09L94.11,107,126.82,163a6,6,0,0,0,5.19,3,5.91,5.91,0,0,0,3-.82,6,6,0,0,0,2.16-8.2l-32.07-55h62.11l12.63,21.66A46,46,0,1,0,208,114ZM82,160a34,34,0,1,1-19.13-30.57l-19.72,27a6,6,0,0,0,9.7,7.08l19.7-27A33.88,33.88,0,0,1,82,160Zm126,34a34,34,0,0,1-22-59.86L202.82,163a6,6,0,0,0,5.19,3,5.91,5.91,0,0,0,3-.82,6,6,0,0,0,2.16-8.2l-16.86-28.91A34,34,0,1,1,208,194Z\"/>",
  list: "<path d=\"M222,128a6,6,0,0,1-6,6H40a6,6,0,0,1,0-12H216A6,6,0,0,1,222,128ZM40,70H216a6,6,0,0,0,0-12H40a6,6,0,0,0,0,12ZM216,186H40a6,6,0,0,0,0,12H216a6,6,0,0,0,0-12Z\"/>",
  printer: "<path d=\"M214.67,74H198V40a6,6,0,0,0-6-6H64a6,6,0,0,0-6,6V74H41.33C28.47,74,18,83.87,18,96v80a6,6,0,0,0,6,6H58v34a6,6,0,0,0,6,6H192a6,6,0,0,0,6-6V182h34a6,6,0,0,0,6-6V96C238,83.87,227.53,74,214.67,74ZM70,46H186V74H70ZM186,210H70V158H186Zm40-40H198V152a6,6,0,0,0-6-6H64a6,6,0,0,0-6,6v18H30V96c0-5.51,5.08-10,11.33-10H214.67C220.92,86,226,90.49,226,96Zm-28-54a10,10,0,1,1-10-10A10,10,0,0,1,198,116Z\"/>",
  scissors: "<path d=\"M159.38,112a6,6,0,0,1,1.57-8.34l67.66-46.31a6,6,0,0,1,6.78,9.91l-67.67,46.3a6,6,0,0,1-8.34-1.56ZM237,197.09a6,6,0,0,1-8.34,1.56L136,135.27,91,166.06A34,34,0,1,1,84,156a1.8,1.8,0,0,0,.19.2L125.37,128,84.23,99.84,84,100a34,34,0,1,1,7-10.1l144.38,98.8A6,6,0,0,1,237,197.09ZM75.56,91.55a22,22,0,1,0-31.12,0,21.88,21.88,0,0,0,31.12,0ZM82,180a22,22,0,1,0-6.44,15.56h0A21.88,21.88,0,0,0,82,180Z\"/>",
  rain: "<path d=\"M157,195.33l-32,48a6,6,0,1,1-10-6.66l32-48a6,6,0,0,1,10,6.66ZM230,92a74.09,74.09,0,0,1-74,74H131.21L101,211.33a6,6,0,1,1-10-6.66L116.79,166H76A50,50,0,1,1,86.2,67,74.08,74.08,0,0,1,230,92Zm-12,0A62.06,62.06,0,0,0,94,88.35a6,6,0,0,1-12-.7,75.84,75.84,0,0,1,1.07-9A38,38,0,1,0,76,154h80A62.07,62.07,0,0,0,218,92Z\"/>",
  cloudsun: "<path d=\"M164,74a74.15,74.15,0,0,0-21.18,3.09,54.08,54.08,0,0,0-11.14-13.61l10.52-15a6,6,0,1,0-9.83-6.89l-10.52,15A53.9,53.9,0,0,0,96,50c-1.15,0-2.28,0-3.41.12L89.4,32.05a6,6,0,1,0-11.81,2.09L80.77,52.2A54,54,0,0,0,55.52,68.32L40.47,57.78a6,6,0,0,0-6.89,9.83l15,10.52A53.7,53.7,0,0,0,42,104c0,1.13,0,2.26.12,3.39l-18.07,3.18a6,6,0,0,0,1,11.91,6.38,6.38,0,0,0,1.05-.09L44.2,119.2a53.51,53.51,0,0,0,7.08,15A50,50,0,0,0,84,222h80a74,74,0,0,0,0-148ZM54,104a42,42,0,0,1,77.48-22.49A74.29,74.29,0,0,0,94.2,123,50.36,50.36,0,0,0,84,122a49.65,49.65,0,0,0-22.79,5.52A42,42,0,0,1,54,104ZM164,210H84a38,38,0,1,1,7.08-75.34,75.84,75.84,0,0,0-1.07,9,6,6,0,0,0,12,.7,61.54,61.54,0,0,1,2-12.24c0-.15.08-.29.11-.43A62.06,62.06,0,1,1,164,210Z\"/>",
  cloud: "<path d=\"M160,42A86.11,86.11,0,0,0,82.43,90.88,62,62,0,1,0,72,214h88a86,86,0,0,0,0-172Zm0,160H72a50,50,0,0,1,0-100,50.67,50.67,0,0,1,5.91.35A85.61,85.61,0,0,0,74,128a6,6,0,0,0,12,0,74,74,0,1,1,74,74Z\"/>",
  share: "<path d=\"M176,162a37.91,37.91,0,0,0-28.3,12.67L98.8,143.24a37.89,37.89,0,0,0,0-30.48l48.9-31.43a38,38,0,1,0-6.5-10.09L92.3,102.67a38,38,0,1,0,0,50.66l48.9,31.43A38,38,0,1,0,176,162Zm0-132a26,26,0,1,1-26,26A26,26,0,0,1,176,30ZM64,154a26,26,0,1,1,26-26A26,26,0,0,1,64,154Zm112,72a26,26,0,1,1,26-26A26,26,0,0,1,176,226Z\"/>",
  sunrise: "<path d=\"M240,154H197.28a70.91,70.91,0,0,0,.72-10,70,70,0,0,0-140,0,70.91,70.91,0,0,0,.72,10H16a6,6,0,0,0,0,12H240a6,6,0,0,0,0-12ZM70,144a58,58,0,1,1,115.13,10H70.87A58.63,58.63,0,0,1,70,144Zm144,56a6,6,0,0,1-6,6H48a6,6,0,0,1,0-12H208A6,6,0,0,1,214,200ZM74.63,42.69a6,6,0,0,1,10.74-5.37l8,16a6,6,0,0,1-10.74,5.36Zm-56,50.63a6,6,0,0,1,8.05-2.69l16,8a6,6,0,0,1-5.36,10.74l-16-8A6,6,0,0,1,18.63,93.32Zm192,13.36a6,6,0,0,1,2.69-8.05l16-8a6,6,0,1,1,5.36,10.74l-16,8a6,6,0,0,1-8.05-2.69Zm-48-53.36,8-16a6,6,0,0,1,10.74,5.37l-8,16a6,6,0,1,1-10.74-5.36Z\"/>",
  bed: "<path d=\"M216,74H30V48a6,6,0,0,0-12,0V208a6,6,0,0,0,12,0V174H242v34a6,6,0,0,0,12,0V112A38,38,0,0,0,216,74ZM30,86h76v76H30Zm88,76V86h98a26,26,0,0,1,26,26v50Z\"/>",
  frog: "<path d=\"M368 32c41.7 0 75.9 31.8 79.7 72.5l85.6 26.3c25.4 7.8 42.8 31.3 42.8 57.9 0 21.8-11.7 41.9-30.7 52.7l-144.5 82.1 92.5 92.5h50.7c17.7 0 32 14.3 32 32s-14.3 32-32 32h-64c-8.5 0-16.6-3.4-22.6-9.4L346.9 360.2c11.7-36 3.2-77.1-25.4-105.7-40.6-40.6-106.3-40.6-146.9-.1l-73.6 70c-6.4 6.1-6.7 16.2-.6 22.6s16.2 6.6 22.6.6l73.8-70.2.1-.1.1-.1c3.5-3.5 7.3-6.6 11.3-9.2 27.9-18.5 65.9-15.4 90.5 9.2 24.7 24.7 27.7 62.9 9 90.9-2.6 3.8-5.6 7.5-9 10.9l-37 37H352c17.7 0 32 14.3 32 32s-14.3 32-32 32H64c-35.3 0-64-28.7-64-64C0 249.6 127 112.9 289.3 97.5 296.2 60.2 328.8 32 368 32m0 104a24 24 0 1 0 0-48 24 24 0 1 0 0 48\"/>",
};
const ICON_LICENSE = "Frosch-Icon (Wetterfrosch): Font Awesome Free 7.1.0 by @fontawesome, https://fontawesome.com\nLizenz: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ , Copyright 2025 Fonticons, Inc. Unverändert übernommen.\n\nAlle anderen Icons: Phosphor Icons (https://phosphoricons.com), Stil Light\n\nMIT License\n\nCopyright (c) 2023 Phosphor Icons\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n";
const ICON_VB = { frog: "0 0 576 512" };
const SPRITE_FILE = `<!-- Icons: Phosphor Icons, MIT License, (c) 2023 Phosphor Icons; Frosch: Font Awesome Free, CC BY 4.0, (c) Fonticons, Inc.; siehe /assets/icons-lizenz.txt --><svg xmlns="http://www.w3.org/2000/svg"><defs>${Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="${ICON_VB[k] || "0 0 256 256"}" fill="currentColor">${v}</symbol>`).join("")}</defs></svg>`;
const ic = (n, cls = "i") => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="/assets/icons.svg#i-${ICONS[n] ? n : "tag"}"/></svg>`;
// Icons für die Marktarten aus der Tabelle; unbekannte Arten bekommen das Etikett-Icon
const TAG_ICON = { "Frühaufsteher": "sunrise", "Langschläfer": "bed", "Groß & bekannt": "star", "Abends": "moon", "Nachbarschaft": "home", "Sammler & Vinyl": "disc", "Kinder & Spielzeug": "smile", "Überdacht": "umbrella", "Umland": "tree", "Fahrräder": "bike" };
const tagIc = t => ic(TAG_ICON[t] || "tag");
// Logischer Umbruch nach dem Doppelpunkt („Handeln auf dem Flohmarkt:“ / „So feilschst du fair“)
const brColon = h => h.replace(/^(.{3,70}?): (.+)$/, '$1:<span class="br"> $2</span>');
// Adresse: Hausnummer bleibt bei der Straße, PLZ beim Ort. Umbrochen wird nach dem Komma.
const addrNb = a => esc(a).replace(/ (\d+\s?[a-zA-Z]?(?:[-–]\d+[a-zA-Z]?)?)(?=,|$)/g, "&nbsp;$1").replace(/(\d{5}) /g, "$1&nbsp;");
const more = (href, label, aria) => `<a class="more-link" href="${href}"${aria ? ` aria-label="${esc(aria)}"` : ""}>${label}${ic("chev")}</a>`;
const TAGS_ALL = [...new Set(MARKETS.flatMap(m => m.tags))];
// Zwei Filter entstehen automatisch aus der Uhrzeit: Beginn bis 7 Uhr = Frühaufsteher, Beginn von 10 bis 15 Uhr = Langschläfer
const timeTags = e => { if (e.cancelled || !e.start) return []; const h = parseInt(String(e.start).match(/\d{1,2}/)[0], 10); return h <= 7 ? ["Frühaufsteher"] : h >= 10 && h <= 15 ? ["Langschläfer"] : []; };
const TIME_TAGS = ["Frühaufsteher", "Langschläfer"];
function menuHTML() {
  const cnt = k => MARKETS.filter(m => m.bez === k).length;
  const li = (h, l) => `<li><a href="${h}">${l}</a></li>`;
  return `<details class="menu-wrap"><summary class="menu-btn">${ic("list")}<span>Menü</span></summary>
<div class="menu"><nav class="menu-grid" aria-label="Alle Bereiche">
<div><p class="menu-h">Flohmärkte finden</p><ul>${li("/heute/", "Heute")}${li("/morgen/", "Morgen")}${li("/wochenende/", "Am Wochenende")}${li("/samstag/", "Am Samstag")}${li("/sonntag/", "Am Sonntag")}${li("/termine/", "Alle Termine")}${li("/flohmaerkte/", "Alle Märkte")}</ul></div>
<div><p class="menu-h">Nach Art</p><ul>${CATS_ON.map(c => li(`/${c.s}/`, esc(c.chip))).join("")}</ul></div>
<div><p class="menu-h">Hamburg</p><ul>${REGIONS.filter(r => !r.umland).map(r => li(`/flohmarkt-hamburg/${r.k}/`, `${esc(r.name)} <small>${cnt(r.k)}</small>`)).join("")}</ul></div>
<div><p class="menu-h">Umland bis 30 km</p><ul>${REGIONS.filter(r => r.umland).map(r => li(`/flohmarkt-hamburg/${r.k}/`, `${esc(r.name)} <small>${cnt(r.k)}</small>`)).join("")}</ul></div>
<div><p class="menu-h">Ratgeber</p><ul>${li("/flohmarkt-schilder/", "Schilder &amp; Preisschilder drucken")}${Object.entries(CLUSTERS).map(([c, v]) => li(`/ratgeber/#${c}`, esc(v.t))).join("")}${li("/ratgeber/", "Alle Artikel")}</ul></div>
<div><p class="menu-h">${esc(NAME)}</p><ul>${li("/veranstalter/", "Für Veranstalter")}${INSTA ? `<li>${instaA("Instagram")}</li>` : ""}${li("/impressum/", "Impressum")}${li("/datenschutz/", "Datenschutz")}</ul></div>
</nav></div></details>`;
}
const MENU = () => menuHTML();
// Fotos einer Seite: Angaben für Google (Urheber, Lizenz) und Einträge für die Bild-Sitemap. Die große Fassung zählt.
const PAGE_PHOTOS = new Map();
function imgLD(p, body) {
  const fs_ = [...new Set([...body.matchAll(/(?:src|srcset)="([^"]*\/assets\/img\/[^"]+)"/g)].flatMap(m => m[1].split(",").map(x => x.trim().split(" ")[0])))]
    .map(u => IMG_BY_URL[u]).filter(f => f && CRED_SRC && credOf(f) && !/-klein\./.test(f));
  if (!fs_.length) return "";
  PAGE_PHOTOS.set(p, fs_.map(f => imgUrl(f)));
  const ldImg = fs_.map(f => { const c = credOf(f); return { "@context": "https://schema.org", "@type": "ImageObject", contentUrl: SITE + imgUrl(f), caption: String(c.alt || "").replace(/^Symbolfoto: /, ""), creditText: `${c.autor || CRED_SRC.name} / ${CRED_SRC.name}`, creator: { "@type": "Organization", name: c.autor || CRED_SRC.name }, copyrightNotice: `${c.autor || CRED_SRC.name} / ${CRED_SRC.name}`, ...(CRED_SRC.lizenz ? { license: CRED_SRC.lizenz, acquireLicensePage: CRED_SRC.url } : {}) }; });
  return `<script type="application/ld+json">${JSON.stringify(ldImg).replace(/</g, "\\u003c")}</script>`;
}
function layout({ p, title, desc, body, ld, noindex, nav, extraHead = "", img = OG_IMG }) {
  const url = SITE + p;
  // Google zeigt rund 60 Zeichen. Ist der Titel länger, fällt der angehängte Markenname weg (Google ergänzt den Seitennamen selbst).
  if (title.length > 60 && title.endsWith(` | ${NAME}`)) title = title.slice(0, -(` | ${NAME}`).length);
  const navItems = [["/termine/", "Termine", "termine"], ["/flohmaerkte/", "Märkte", "maerkte"], ["/ratgeber/", "Ratgeber", "ratgeber"], ["/flohmarkt-schilder/", "Schilder", "schilder"], ["/veranstalter/", "Für Veranstalter", "org"]];
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${noindex || !PUBLIC ? "noindex,follow" : "index,follow"}">
<link rel="canonical" href="${esc(url)}">
${FONT_PRELOAD}
<meta property="og:type" content="website"><meta property="og:locale" content="de_DE"><meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">${img ? `\n<meta property="og:image" content="${esc(SITE + img)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="stylesheet" href="/assets/style.css${CSS_V}">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}${imgLD(p, body)}${extraHead}
</head>
<body>
<a class="skip" href="#inhalt">Zum Inhalt springen</a>
<header class="top"><div class="wrap">
<a class="brand" href="/"><i>€</i>${esc(NAME)}</a>
<nav class="nav" aria-label="Hauptmenü">${navItems.map(([h, l, k]) => `<a href="${h}"${k === nav ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
${MENU()}
</div></header>
<main class="wrap" id="inhalt">
${body.replace(/<h1>([^<]{3,80}?): ([^<]+)<\/h1>/, '<h1>$1:<span class="h1-sub"> $2</span></h1>')}
</main>
<footer class="wrap site-foot">
<div>Termine nach öffentlichen Angaben der Veranstalter, Stand ${STAND}. Bitte vor dem Besuch beim Veranstalter prüfen, Märkte können kurzfristig ausfallen. Ratgeber-Artikel ersetzen keine Rechts- oder Steuerberatung.${WX_OK ? ` Wettervorhersage: Deutscher Wetterdienst, Stand ${STAND}.` : ""}</div>
<nav class="foot-links" aria-label="Flohmarkt Hamburg"><b>Flohmarkt Hamburg</b><a href="/heute/">Heute</a><a href="/morgen/">Morgen</a><a href="/wochenende/">Wochenende</a><a href="/samstag/">Samstag</a><a href="/sonntag/">Sonntag</a>${REGIONS.map(r => `<a href="/flohmarkt-hamburg/${r.k}/">${esc(r.name)}</a>`).join("")}</nav>
<nav class="foot-links" aria-label="Nach Art und Monat"><b>Nach Art und Monat</b>${CATS_ON.map(c => `<a href="/${c.s}/">${esc(c.chip)}</a>`).join("")}${MONTHS.map(x => `<a href="/${x.s}/">${x.name} ${x.y}</a>`).join("")}</nav>
<nav class="foot-links" aria-label="${esc(NAME)}"><b>${esc(NAME)}</b><a href="/ratgeber/">Ratgeber</a><a href="/flohmarkt-schilder/">Schilder-Designer</a><a href="/flohmarkt-hamburg-statistik/">Flohmärkte in Zahlen</a><a href="/veranstalter/">Für Veranstalter</a>${INSTA ? instaA("Instagram") : ""}<a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a></nav>
</footer>
<script src="/assets/site.js${JS_V}" defer></script>
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
    startDate: e.start ? `${e.k}T${tFirst(e.start)}:00${berlinOff(e.date)}` : e.k,
    eventStatus: e.cancelled ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", description: m.note || m.name,
    location: { "@type": "Place", name: m.place, address: { "@type": "PostalAddress", streetAddress: parts[0], addressLocality: pm ? pm[2] : (parts.length > 1 ? parts[parts.length - 1] : (m.area || "Hamburg")), addressCountry: "DE", ...(pm ? { postalCode: pm[1] } : {}) } }
  };
  if (e.start && e.end) ev.endDate = `${e.k}T${tLast(e.end)}:00${berlinOff(e.date)}`;
  if (m.org) ev.organizer = { "@type": "Organization", name: m.org, ...(m.web ? { url: m.web } : {}) };
  return ev;
}
function evHTML(e, h = 3) {
  const m = e.m, q = encodeURIComponent(m.name + ", " + m.addr);
  const hm = x => x.includes("/") ? hmText(x) : x;
  // Handy: gelbe Zeile „08:00 bis 16:00“ über dem Namen. Ab Tablet: der runde Zeit-Sticker links.
  const t = ic("clock") + (e.cancelled ? '<span class="t-lab">Termin</span><span class="t-main">fällt aus</span>' : !e.start ? '<span class="t-lab">Uhrzeit</span><span class="t-main">folgt</span>' : e.end ? `<span class="t-a">${hm(e.start)}</span><span class="t-bis">bis</span><span class="t-b">${hm(e.end)}</span>` : `<span class="t-lab">ab</span><span class="t-main">${hm(e.start)}</span>`);
  return `<article class="ev${e.cancelled ? " off" : ""}" data-tags="${esc([...m.tags, ...timeTags(e)].join("|"))}"${llAttr(m)}${!e.cancelled && e.start ? ` data-s="${tFirst(e.start)}"${e.end ? ` data-e="${tLast(e.end)}"` : ""}` : ""}><div class="time" aria-label="${esc(e.cancelled ? "Abgesagt" : timeText(e))}">${t}</div><div class="ev-body">
<h${h}><a href="/flohmarkt/${m.slug}/">${esc(m.name)}</a></h${h}><p class="meta ln">${ic("pin")}<span><b>${esc(m.area)}</b> · ${addrNb(m.addr)}</span></p>
${e.cancelled ? `<p class="note warn-text">Dieser Termin fällt aus.${e.note ? " " + esc(e.note) : ""}</p>` : m.note ? `<p class="note">${esc(m.note)}${e.note ? " " + esc(e.note) : ""}</p>` : ""}
${m.tags.length ? `<div class="row">${m.tags.map(t => CAT_BY_TAG[t] ? `<a class="tag" href="/${CAT_BY_TAG[t].s}/">${tagIc(t)}${esc(t)}</a>` : `<span class="tag">${tagIc(t)}${esc(t)}</span>`).join("")}</div>` : ""}
<div class="row foot"><span class="rhythm ln">${ic("repeat")}<span>${esc(m.rhythm)}</span></span><span class="acts"><a class="route go" href="/flohmarkt/${m.slug}/" aria-label="Zum Markt: ${esc(m.name)}">Zum Markt${ic("chev")}</a>${e.cancelled ? "" : shareBtn(m, e)}<a class="route" href="https://www.google.com/maps/search/?api=1&amp;query=${q}" rel="noopener" aria-label="Route zu ${esc(m.name)} planen">${ic("route")}Route</a></span></div>
${m.org ? `<p class="meta small ln">${ic("user")}<span>Veranstalter: ${esc(m.org)}</span></p>` : ""}</div></article>`;
}
// lvl = Überschriftenebene der Tage (2 direkt unter der H1, 3 innerhalb eines H2-Abschnitts)
function groupList(evs, lvl = 2) {
  const g = new Map(); for (const e of evs) { if (!g.has(e.k)) g.set(e.k, []); g.get(e.k).push(e); }
  return [...g].map(([k, list]) => `<div class="group" data-day="${k}"><h${lvl} class="group-h">${ic("cal")}${fmtDate(list[0].date)}${HOLI[k] ? ` <span class="hol">${HOLI[k]}</span>` : ""}${wxChip(wxDay(list))}</h${lvl}><div class="list">${list.map(e => evHTML(e, lvl + 1)).join("")}</div></div>`).join("");
}
const kbCard = s => { const r = KBY[s]; if (!r) { warn("Ratgeber", `Verweis auf unbekannten Artikel „${s}“`); return ""; } return `<a class="card" href="/ratgeber/${r.s}/"><span class="kicker">Ratgeber · ${esc(CLUSTERS[r.c]?.t || "")}</span><h3>${brColon(esc(r.h))}</h3><p>${esc(short(plain(r.a), 110))}</p></a>`; };
function short(t, n) { t = String(t || ""); if (t.length <= n) return t; const cut = t.slice(0, n); return (cut.lastIndexOf(" ") > n * 0.6 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,.;:–-]+$/, "") + " …"; }
const mCard = m => { const n = m.events.find(e => !e.cancelled); return `<a class="card" href="/flohmarkt/${m.slug}/"><span class="kicker">${esc(m.area)}</span><h3>${esc(m.name)}</h3><p class="ln">${ic("repeat")}<span>${esc(m.rhythm)}</span></p>${n ? `<p class="ln">${ic("cal")}<span>Nächster Termin ${fmtShort(n.date)}</span></p>` : ""}</a>`; };
const grid = cards => { cards = cards.filter(Boolean); const n = cards.length; return `<div class="news ${n % 3 === 0 ? "cols3" : n % 2 === 0 ? "cols2" : "fit"}">${cards.join("")}</div>`; };
const regionChips = skip => `<div class="chips">${[["/heute/", "Heute"], ["/morgen/", "Morgen"], ["/wochenende/", "Wochenende"], ["/samstag/", "Samstag"], ["/sonntag/", "Sonntag"]].filter(x => x[0] !== skip).map(([h, l]) => `<a class="chip" href="${h}">${ic(h === "/heute/" ? "sun" : "cal")}${l}</a>`).join("")}${REGIONS.filter(r => `/flohmarkt-hamburg/${r.k}/` !== skip).map(r => `<a class="chip" href="/flohmarkt-hamburg/${r.k}/">${esc(r.name)}</a>`).join("")}</div>`;
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

/* ---------------------------------------------------------------- SEO-Bausteine
   Seiten nach Art des Markts, Monatsseiten, Feiertage und Hilfen für Titel und Beschreibungen.
   Alles wird aus den Daten berechnet, damit Titel, Beschreibungen und Listen immer stimmen. */
const YEAR = TODAY.getUTCFullYear();
// Jahr(e) einer Terminliste für Titel: „2026“ oder „2026/27“
const yearSpan = evs => { const ys = [...new Set(evs.map(e => e.date.getUTCFullYear()))].sort(); return !ys.length ? String(YEAR) : ys.length === 1 ? String(ys[0]) : `${ys[0]}/${String(ys[ys.length - 1]).slice(2)}`; };
const dDate = d => `${WD[d.getUTCDay()]}., ${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`;
const nextOf = evs => evs.find(e => !e.cancelled);
// Kurze, bekannte Namen zuerst (für knappe Beschreibungen)
const topNames = (evs, n = 2) => listNames([...new Set(evs.map(e => e.m))].sort((a, b) => (b.tags.includes("Groß & bekannt") - a.tags.includes("Groß & bekannt")) || a.short.length - b.short.length).map(m => m.short), n);
const darunter = evs => new Set(evs.map(e => e.m)).size === 1 ? `: ${topNames(evs, 1)}` : `, darunter ${topNames(evs)}`;
const listMore = (arr, n) => arr.length > n ? arr.slice(0, n).join(", ") + " und weitere" : listNames(arr, n);
const listNames = (arr, n = 3) => { const a = [...new Set(arr)].slice(0, n); return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " und " + a[a.length - 1]; };
// Erste Beschreibung, die in die ideale Länge passt (Google zeigt etwa 120 bis 155 Zeichen)
const pickDesc = (...c) => { c = c.filter(Boolean).map(x => x.replace(/\s+/g, " ").trim()); return c.find(x => x.length >= 115 && x.length <= 158) || c.find(x => x.length <= 158) || c[0]; };
// Beschreibungen aus dem Sheet mit festem Datum veralten, die ersetzen wir durch berechnete
const STALE = new RegExp(`\\b(${MON.join("|")})\\b|\\b\\d{1,2}\\.\\d{1,2}\\.`, "i");
const fresh = t => t && !STALE.test(t) ? t : "";

// Gesetzliche Feiertage in Hamburg (für Hinweise an den Tagen und auf den Monatsseiten)
const HOLI = {};
for (let y = YEAR - 1; y <= YEAR + 2; y++) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  const fix = (mo, da, n) => { HOLI[key(new Date(Date.UTC(y, mo - 1, da)))] = n; };
  fix(1, 1, "Neujahr"); fix(5, 1, "Tag der Arbeit"); fix(10, 3, "Tag der Deutschen Einheit"); fix(10, 31, "Reformationstag"); fix(12, 25, "1. Weihnachtstag"); fix(12, 26, "2. Weihnachtstag");
  [[-2, "Karfreitag"], [1, "Ostermontag"], [39, "Christi Himmelfahrt"], [50, "Pfingstmontag"]].forEach(([o, n]) => { HOLI[key(addDays(easter, o))] = n; });
}

// Seiten nach Art des Markts. Eine Seite entsteht nur, wenn mindestens zwei Märkte dazugehören.
const kbL = (s, t) => KBY[s] ? `[${t}](/ratgeber/${s}/)` : t;
const CATS = [
  { s: "hallenflohmarkt-hamburg", tag: "Überdacht", icon: "umbrella", chip: "Hallen & überdacht", pl: "Hallenflohmärkte und überdachte Flohmärkte",
    h1: "Hallenflohmarkt Hamburg: überdachte Flohmärkte und Indoor-Märkte", t: Y => `Hallenflohmarkt Hamburg ${Y}: überdacht & indoor`,
    lead: "Drinnen oder überdacht stöbern: Diese Flohmärkte in Hamburg und Umgebung finden in Hallen, Parkhäusern, Einkaufszentren oder unter Dach statt, also auch bei Regen und im Winter.",
    b: () => [["Stöbern bei jedem Wetter", `Hallen, Parkdecks und Gemeindesäle machen den Flohmarkt wetterfest. Gerade von November bis März sind überdachte Märkte die sichere Wahl, wenn draußen Schietwetter ist. Wie du dich auf einen Markt bei Regen einstellst, steht im Ratgeber ${kbL("flohmarkt-bei-regen", "Flohmarkt bei Regen")}.`],
      ["Parkhaus, Halle oder Einkaufszentrum", "Überdacht heißt nicht immer drinnen: Auf Parkdecks ist es oft zugig und kühler als in einer Halle, eine warme Jacke schadet also nicht. In Einkaufszentren und Gemeindehäusern ist es dagegen angenehm warm."]],
    f: [["Was ist ein Hallenflohmarkt?", "Ein Flohmarkt, der drinnen stattfindet, zum Beispiel in einer Sporthalle, einem Gemeindesaal oder einem Einkaufszentrum. Er findet auch bei Regen statt."],
      ["Gibt es überdachte Flohmärkte auch im Winter?", "Hallen- und Parkhausmärkte finden häufig auch im Winter statt. Welche Märkte gerade Termine haben, siehst du oben in der Liste."]],
    kb: ["flohmarkt-bei-regen", "was-mitnehmen-flohmarkt", "beste-uhrzeit-flohmarkt"] },
  { s: "nachtflohmarkt-hamburg", tag: "Abends", icon: "moon", chip: "Nachtflohmärkte", pl: "Nachtflohmärkte",
    h1: "Nachtflohmarkt Hamburg: alle Termine am Abend", t: Y => `Nachtflohmarkt Hamburg ${Y}: alle Termine`,
    lead: "Stöbern nach Feierabend: Diese Flohmärkte in Hamburg und Umgebung öffnen erst am Abend.",
    b: () => [["Was einen Nachtflohmarkt ausmacht", "Statt früh am Morgen geht es erst am späten Nachmittag oder Abend los. Das passt gut nach der Arbeit. Eine kleine Taschenlampe oder das Handylicht hilft beim Prüfen von Kratzern und Kleingedrucktem."],
      ["Tipps für den Abend", `Nimm genug Bargeld in kleinen Scheinen mit und frag vorher, ob auch per App gezahlt werden kann. Mehr dazu im Ratgeber ${kbL("nachtflohmarkt", "Nachtflohmarkt: Stöbern nach Feierabend")}.`]],
    f: [["Wann öffnen Nachtflohmärkte?", "Meist am späten Nachmittag oder frühen Abend. Die genauen Uhrzeiten stehen bei jedem Termin in der Liste oben."]],
    kb: ["nachtflohmarkt", "bezahlen-auf-dem-flohmarkt", "handeln-auf-dem-flohmarkt"] },
  { s: "kinderflohmarkt-hamburg", tag: "Kinder & Spielzeug", icon: "smile", chip: "Kinderflohmärkte", pl: "Kinderflohmärkte und Kinderbasare",
    h1: "Kinderflohmarkt Hamburg: Termine für Kleidung und Spielzeug", t: Y => `Kinderflohmarkt Hamburg ${Y}: alle Termine`,
    lead: "Kinderkleidung, Spielzeug und Babysachen aus zweiter Hand: Hier stehen alle Kinderflohmärkte und Basare in Hamburg und Umgebung mit Terminen.",
    b: () => [["Gut einkaufen für Familien", "Kinder wachsen schnell aus Kleidung und Spielzeug heraus. Auf Kinderflohmärkten bekommst du gut erhaltene Sachen für wenig Geld. Früh da sein lohnt sich, die beste Auswahl gibt es meist in der ersten Stunde."],
      ["Selbst verkaufen", `Viele Kinderflohmärkte vergeben Stände nur mit Anmeldung, manche sind Nummernmärkte, bei denen ein Team die Ware verkauft. Tipps fürs Verkaufen stehen im Ratgeber ${kbL("kinderflohmarkt-verkaufen", "Auf dem Kinderflohmarkt verkaufen")}, passende [Preisschilder](/flohmarkt-schilder/preisschilder/) druckst du kostenlos bei uns.`]],
    f: [["Was ist ein Nummernmarkt?", "Bei einem Nummernmarkt gibst du deine Sachen mit Preisetiketten ab, ein Team sortiert und verkauft sie. Den Erlös bekommst du danach, meist abzüglich eines kleinen Anteils für die Organisation."]],
    kb: ["flohmarkt-mit-kindern", "kinderflohmarkt-verkaufen", "handeln-auf-dem-flohmarkt"] },
  { s: "antikmarkt-hamburg", tag: "Sammler & Vinyl", icon: "disc", chip: "Antik & Sammler", pl: "Antik-, Trödel- und Sammlermärkte",
    h1: "Antik-, Sammler- und Plattenmärkte in Hamburg", t: Y => `Antikmarkt & Schallplattenbörse Hamburg: Termine ${Y}`,
    lead: "Schallplatten, Uhren, Spielzeug und Antiquitäten: Hier stehen alle Antik- und Trödelmärkte sowie Sammlerbörsen in Hamburg und Umgebung mit Terminen.",
    b: () => [["Für Sammler", `Auf Börsen und Antikmärkten sind mehr Händler unterwegs als auf dem klassischen Flohmarkt, die Preise sind dafür oft fester. Wie du Echtes von Kopien unterscheidest, steht im Ratgeber ${kbL("antiquitaeten-erkennen-flohmarkt", "Antiquitäten erkennen")}.`],
      ["Schallplatten prüfen", `Nimm Platten immer aus der Hülle und halte sie schräg gegen das Licht, so siehst du Kratzer und Verzug. Mehr dazu im Ratgeber ${kbL("schallplatten-flohmarkt", "Schallplatten auf dem Flohmarkt")}.`]],
    f: [["Was ist der Unterschied zwischen Flohmarkt, Trödelmarkt und Antikmarkt?", `Auf dem Flohmarkt verkaufen vor allem Privatleute gebrauchte Dinge, auf Trödel- und Antikmärkten sind häufiger Händler mit älterer oder wertvollerer Ware. Mehr dazu im Ratgeber ${kbL("flohmarkt-troedelmarkt-antikmarkt", "Flohmarkt, Trödelmarkt, Antikmarkt")}.`]],
    kb: ["antiquitaeten-erkennen-flohmarkt", "schallplatten-flohmarkt", "faelschungen-erkennen-flohmarkt"] },
  { s: "fahrradflohmarkt-hamburg", tag: "Fahrräder", icon: "bike", chip: "Fahrradflohmärkte", pl: "Fahrradflohmärkte",
    h1: "Fahrradflohmarkt Hamburg: gebrauchte Räder kaufen und verkaufen", t: Y => `Fahrradflohmarkt Hamburg ${Y}: alle Termine`,
    lead: "Gebrauchte Fahrräder von privat: Hier stehen alle Fahrradflohmärkte und Fahrradbörsen in Hamburg und Umgebung mit Terminen.",
    b: () => [["Worauf du beim Gebrauchtrad achtest", "Mach eine kurze Probefahrt und prüf Bremsen, Schaltung, Kette und Licht. Lass dir beim Kauf am besten einen kurzen schriftlichen Kaufbeleg mit Rahmennummer geben."],
      ["Selbst ein Rad verkaufen", "Putz das Rad vorher, pump die Reifen auf und nimm Kaufbeleg oder Rahmennummer mit, falls du sie hast. Das schafft Vertrauen und erleichtert den Verkauf."]],
    f: [],
    kb: ["handeln-auf-dem-flohmarkt", "bezahlen-auf-dem-flohmarkt", "elektrogeraete-flohmarkt"] },
  { s: "nachbarschaftsflohmarkt-hamburg", tag: "Nachbarschaft", icon: "home", chip: "Nachbarschaft & Hof", pl: "Nachbarschafts- und Hofflohmärkte",
    h1: "Nachbarschafts- und Hofflohmärkte in Hamburg", t: Y => `Hofflohmarkt & Nachbarschaftsflohmarkt Hamburg ${Y}`,
    lead: "Kleine Märkte mit Nachbarschaftsgefühl: Hier stehen alle Nachbarschafts- und Hofflohmärkte in Hamburg und Umgebung mit Terminen.",
    b: () => [["Klein, aber fein", "Auf Nachbarschaftsflohmärkten verkaufen vor allem Leute aus dem Viertel. Die Stimmung ist entspannt, Neuware findest du hier selten. Früh kommen lohnt sich trotzdem."],
      ["Selbst einen Hofflohmarkt organisieren", `Du willst mit deinen Nachbarn einen Hofflohmarkt auf die Beine stellen? Wie das klappt, steht im Ratgeber ${kbL("hofflohmarkt-organisieren", "Hofflohmarkt organisieren")}.`]],
    f: [["Was ist ein Hofflohmarkt?", "Bei einem Hofflohmarkt verkaufen Anwohner in ihren Höfen, Einfahrten oder Gärten. Oft machen viele Häuser in einem Viertel gleichzeitig mit."]],
    kb: ["hofflohmarkt-organisieren", "flohmarkt-knigge", "handeln-auf-dem-flohmarkt"] },
  { s: "groesste-flohmaerkte-hamburg", tag: "Groß & bekannt", icon: "star", chip: "Große Märkte", pl: "großen und bekannten Flohmärkte",
    h1: "Die größten Flohmärkte in Hamburg", t: Y => `Größter Flohmarkt Hamburg: die großen Märkte ${Y}`,
    lead: "Viel Fläche, viele Stände: Diese großen und bekannten Flohmärkte in Hamburg lohnen sich, wenn du richtig stöbern willst.",
    b: () => [["Gut vorbereitet auf große Märkte", `Auf großen Märkten läufst du schnell ein paar Kilometer. Bequeme Schuhe, eine stabile Tasche und Bargeld in kleinen Scheinen helfen. Die Checkliste steht im Ratgeber ${kbL("was-mitnehmen-flohmarkt", "Was mitnehmen auf den Flohmarkt?")}.`],
      ["Früh oder spät?", `Wer früh kommt, hat die beste Auswahl, wer gegen Ende kommt, kann besser handeln. Mehr dazu im Ratgeber ${kbL("beste-uhrzeit-flohmarkt", "Wann ist die beste Uhrzeit für den Flohmarkt?")}.`]],
    f: [],
    kb: ["was-mitnehmen-flohmarkt", "beste-uhrzeit-flohmarkt", "handeln-auf-dem-flohmarkt"] },
  { s: "frauenflohmarkt-hamburg", match: m => /frauen|mädchen|mädels/i.test(m.name), icon: "tag", chip: "Frauenflohmärkte", pl: "Frauen- und Mädelsflohmärkte",
    h1: "Frauenflohmärkte und Mädelsflohmärkte in Hamburg", t: Y => `Frauenflohmarkt Hamburg ${Y}: Mode & Accessoires`,
    lead: "Kleidung, Schuhe und Accessoires von Frauen für Frauen: Hier stehen alle Frauen- und Mädelsflohmärkte in Hamburg mit Terminen.",
    b: () => [["Mode aus zweiter Hand", `Auf Frauenflohmärkten findest du vor allem Kleidung, Schuhe, Taschen und Schmuck. Kleiderständer statt Wühltisch machen das Stöbern leichter. Wie du gute Qualität erkennst, steht im Ratgeber ${kbL("vintage-kleidung-flohmarkt", "Vintage-Kleidung auf dem Flohmarkt kaufen")}.`],
      ["Selbst verkaufen", "Bügel, ein Spiegel und gut lesbare Preise helfen beim Verkaufen. Passende Schilder druckst du kostenlos mit unserem [Schilder-Designer](/flohmarkt-schilder/)."]],
    f: [],
    kb: ["vintage-kleidung-flohmarkt", "handeln-auf-dem-flohmarkt", "flohmarkt-knigge"] },
  { s: "flohmarkt-hamburg-umgebung", tag: "Umland", icon: "tree", chip: "Umland bis 30 km", pl: "Flohmärkte im Hamburger Umland",
    h1: "Flohmärkte in der Umgebung von Hamburg", t: () => "Flohmarkt Hamburg Umgebung: alle Termine bis 30 km",
    lead: "Rund um Hamburg finden viele Märkte auf großen Parkplätzen und Parkdecks statt. Hier stehen alle Flohmärkte im Umland bis 30 Kilometer mit Terminen.",
    b: () => [["Groß und oft überdacht", "Im Umland finden viele Märkte auf Parkplätzen von Bau- und Supermärkten statt, teils auf überdachten Parkdecks. Mit dem Auto ist die Anreise meist bequem, viele Märkte erreichst du aber auch mit Bus und Bahn."]],
    f: [],
    kb: ["beste-uhrzeit-flohmarkt", "was-mitnehmen-flohmarkt", "handeln-auf-dem-flohmarkt"] }
];
for (const c of CATS) { c.ms = MARKETS.filter(m => c.match ? c.match(m) : m.tags.includes(c.tag)); c.evs = EVENTS.filter(e => c.ms.includes(e.m)); }
const CATS_ON = CATS.filter(c => c.ms.length >= 2);
const CAT_BY_TAG = Object.fromEntries(CATS_ON.filter(c => c.tag).map(c => [c.tag, c]));
const CAT_BY_S = Object.fromEntries(CATS_ON.map(c => [c.s, c]));
const catChips = (skip, onlyIn) => `<div class="chips">${CATS_ON.filter(c => c.s !== skip && (!onlyIn || c.ms.some(onlyIn))).map(c => `<a class="chip" href="/${c.s}/">${ic(c.icon)}${esc(c.chip)}</a>`).join("")}</div>`;

// Monatsseiten für alle Monate mit Terminen im Kalender
const MSLUG = ["januar", "februar", "maerz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const MONTHS = [];
{
  const used = new Set();
  for (let d = new Date(Date.UTC(YEAR, TODAY.getUTCMonth(), 1)); d <= END; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const y = d.getUTCFullYear(), mo = d.getUTCMonth(), evs = EVENTS.filter(e => e.date.getUTCFullYear() === y && e.date.getUTCMonth() === mo);
    if (!evs.some(e => !e.cancelled)) continue;
    let s = `flohmarkt-hamburg-${MSLUG[mo]}`; if (used.has(s)) s += "-" + y; used.add(s);
    const last = new Date(Date.UTC(y, mo + 1, 0));
    MONTHS.push({ s, y, mo, name: MON[mo], evs, partial: END < last });
  }
}
const monthChips = skip => MONTHS.length ? `<div class="chips">${MONTHS.filter(x => x.s !== skip).map(x => `<a class="chip" href="/${x.s}/">${ic("cal")}${x.name} ${x.y}</a>`).join("")}</div>` : "";
// Nachbarn für „In der Nähe“ auf den Bezirksseiten
const NEAR = { mitte: ["altona", "nord", "eimsbuettel"], altona: ["eimsbuettel", "mitte", "pinneberg"], eimsbuettel: ["altona", "nord", "norderstedt"], nord: ["eimsbuettel", "wandsbek", "mitte"], wandsbek: ["nord", "ost", "norderstedt"], bergedorf: ["ost", "harburg", "wandsbek"], harburg: ["sued", "mitte", "bergedorf"], pinneberg: ["altona", "eimsbuettel", "norderstedt"], norderstedt: ["nord", "wandsbek", "pinneberg"], ost: ["wandsbek", "bergedorf"], sued: ["harburg", "bergedorf"] };
const faqLD = f => ({ "@type": "FAQPage", mainEntity: f.map(([q, x]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(x).replace(/<[^>]+>/g, "") } })) });
const faqBlock = (f, h = "Häufige Fragen") => f.length ? `<section class="faq"><h2>${h}</h2>${f.map(([q, x]) => `<details><summary>${esc(q)}</summary><p>${rich(x)}</p></details>`).join("")}</section>` : "";
// Ratgeber-Artikel mit passender Hamburg-Seite nach Art
const ART_CTA = { "nachtflohmarkt": "nachtflohmarkt-hamburg", "flohmarkt-mit-kindern": "kinderflohmarkt-hamburg", "kinderflohmarkt-verkaufen": "kinderflohmarkt-hamburg", "flohmarkt-bei-regen": "hallenflohmarkt-hamburg", "schallplatten-flohmarkt": "antikmarkt-hamburg", "antiquitaeten-erkennen-flohmarkt": "antikmarkt-hamburg", "flohmarkt-troedelmarkt-antikmarkt": "antikmarkt-hamburg", "hofflohmarkt-organisieren": "nachbarschaftsflohmarkt-hamburg", "vintage-kleidung-flohmarkt": "frauenflohmarkt-hamburg", "flohmaerkte-hamburg": "groesste-flohmaerkte-hamburg", "elektrogeraete-flohmarkt": "fahrradflohmarkt-hamburg" };
const catCta = c => { const nx = nextOf(c.evs); return `<a class="cta-box" href="/${c.s}/">${ic(c.icon)}<span><b>In Hamburg: ${esc(cap(c.pl))}</b>${c.ms.length} Märkte mit allen Terminen${nx ? `, der nächste am ${dDate(nx.date)}` : ""}.</span>${ic("chev")}</a>`; };
const catLink = (s, t) => CAT_BY_S[s] ? `[${t}](/${s}/)` : t;
const extUrl = u => /^https?:\/\/[^\s"<>]+$/i.test(String(u || "").trim()) ? String(u).trim() : "";


/* ---------------------------------------------------------------- Umkreis (Postleitzahl) und Karte
   Postleitzahlen aus src/plz-hamburg.csv (GeoNames, CC BY 4.0). Die Lage eines Markts ergibt sich aus
   der freiwilligen Spalte „Koordinaten“ (z. B. „53.5602, 9.9667“) oder aus Postleitzahl und Stadtteil der Adresse. */
const PLZ_ROWS = (() => { try { return fs.readFileSync(path.join(ROOT, "src/plz-hamburg.csv"), "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#") && !l.startsWith("plz,")).map(l => { const [plz, ort, lat, lng] = l.split(","); return { plz, ort: ort || "", lat: +lat, lng: +lng }; }).filter(r => /^\d{5}$/.test(r.plz) && isFinite(r.lat) && isFinite(r.lng)); } catch { return []; } })();
const avgLL = rs => [rs.reduce((a, r) => a + r.lat, 0) / rs.length, rs.reduce((a, r) => a + r.lng, 0) / rs.length];
const PLZ_C = {}; { const g = {}; for (const r of PLZ_ROWS) (g[r.plz] = g[r.plz] || []).push(r); for (const [k, rs] of Object.entries(g)) PLZ_C[k] = avgLL(rs).map(x => +x.toFixed(4)); }
const normO = s => String(s || "").toLowerCase().replace(/[^a-zäöüß]/g, "");
function coordOf(m) {
  const k = String(m.geo || "").match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (k && Math.abs(+k[1]) <= 90 && Math.abs(+k[2]) <= 180) return [+k[1], +k[2]];
  if (!PLZ_ROWS.length) return null;
  const plz = (m.addr.match(/\b(\d{5})\b/) || [])[1], a = normO(m.area), same = r => normO(r.ort) === "hamburg" + a || normO(r.ort) === a;
  if (plz) { const hit = PLZ_ROWS.find(r => r.plz === plz && same(r)); if (hit) return [hit.lat, hit.lng]; if (PLZ_C[plz]) return PLZ_C[plz]; }
  const byName = PLZ_ROWS.filter(same); return byName.length ? avgLL(byName).map(x => +x.toFixed(4)) : null;
}
for (const m of MARKETS) { m.ll = coordOf(m); if (!m.ll && PLZ_ROWS.length) warn("Karte", `${m.name}: Lage unbekannt. Postleitzahl in die Adresse schreiben oder die Spalte „Koordinaten“ füllen.`); }
const llAttr = m => m.ll ? ` data-ll="${m.ll[0].toFixed(4)},${m.ll[1].toFixed(4)}"` : "";
// Umkreis-Suche (funktioniert nur mit JavaScript, Postleitzahl und Standort bleiben im Browser)
const nearBox = (what = "Termine") => PLZ_ROWS.length ? `<div class="near" id="near" hidden><p class="near-h">${ic("pin")}${what} in deiner Nähe</p><form class="near-form" id="nearForm" novalidate>
<label class="near-plz"><span>Postleitzahl</span><input id="nearPlz" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="z. B. 22765" autocomplete="postal-code" enterkeyhint="search"></label>
<label class="near-km"><span>Umkreis</span><select id="nearKm"><option value="3">3 km</option><option value="5">5 km</option><option value="10" selected>10 km</option><option value="20">20 km</option><option value="30">30 km</option></select></label>
<button type="submit" class="btn near-go" id="nearGo">Anzeigen</button>
<button type="button" class="chip near-geo" id="nearGeo">${ic("route")}Mein Standort</button><button type="button" class="chip" id="nearClear" hidden>Zurücksetzen</button></form>
<p class="near-msg" id="nearMsg" aria-live="polite">Postleitzahl eingeben und auf „Anzeigen“ tippen. Entfernungen sind ungefähr, gerechnet ab der Mitte der Postleitzahl. Deine Eingabe bleibt auf deinem Gerät.</p></div>` : "";
const HAS_MAP = fs.existsSync(path.join(ROOT, "src/leaflet.js")) && fs.existsSync(path.join(ROOT, "src/leaflet.css"));


/* ---------------------------------------------------------------- Wetter-Weiche
   Vorhersage des Deutschen Wetterdienstes (DWD), abgerufen über Bright Sky, nur beim Bau.
   Die Besucher laden nichts von einem Wetterdienst. Fällt der Abruf aus, baut die Seite ohne Wetter.
   Abruf nur im echten Bau (SHEET_ID gesetzt) oder mit WETTER=an, abschalten mit WETTER=aus. */
const WX = {}; let WX_OK = false;
{
  const mode = (process.env.WETTER || "").toLowerCase();
  let raw = null;
  try {
    if (process.env.WETTER_DATEI) raw = JSON.parse(fs.readFileSync(process.env.WETTER_DATEI, "utf8"));
    else if (mode !== "aus" && (process.env.SHEET_ID || mode === "an")) {
      const res = await fetch(`https://api.brightsky.dev/weather?lat=53.55&lon=10.0&date=${key(TODAY)}&last_date=${key(addDays(TODAY, 6))}`, { signal: AbortSignal.timeout(12000) });
      if (res.ok) raw = await res.json(); else warn("Wetter", `Wetterdienst antwortet mit Fehler ${res.status}. Die Seite wurde ohne Wetter gebaut.`);
    }
  } catch (e) { warn("Wetter", "Die Wettervorhersage konnte nicht geladen werden. Die Seite wurde ohne Wetter gebaut."); }
  for (const r of (raw && Array.isArray(raw.weather) ? raw.weather : [])) {
    const t = new Date(r.timestamp); if (isNaN(t)) continue;
    const loc = new Date(t.getTime() + parseInt(berlinOff(t), 10) * 36e5), k = key(loc);
    (WX[k] = WX[k] || []).push({ h: loc.getUTCHours(), mm: +r.precipitation || 0, pp: r.precipitation_probability == null ? null : +r.precipitation_probability, T: r.temperature == null ? null : +r.temperature });
  }
  WX_OK = Object.keys(WX).length > 0;
}
// Wetter für einen Tag und ein Zeitfenster (Stunden), z. B. wxAt("2026-10-03", 8, 16)
function wxAt(k, a = 8, b = 16) {
  if ((new Date(k + "T00:00:00Z") - TODAY) / 864e5 > 5) return null; // weiter als 5 Tage ist zu unsicher
  const hs = (WX[k] || []).filter(x => x.h >= a && x.h < Math.max(b, a + 1)); if (hs.length < Math.max(1, (b - a) / 2)) return null;
  const mm = hs.reduce((s, x) => s + x.mm, 0), pp = Math.max(...hs.map(x => x.pp == null ? 0 : x.pp)), temps = hs.map(x => x.T).filter(x => x != null);
  const wetH = hs.find(x => (x.pp != null && x.pp >= 50) || x.mm >= 0.3), lvl = mm >= 1 || pp >= 60 ? "wet" : mm >= 0.2 || pp >= 30 ? "mix" : "dry";
  const T = temps.length ? Math.round(Math.max(...temps)) : null;
  const text = lvl === "wet" ? (wetH && wetH.h > a ? `Regen ab ca. ${wetH.h} Uhr` : "Regen wahrscheinlich") : lvl === "mix" ? "Schauer möglich" : "voraussichtlich trocken";
  const noun = lvl === "wet" ? (wetH && wetH.h > a ? `Regen ab ca. ${wetH.h} Uhr` : "Regen") : lvl === "mix" ? "einzelne Schauer" : "trockenes Wetter";
  return { lvl, T, noun: noun + (T != null ? ` bei bis zu ${T}°` : ""), text: text + (T != null ? `, bis ${T}°` : ""), icon: lvl === "wet" ? "rain" : lvl === "mix" ? "cloudsun" : "sun" };
}
const hourOf = t => parseInt(t.slice(0, 2), 10);
const wxEv = e => e.start ? wxAt(e.k, hourOf(tFirst(e.start)), e.end ? hourOf(tLast(e.end)) : hourOf(tFirst(e.start)) + 4) : wxAt(e.k);
const wxDay = list => { const st = list.filter(e => !e.cancelled && e.start); return st.length ? wxAt(list[0].k, Math.min(...st.map(e => hourOf(tFirst(e.start)))), Math.max(...st.map(e => e.end ? hourOf(tLast(e.end)) : hourOf(tFirst(e.start)) + 4))) : wxAt(list[0].k); };
const wxChip = w => w ? `<span class="wx wx-${w.lvl}" title="Vorhersage des Deutschen Wetterdienstes">${ic("frog")}${w.text}</span>` : "";
// Ganzer Satz: „Der Wetterfrosch sagt für Samstag … voraus.“
const wxSay = (w, when = "") => w ? `<p class="wx wx-say wx-${w.lvl}">${ic("frog")}<span>Der Wetterfrosch sagt${when ? " " + when : ""} <b>${w.noun}</b> voraus.</span></p>` : "";
function frogLine(evs) {
  const k = [...new Set(evs.filter(e => !e.cancelled).map(e => e.k))].sort()[0]; if (!k) return "";
  const list = evs.filter(e => e.k === k && !e.cancelled), d = list[0].date;
  return wxSay(wxDay(list), k === key(TODAY) ? "für heute" : k === key(addDays(TODAY, 1)) ? "für morgen" : "für " + WDL[d.getUTCDay()]);
}
// Kasten für Regentage: überdachte Märkte am ersten nassen Tag der Liste
function rainBox(evs) {
  const days = [...new Set(evs.filter(e => !e.cancelled).map(e => e.k))].sort();
  for (const k of days) {
    const list = evs.filter(e => e.k === k && !e.cancelled), w = wxDay(list); if (!w || w.lvl !== "wet") continue;
    const cov = list.filter(e => e.m.tags.includes("Überdacht")); if (!cov.length) continue;
    const d = list[0].date, when = k === key(TODAY) ? "Heute" : k === key(addDays(TODAY, 1)) ? "Morgen" : "Am " + WDL[d.getUTCDay()];
    return `<div class="rain">${ic("umbrella")}<div><b>${when} wird es wohl nass. ${cov.length === 1 ? "Dieser Markt ist" : `Diese ${cov.length} Märkte sind`} überdacht:</b><p>${cov.slice(0, 6).map(e => `<a href="/flohmarkt/${e.m.slug}/">${esc(e.m.short)}</a>`).join(" · ")}${cov.length > 6 ? " und weitere" : ""}</p>${CAT_BY_S["hallenflohmarkt-hamburg"] ? `<a class="more-link" href="/hallenflohmarkt-hamburg/">Alle überdachten Märkte${ic("chev")}</a>` : ""}</div></div>`;
  }
  return "";
}
const listNamesPlain = a => a.length <= 3 ? a.join(", ") : `${a.slice(0, 3).join(", ")} und ${a.length - 3} weitere`;
/* ---------------------------------------------------------------- Termin-Wächter
   Ruft einmal pro Bau die Website jedes Veranstalters ab und merkt sich, welche Datumsangaben dort stehen.
   Ändern sie sich, steht das im Bericht: „bitte prüfen“. Es wird nichts automatisch übernommen.
   Gespeichert werden nur Adresse, Prüfsumme und die gefundenen Datumsangaben (keine Texte, keine Personen),
   und zwar in /assets/waechter.json der Website selbst. Der nächste Bau liest die Datei von dort wieder ein.
   robots.txt der Veranstalter wird beachtet. Läuft nur im echten Bau (SHEET_ID) oder mit WAECHTER=an; aus mit WAECHTER=aus. */
const WATCH = { v: 1, stand: "", seiten: {} }, WATCH_ROWS = [];
// Datumsangabe von einer Veranstalterseite („14.11.“, „14.11.2026“, „14. nov 2026“) in ein Datum wandeln; ohne Jahr: das nächste Mal ab heute
const WMON = { jan: 1, feb: 2, "mär": 3, mae: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 };
const tokDate = t => {
  let m = /^(\d{2})\.(\d{2})\.(\d{4})?$/.exec(t), d, mo, y;
  if (m) { d = +m[1]; mo = +m[2]; y = m[3] ? +m[3] : 0; } else if ((m = /^(\d{2})\. (\S{3})(?: (\d{4}))?$/.exec(t)) && WMON[m[2]]) { d = +m[1]; mo = WMON[m[2]]; y = m[3] ? +m[3] : 0; } else return null;
  const mk = yy => { const x = new Date(Date.UTC(yy, mo - 1, d)); return x.getUTCMonth() === mo - 1 ? x : null; };
  if (y) return mk(y);
  const a = mk(TODAY.getUTCFullYear()); return a && a >= TODAY ? a : mk(TODAY.getUTCFullYear() + 1);
};
const mostOf = a => { const c = {}; let best = ""; for (const x of a) if (x) { c[x] = (c[x] || 0) + 1; if (!best || c[x] > c[best]) best = x; } return best; };
const deDate = d => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
// alle Tage, die für einen Markt schon in der Tabelle stehen (Einzeltermine jeder Zukunft, Serien im Vorschau-Zeitraum)
const knownDays = m => new Set([...m.events.map(e => e.k), ...data.Termine.filter(r => r["Markt"] === m.slug).map(r => { const d = parseDate(r["Datum"], ""); return d ? key(d) : ""; })]);
const SERIES_SLUGS = new Set(data.Serien.map(r => r["Markt"]));
{
  const mode = (process.env.WAECHTER || "").toLowerCase(), UA = `FlohlotseBot/1.0 (+${SITE}/veranstalter/#waechter)`;
  const get = async (u, ms = 10000) => { const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { "User-Agent": UA, "Accept": "text/html,text/plain" }, redirect: "follow" }); if (!r.ok) throw new Error("HTTP " + r.status); return (await r.text()).slice(0, 1500000); };
  const MONS = "januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sep|sept|okt|nov|dez";
  // sichtbaren Text holen, dann nur Datumsangaben herausziehen: „14.11.“, „14.11.2026“, „14. November“
  const datesOf = html => {
    const txt = html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
    const out = new Set();
    for (const m of txt.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})\b)?/g)) { const d = +m[1], mo = +m[2]; if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) out.add(`${String(d).padStart(2, "0")}.${String(mo).padStart(2, "0")}.${m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : ""}`); }
    for (const m of txt.matchAll(new RegExp(`\\b(\\d{1,2})\\.\\s?(${MONS})\\b\\.?(?:\\s?(\\d{4}))?`, "gi"))) { const d = +m[1]; if (d >= 1 && d <= 31) out.add(`${String(d).padStart(2, "0")}. ${m[2].toLowerCase().slice(0, 3)}${m[3] ? " " + m[3] : ""}`); }
    return { dates: [...out].sort().slice(0, 150), len: txt.length };
  };
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
  // robots.txt: Regeln für uns oder für alle (*); gesperrt, wenn ein Disallow auf den Pfad passt
  const robots = {};
  const allowed = async u => {
    const url = new URL(u), host = url.origin;
    if (!(host in robots)) { try { robots[host] = await get(host + "/robots.txt", 6000); } catch { robots[host] = ""; } }
    let on = false, hit = false; const dis = [], alw = [];
    for (const raw of robots[host].split(/\r?\n/)) {
      const l = raw.replace(/#.*/, "").trim(), i = l.indexOf(":"); if (i < 0) continue;
      const k = l.slice(0, i).trim().toLowerCase(), val = l.slice(i + 1).trim();
      if (k === "user-agent") { const a = val.toLowerCase(); if (!hit) on = a === "*" || a.includes("flohlotse"); if (on && a.includes("flohlotse")) { hit = true; dis.length = 0; alw.length = 0; } }
      else if (on && k === "disallow" && val) dis.push(val); else if (on && k === "allow" && val) alw.push(val);
    }
    const p = url.pathname + url.search, best = list => Math.max(0, ...list.filter(r => p.startsWith(r.replace(/\*.*$/, ""))).map(r => r.length));
    return best(alw) >= best(dis);
  };
  const urls = new Map(), urlMs = new Map(); for (const m of MARKETS) if (m.web) { if (!urls.has(m.web)) { urls.set(m.web, []); urlMs.set(m.web, []); } urls.get(m.web).push(m.name); urlMs.get(m.web).push(m); }
  if (mode !== "aus" && (process.env.SHEET_ID || mode === "an") && urls.size) {
    let old = {}; try { const j = JSON.parse(await get(SITE + "/assets/waechter.json", 8000)); if (j && j.seiten) old = j.seiten; } catch { /* erster Lauf oder Website noch nicht online: nur merken, nichts melden */ }
    const todo = [...urls.keys()], today = key(TODAY);
    const work = async () => { for (let u; (u = todo.shift());) {
      const prev = old[u] || null, names = listNamesPlain(urls.get(u));
      try {
        if (!(await allowed(u))) { WATCH.seiten[u] = { gesperrt: true }; if (!prev || !prev.gesperrt) warn("Termin-Wächter", `${names}: Die Website des Veranstalters möchte nicht automatisch abgerufen werden (robots.txt). Diese Seite bitte weiter von Hand prüfen: ${u}`); continue; }
        const { dates, len } = datesOf(await get(u)), h = hash(dates.length ? dates.join("|") : String(Math.round(len / 200)));
        const e = { h, d: dates, seit: prev && prev.h === h ? prev.seit || "" : prev && prev.h ? today : "", neu: prev && prev.h === h ? prev.neu || [] : prev && prev.d ? dates.filter(x => !prev.d.includes(x)) : [], weg: prev && prev.h === h ? prev.weg || [] : prev && prev.d ? prev.d.filter(x => !dates.includes(x)) : [] };
        WATCH.seiten[u] = e;
        // eine Änderung bleibt 7 Tage im Bericht stehen, damit sie nicht untergeht
        const fresh7 = e.seit && (TODAY - new Date(e.seit + "T00:00:00Z")) / 864e5 <= 7, ms = urlMs.get(u);
        let still = [];
        if (fresh7) {
          // fertige Zeilen für das Blatt Termine: neue, künftige Tage, die noch nicht in der Tabelle stehen
          for (const tok of e.neu) { const d = tokDate(tok); if (!d || d < TODAY || d > addDays(TODAY, 400)) continue; const k = key(d);
            if (ms.some(m => knownDays(m).has(k)) || (d > END && ms.some(m => SERIES_SLUGS.has(m.slug)))) continue;
            const m0 = ms[0], evs = ms.flatMap(m => m.events.filter(x => !x.cancelled));
            WATCH_ROWS.push({ k, row: [ms.length === 1 ? m0.slug : "BITTE WÄHLEN: " + ms.map(m => m.slug).join(" oder "), deDate(d), mostOf(evs.map(x => x.start)), mostOf(evs.map(x => x.end)), "Findet statt", ""], src: u }); }
          // von der Seite verschwunden, aber noch im Kalender
          still = e.weg.map(tokDate).filter(d => d && d >= TODAY && ms.some(m => m.events.some(x => x.k === key(d) && !x.cancelled))).map(deDate);
        }
        if (fresh7) warn("Termin-Wächter", `${names}: Auf der Website des Veranstalters haben sich am ${e.seit.split("-").reverse().join(".")} die Terminangaben geändert.${e.neu.length ? ` Neu dort: ${e.neu.slice(0, 12).map(x => x.replace(/\.$/, "")).join(", ")}${e.neu.length > 12 ? " …" : ""}.` : ""}${e.weg.length ? ` Nicht mehr dort: ${e.weg.slice(0, 12).map(x => x.replace(/\.$/, "")).join(", ")}${e.weg.length > 12 ? " …" : ""}.` : ""}${still.length ? ` Achtung: ${still.join(", ")} ${still.length === 1 ? "steht" : "stehen"} noch im Kalender, ${still.length === 1 ? "ist" : "sind"} auf der Seite aber nicht mehr zu finden. Prüfen, ob der Termin ausfällt.` : ""}${!dates.length ? " Die Seite nennt keine lesbaren Datumsangaben, verglichen wurde nur der Umfang." : ""} Bitte prüfen: ${u}`);
      } catch (err) {
        const f = ((prev && prev.fehler) || 0) + 1; WATCH.seiten[u] = { ...(prev || {}), fehler: f };
        if (f === 3) warn("Termin-Wächter", `${names}: Die Website des Veranstalters war drei Nächte in Folge nicht erreichbar. Adresse in der Spalte „Veranstalter-Website“ prüfen: ${u}`);
      }
    } };
    await Promise.all([work(), work(), work(), work()]);
    WATCH.stand = today;
  }
}
const WATCH_ON = Object.keys(WATCH.seiten).length > 0;

/* ---------------------------------------------------------------- Teilen mit norddeutscher Nachricht
   Der Text wird beim Bau vorformuliert. Geteilt wird über die Teilen-Funktion des Geräts,
   es werden keine Daten übertragen, bevor jemand selbst auf Teilen tippt. */
function shareText(m, e) {
  const url = `${SITE}/flohmarkt/${m.slug}/`;
  if (!e) return `Moin! Kennst du schon ${m.name} in ${m.area}? Alle Termine: ${url}`;
  const W = dDate(e.date), Z = e.start ? ", " + timeText(e) : "", w = wxEv(e), cov = m.tags.includes("Überdacht");
  const pool = [
    `Moin! Lust auf Flohmarkt? ${m.name} in ${m.area}, ${W}${Z}. Kommst du mit?`,
    `Moin Moin! Am ${W} ist ${m.name} in ${m.area}${Z}. Büschen stöbern und klönen?`,
    `Na, Lust auf Schnäppchenjagd? ${m.name} am ${W}${Z}. Ich bin dabei, du auch?`,
    `Nich lang schnacken: ${m.name}, ${W}${Z}, ${m.area}. Wer zuerst kommt, kriegt die besten Plünnen.`,
    `Moin! Am ${W} gibt's wieder Tüddelkram und Schätze: ${m.name} in ${m.area}${Z}. Bist du dabei?`];
  let h = 0; for (const c of m.slug + e.k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const wet = w && w.lvl === "wet" ? (cov ? " Schietwetter? Egal, ist überdacht." : " Regenjacke nicht vergessen, es wird wohl nass.") : w && w.lvl === "dry" ? " Soll trocken bleiben." : "";
  return `${pool[h % pool.length]}${wet} ${url}`;
}
const shareBtn = (m, e, cls = "share") => `<button type="button" class="${cls}" data-share="${esc(shareText(m, e))}" aria-label="${esc(m.name)} teilen" hidden>${ic("share")}${cls === "share" ? "" : "Teilen"}</button>`;

/* ---------------------------------------------------------------- Startseite */
{
  const { sat, sun, sunOnly } = weekendDays();
  const weN = EVENTS.filter(e => !e.cancelled && (e.k === key(sat) || e.k === key(sun))).length;
  const weLabel = sunOnly ? `Termine heute, Sonntag ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()].slice(0, 3)}.` : `Termine am Wochenende ${sat.getUTCDate()}.–${sun.getUTCDate()}. ${MON[sun.getUTCMonth()].slice(0, 3)}.`;
  const next = []; let days = new Set();
  for (const e of upcoming(14)) { if (next.length >= 8 && !days.has(e.k)) break; next.push(e); days.add(e.k); }
  const all14 = upcoming(14).length;
  // Text und Fragen für die Startseite, aus den Daten berechnet
  const liveAll = EVENTS.filter(e => !e.cancelled), n30 = upcoming(30).filter(e => !e.cancelled).length;
  const weShare = liveAll.length ? liveAll.filter(e => [0, 6].includes(e.date.getUTCDay())).length / liveAll.length : 0;
  const earlyShare = liveAll.length ? liveAll.filter(e => e.start && tFirst(e.start) < "09:00").length / liveAll.length : 0;
  const mk = m => `[${m.name}](/flohmarkt/${m.slug}/)`, fsm = MARKETS.find(m => m.slug === "flohschanze");
  const bigC = CAT_BY_S["groesste-flohmaerkte-hamburg"], coverC = CAT_BY_S["hallenflohmarkt-hamburg"], nightC = CAT_BY_S["nachtflohmarkt-hamburg"];
  const homeText = [
    `In Hamburg und im Umland bis 30 Kilometer stehen aktuell ${MARKETS.length} Flohmärkte im ${NAME}-Kalender, in den nächsten 30 Tagen sind es ${n30} Termine.${weShare >= 0.5 ? " Die meisten Termine liegen am Wochenende" + (earlyShare >= 0.3 ? ", viele Märkte öffnen schon vor 9 Uhr." : ".") : ""}${fsm ? ` Ein Klassiker ist die ${mk(fsm)} in St. Pauli.` : ""}${bigC ? ` Zu den ${catLink("groesste-flohmaerkte-hamburg", "größten Märkten")} zählen ${listNames(bigC.ms.map(mk), 3)}.` : ""}`,
    `Bei Regen und im Winter lohnen sich ${catLink("hallenflohmarkt-hamburg", "Hallenflohmärkte und überdachte Märkte")}, abends öffnen die ${catLink("nachtflohmarkt-hamburg", "Nachtflohmärkte")}. Familien finden auf ${catLink("kinderflohmarkt-hamburg", "Kinderflohmärkten")} gebrauchte Kleidung und Spielzeug, Sammler auf ${catLink("antikmarkt-hamburg", "Antikmärkten und Plattenbörsen")}.`,
    `Ob Flohmarkt, Trödelmarkt oder Antikmarkt: Den Unterschied erklärt der Ratgeber ${kbL("flohmarkt-troedelmarkt-antikmarkt", "Flohmarkt, Trödelmarkt, Antikmarkt")}. Wer selbst verkaufen will, findet Tipps im Ratgeber ${kbL("flohmarktstand-anmelden", "Flohmarktstand anmelden")} und kostenlose Schilder im [Schilder-Designer](/flohmarkt-schilder/).`];
  const lt = liveAll.filter(e => e.k === key(TODAY)), nkDay = liveAll.find(e => e.k > key(TODAY));
  const satL = liveAll.filter(e => e.k === key(sat)), sunL = liveAll.filter(e => e.k === key(sun));
  const nNight = nightC && nextOf(nightC.evs), coverNext = coverC ? coverC.ms.filter(m => m.events.some(e => !e.cancelled)) : [];
  const homeFaq = [
    ["Welche Flohmärkte sind heute in Hamburg?", lt.length ? `Heute, ${fmtDate(TODAY)}, ${lt.length === 1 ? "hat ein Flohmarkt" : "haben " + lt.length + " Flohmärkte"} geöffnet: ${listNames(lt.map(e => mk(e.m)), 5)}. Alle Uhrzeiten stehen unter [Flohmarkt Hamburg heute](/heute/).` : `Heute steht kein Flohmarkt im Kalender.${nkDay ? ` Der nächste Markttag ist ${fmtDate(nkDay.date)}.` : ""} Alle Infos unter [Flohmarkt Hamburg heute](/heute/).`],
    ["Welche Flohmärkte sind am Wochenende?", sunOnly ? `Heute, am Sonntag, ${sunL.length === 1 ? "findet ein Flohmarkt" : "finden " + sunL.length + " Flohmärkte"} statt. Alle Termine stehen unter [Flohmarkt am Wochenende](/wochenende/).` : `Am Wochenende ${sat.getUTCDate()}./${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]} ${satL.length + sunL.length === 1 ? "findet ein Flohmarkt" : "finden " + (satL.length + sunL.length) + " Flohmärkte"} statt, ${satL.length} am Samstag und ${sunL.length} am Sonntag. Alle Termine stehen unter [Flohmarkt am Wochenende](/wochenende/).`],
    ...(bigC ? [["Welcher ist der größte Flohmarkt in Hamburg?", `Zu den größten und bekanntesten Märkten zählen ${listNames(bigC.ms.map(mk), 4)}. Mehr dazu unter ${catLink("groesste-flohmaerkte-hamburg", "die größten Flohmärkte in Hamburg")}.`]] : []),
    ...(coverC ? [["Gibt es überdachte Flohmärkte in Hamburg?", `Ja. ${coverC.ms.length} Märkte im Kalender finden drinnen oder überdacht statt${coverNext.length ? `, zum Beispiel ${listNames(coverNext.map(mk), 3)}` : ""}. Alle stehen unter ${catLink("hallenflohmarkt-hamburg", "Hallenflohmarkt Hamburg")}.`]] : []),
    ...(nNight ? [["Wann ist der nächste Nachtflohmarkt in Hamburg?", `Der nächste Termin: ${mk(nNight.m)} am ${fmtDate(nNight.date)}${nNight.start ? ", " + timeText(nNight) : ""}. Alle Termine stehen unter ${catLink("nachtflohmarkt-hamburg", "Nachtflohmarkt Hamburg")}.`]] : []),
    ["Wie bekomme ich einen Stand auf einem Flohmarkt in Hamburg?", `Standplätze vergeben die Veranstalter der einzelnen Märkte, oft mit Anmeldung im Voraus. Wie du am besten vorgehst, steht im Ratgeber ${kbL("flohmarktstand-anmelden", "Flohmarktstand anmelden")}. Schilder und Preisschilder für deinen Stand druckst du kostenlos mit dem [Schilder-Designer](/flohmarkt-schilder/).`]
  ];
  // Tipp des Tages: wird jede Nacht aus den Terminen berechnet (nur Zahlen und Fakten aus dem Kalender)
  const tip = (() => {
    const on = d => liveAll.filter(e => e.k === key(d)), cnt = n => n === 1 ? "ein Flohmarkt" : n + " Flohmärkte", tt = e => e.start ? ", " + timeText(e) : "";
    const hol = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(TODAY, i)).find(d => HOLI[key(d)] && on(d).length);
    if (hol) { const mo = MONTHS.find(x => x.y === hol.getUTCFullYear() && x.mo === hol.getUTCMonth()); return ["Feiertag", `${HOLI[key(hol)]}, ${dDate(hol)}: ${cnt(on(hol).length)} ${on(hol).length === 1 ? "hat" : "haben"} geöffnet.`, mo ? `/${mo.s}/` : "/termine/"]; }
    const cluster = (evs, label) => {
      for (const c of CATS_ON.filter(c => c.tag && c.tag !== "Umland")) for (const r of REGIONS) { const n = new Set(evs.filter(e => c.ms.includes(e.m) && e.m.bez === r.k).map(e => e.m)).size; if (n >= 3) return [label, `${n} ${c.pl} ${r.im}.`, `/${c.s}/`]; }
      for (const c of CATS_ON.filter(c => c.tag && !["Umland", "Überdacht", "Nachbarschaft"].includes(c.tag))) { const n = new Set(evs.filter(e => c.ms.includes(e.m)).map(e => e.m)).size; if (n >= 3) return [label, `${n} ${c.pl} in Hamburg und Umgebung.`, `/${c.s}/`]; }
      return null;
    };
    const today = on(TODAY);
    if (today.length) {
      const c = cluster(today, "Heute"); if (c) return c;
      const night = today.find(e => e.m.tags.includes("Abends")); if (night) return ["Heute Abend", `${night.m.name}${tt(night)}.`, `/flohmarkt/${night.m.slug}/`];
      const big = today.find(e => e.m.tags.includes("Groß & bekannt")); if (big) return ["Heute", `${big.m.name}${tt(big)}.`, `/flohmarkt/${big.m.slug}/`];
    }
    const last = liveAll.find(e => (e.date - TODAY) / 864e5 < 7 && e.m.events.filter(x => !x.cancelled).length === 1 && /jede|monat|sa\b|so\b|woche/i.test(e.m.rhythm));
    if (last) return ["Vorerst letzter Termin", `${last.m.name} am ${dDate(last.date)}${tt(last)}.`, `/flohmarkt/${last.m.slug}/`];
    const nd = liveAll.find(e => e.k > key(TODAY)); if (!nd) return null;
    const evs = on(nd.date), lab = WDL[nd.date.getUTCDay()];
    return cluster(evs, lab) || [lab, `Am ${dDate(nd.date)} ${evs.length === 1 ? "hat ein Flohmarkt" : "haben " + evs.length + " Flohmärkte"} geöffnet.`, "/termine/"];
  })();
  // Slider: ein großes Symbolfoto, dazu bis zu zwei große Märkte der nächsten Tage als „Wochen-Highlight“.
  const hlEvs = []; for (const e of upcoming(8, e => !e.cancelled && e.m.tags.includes("Groß & bekannt"))) if (hlEvs.length < 2 && !hlEvs.some(x => x.m === e.m)) hlEvs.push(e);
  const sImg = pickImg("start"), sSmall = pickImg("start-klein");
  const slides = [
    sImg ? `<figure class="hl-slide hl-photo"><img src="${imgUrl((sSmall || sImg).f)}" srcset="${[sSmall && `${imgUrl(sSmall.f)} 760w`, `${imgUrl(sImg.f)} 1520w`].filter(Boolean).join(", ")}" sizes="(max-width: 800px) 100vw, 760px" width="760" height="507" alt="${esc(altOf(sImg))}" fetchpriority="high" decoding="async"><figcaption>${capOf(sImg)}</figcaption></figure>` : "",
    ...hlEvs.map(e => `<a class="hl-slide hl-card" href="/flohmarkt/${e.m.slug}/"><span class="kicker">${ic("star")}Wochen-Highlight</span><b>${esc(e.m.short)}</b><span class="hl-when">${esc(fmtDate(e.date))}${e.start ? " · " + esc(timeText(e)) : ""}</span><span class="hl-where">${ic("pin")}${esc(e.m.area || e.m.place)}</span><span class="promo-go">Zum Markt${ic("chev")}</span></a>`)].filter(Boolean);
  const slider = slides.length ? `<section class="hl" aria-label="Highlights"><div class="hl-track" id="hlTrack">${slides.join("")}</div>${slides.length > 1 ? `<div class="hl-dots" id="hlDots">${slides.map((_, i) => `<button type="button" aria-label="Bild ${i + 1} von ${slides.length}"${i ? "" : ' aria-current="true"'}></button>`).join("")}</div>` : ""}</section>` : "";
  const body = `<section class="hero"><div>
<span class="proto">${esc(REGION)}</span>
<h1>Flohmarkt Hamburg: alle Termine, aufgeräumt.</h1>
<p>Alle Flohmärkte in Hamburg und Umgebung: wann, wo und wie lange. Ohne Werbebanner, ohne alte Termine.</p>
<div class="quick"><a class="chip" href="/heute/">${ic("sun")}Heute</a><a class="chip" href="/wochenende/">${ic("cal")}Wochenende</a><a class="chip" href="/sonntag/">${ic("cal")}Sonntag</a><a class="chip" href="/flohmaerkte/">${ic("map")}Märkte nach Bezirk</a>${HAS_MAP ? `<a class="chip" href="/flohmaerkte/#karte">${ic("pin")}Karte</a>` : ""}<a class="chip" href="/ratgeber/">${ic("book")}Ratgeber</a><a class="chip" href="/flohmarkt-schilder/">${ic("printer")}Schilder gestalten</a></div>
</div><a class="big-sticker" href="/wochenende/"><b>${weN}</b><span>${weLabel}</span></a></section>
${slider}
${rainBox(upcoming(4)) || frogLine(upcoming(5))}
${tip ? `<a class="cta-box tip" href="${tip[2]}">${ic("star")}<span><b>${esc(tip[0])}: ${esc(tip[1])}</b>Tipp des Tages, jede Nacht neu aus dem Kalender.</span>${ic("chev")}</a>` : ""}
<section class="sec"><div class="sec-head"><h2>Die nächsten Flohmärkte</h2>${more("/termine/", "Alle")}</div>
${groupList(next, 3) || '<div class="empty">Gerade stehen keine Termine im Kalender.</div>'}
${all14 > next.length ? `<a class="more" href="/termine/">Alle ${all14} Termine der nächsten 14 Tage anzeigen</a>` : ""}</section>
<section class="sec"><div class="sec-head"><h2>Flohmärkte nach Bezirk und Region</h2>${more("/flohmaerkte/", "Alle", "Alle Märkte")}</div>${regionChips()}</section>
${CATS_ON.length ? `<section class="sec"><div class="sec-head"><h2>Flohmärkte nach Art</h2></div>${catChips()}</section>` : ""}
${MONTHS.length ? `<section class="sec"><div class="sec-head"><h2>Termine nach Monat</h2>${more("/termine/", "Alle")}</div>${monthChips()}</section>` : ""}
${NEWS.length ? `<section class="sec"><div class="sec-head"><h2>Neuigkeiten</h2></div>${grid(NEWS.map(n => `<a class="card" href="${esc(safeHref(n["Link"], "Neuigkeiten: " + n["Titel"]) || "/")}"><span class="kicker">${esc(n["Kicker"])}</span><h3>${esc(n["Titel"])}</h3><p>${esc(n["Text"])}</p></a>`))}</section>` : ""}
<section class="sec kb-body home-seo"><h2>Flohmarkt in Hamburg: das Wichtigste</h2>${homeText.map(x => `<p>${rich(x)}</p>`).join("")}</section>
${faqBlock(homeFaq, "Häufige Fragen zu Flohmärkten in Hamburg")}
<section class="sec"><div class="sec-head"><h2>Aus dem Ratgeber</h2>${more("/ratgeber/", "Alle", "Alle Ratgeber-Artikel")}</div>${grid(KB.filter(a => a.top).map(a => `<a class="card" href="/ratgeber/${a.s}/"><span class="kicker">${esc(CLUSTERS[a.c]?.t || "")}</span><h3>${brColon(esc(a.h))}</h3></a>`))}</section>
<section class="sec"><a class="promo" href="/flohmarkt-schilder/"><span class="promo-txt"><span class="kicker">Schilder-Designer, gratis</span><b>Gestalte deine Verkaufsschilder</b><span>Preisschilder, „Alles 1 €“, „Handeln erwünscht“ und mehr. Vorlage wählen, Text eintippen, ausdrucken.</span><span class="promo-go">Zum Schilder-Designer${ic("chev")}</span></span><img src="/assets/schilder/flohmarkt-alles-1-euro-vorlage.svg" width="297" height="210" alt="Vorlage: Alles-1-Euro-Schild für den Flohmarkt" loading="lazy" decoding="async"></a></section>
${INSTA ? `<section class="sec"><a class="cta-box insta" href="${INSTA}" rel="noopener me">${ic("share")}<span><b>Jeden Donnerstag: dein Flohmarkt-Wochenende auf Instagram</b>${esc(INSTA_AT)} folgen und nichts verpassen.</span>${ic("chev")}</a></section>` : ""}
<section class="sec" id="veranstalter"><div class="org"><h2>Du veranstaltest einen Flohmarkt?</h2><p>Trag deinen Termin kostenlos ein. Wir prüfen jeden Eintrag, bevor er erscheint.</p><a class="btn" href="/veranstalter/">Termin eintragen${ic("chev")}</a></div></section>`;
  layout({ p: "/", title: `Flohmarkt Hamburg: Alle Flohmärkte & Termine ${YEAR} | ${NAME}`,
    desc: pickDesc(`Alle ${MARKETS.length} Flohmärkte in Hamburg und Umgebung mit Terminen, Uhrzeiten und Adressen.${weN ? ` ${sunOnly ? "Heute" : "Am Wochenende"}: ${weN} Märkte.` : ""} Täglich aktualisiert, ohne Werbung.`, "Alle Flohmärkte in Hamburg und Umgebung, aufgeräumt: Termine, Zeiten, Adressen und ein Ratgeber mit Antworten auf die wichtigsten Flohmarkt-Fragen."),
    body, nav: "", ld: G([{ "@type": "WebSite", "@id": SITE + "/#website", name: NAME, url: SITE + "/", inLanguage: "de", publisher: { "@id": SITE + "/#org" } }, { "@type": "Organization", "@id": SITE + "/#org", name: NAME, url: SITE + "/", logo: SITE + "/assets/icon.svg", ...(INSTA ? { sameAs: [INSTA] } : {}) }, faqLD(homeFaq)]) });
}

/* ---------------------------------------------------------------- Alle Termine */
{
  const evs = upcoming(60);
  const body = crumbs([[NAME, "/"], ["Termine"]]) + `<section class="hub-head"><h1>Flohmarkt-Termine in Hamburg und Umgebung</h1><p>Alle Termine der nächsten 60 Tage in Hamburg und im Umland bis 30 Kilometer, nach Tagen sortiert.</p>
<div class="chips" id="filter" role="group" aria-label="Art des Markts"><button class="chip" type="button" data-t="" aria-pressed="true">Alle Arten</button>${[...TIME_TAGS, ...TAGS_ALL].map(t => `<button class="chip" type="button" data-t="${esc(t)}" aria-pressed="false">${tagIc(t)}${esc(t)}</button>`).join("")}</div>${nearBox()}</section>
<div id="liste">${groupList(evs)}</div><div class="empty" id="leer" hidden>Keine Märkte dieser Art in den nächsten 60 Tagen.</div>
${MONTHS.length ? `<section class="related"><div class="sec-head"><h2>Termine nach Monat</h2></div>${monthChips()}</section>` : ""}
<section class="related"><div class="sec-head"><h2>Nach Art des Markts</h2></div>${catChips()}</section>
<section class="related"><div class="sec-head"><h2>Nach Bezirk und Zeitraum</h2></div>${regionChips("/termine/")}</section>`;
  layout({ p: "/termine/", title: `Flohmarkt Hamburg Termine ${yearSpan(evs)}: die nächsten 60 Tage | ${NAME}`,
    desc: pickDesc(`Alle ${evs.filter(e => !e.cancelled).length} Flohmarkttermine in Hamburg und Umgebung für die nächsten 60 Tage: ${new Set(evs.map(e => e.m)).size} Märkte mit Uhrzeit, Adresse und Veranstalter.`, "Alle Flohmarkt-Termine in Hamburg und im Umland bis 30 Kilometer für die nächsten 60 Tage, mit Uhrzeiten, Adressen und Veranstaltern."), body, nav: "termine", ld: G([crumbLD([[NAME, "/"], ["Termine"]])].concat(evs.slice(0, 60).map(eventLD))) });
}

/* ---------------------------------------------------------------- Alle Märkte */
{
  const body = crumbs([[NAME, "/"], ["Alle Märkte"]]) + `<section class="hub-head"><h1>Alle Flohmärkte in Hamburg und Umgebung</h1><p>${MARKETS.length} Märkte in Hamburg und im Umland bis 30 Kilometer, sortiert nach Bezirk und Region.</p>${catChips()}${nearBox("Märkte")}</section>
${HAS_MAP ? `<section class="map-sec" id="karte"><div class="sec-head"><h2>Alle Märkte auf der Karte</h2></div><div class="map-box" id="mapBox"><div class="map-consent"><p><b>Karte laden?</b> Die Karte zeigt alle Märkte mit Kartenbildern von OpenStreetMap. Erst beim Laden wird deine IP-Adresse an die OpenStreetMap Foundation übertragen. Mehr dazu in den <a href="/datenschutz/">Datenschutzhinweisen</a>.</p><button class="btn" id="mapLoad" type="button">${ic("map")}Karte laden</button></div></div>
<script type="application/json" id="mapData">${JSON.stringify(MARKETS.filter(m => m.ll).map(m => { const n = m.events.find(e => !e.cancelled); return [m.name, m.slug, m.area, m.ll[0], m.ll[1], n ? fmtShort(n.date) + (n.start ? ", " + timeText(n) : "") : "", m.rhythm]; })).replace(/</g, "\\u003c")}</script>
<p class="small meta">Die Punkte zeigen die ungefähre Lage. Die genaue Adresse steht auf der Seite des Markts.</p></section>` : ""}
${REGIONS.map(r => { const ms = MARKETS.filter(m => m.bez === r.k); return ms.length ? `<section class="cluster"><div class="sec-head"><h2>${esc(r.name)}</h2>${more(`/flohmarkt-hamburg/${r.k}/`, r.umland ? "Zur Region" : "Zum Bezirk", "Seite " + r.name)}</div><div class="qlist">${ms.map(m => `<a href="/flohmarkt/${m.slug}/"${llAttr(m)}><span>${esc(m.name)}<small class="meta">${esc(m.area)} · ${esc(m.rhythm)}</small></span>${ic("chev")}</a>`).join("")}</div></section>` : ""; }).join("")}`;
  layout({ p: "/flohmaerkte/", title: `Flohmärkte in Hamburg und Umgebung: alle ${MARKETS.length} Märkte | ${NAME}`, desc: `Alle ${MARKETS.length} Flohmärkte in Hamburg und im Umland bis 30 Kilometer auf einen Blick, sortiert nach Bezirk und Region, mit Rhythmus und Terminen.`, body, nav: "maerkte", ld: G([crumbLD([[NAME, "/"], ["Alle Märkte"]]), { "@type": "ItemList", itemListElement: MARKETS.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name, url: `${SITE}/flohmarkt/${m.slug}/` })) }]) });
}

/* ---------------------------------------------------------------- Marktseiten */
for (const m of MARKETS) {
  const r = RBY[m.bez] || { name: m.bez, im: "", umland: false, k: m.bez };
  const nx = m.events.slice(0, 8), first = m.events.find(e => !e.cancelled);
  const route = "https://www.google.com/maps/dir/?api=1&amp;travelmode=transit&amp;destination=" + encodeURIComponent(m.name + ", " + m.addr);
  const others = MARKETS.filter(x => x.bez === m.bez && x !== m);
  const singleDates = !m.when && m.events.filter(e => !e.cancelled).length === 1;
  const when = whenOf(m);
  const far = !first && m.later ? m.later[0] : null;
  const timeVariants = new Set(m.events.filter(e => !e.cancelled).map(timeText));
  const mixed = timeVariants.size > 1;
  const answer = when ? `${esc(m.satz)} findet ${esc(when)}${first && first.start && !mixed && /^am [A-Za-zä]+, /.test(when) ? "," : ""}${first && first.start && !mixed ? (first.end ? ` von ${hmText(first.start)} bis ${hmText(first.end)} Uhr` : ` ab ${hmText(first.start)} Uhr`) : ""} statt. Adresse: ${esc(m.addr)}. ${first ? (singleDates ? "" : "Nächster Termin: " + fmtDate(first.date) + (mixed && first.start ? ", " + (first.end ? `${hmText(first.start)} bis ${hmText(first.end)} Uhr` : `ab ${hmText(first.start)} Uhr`) : "") + ".") : ""}`
    : far ? `${esc(m.satz)} findet das nächste Mal am ${fmtDateY(far.date)}${far.start ? (far.end ? ` von ${hmText(far.start)} bis ${hmText(far.end)} Uhr` : ` ab ${hmText(far.start)} Uhr`) : ""} statt.${m.later.length > 1 ? ` Danach: ${m.later.slice(1, 4).map(x => fmtDateY(x.date)).join("; ")}.` : ""} Adresse: ${esc(m.addr)}.`
    : `${esc(m.satz)} hat derzeit keinen angekündigten Termin. Adresse: ${esc(m.addr)}.`;
  // Häufige Fragen aus den Daten (nur Fakten, die im Kalender stehen)
  const nom = m.satz.replace(/^(Der|Die|Das) /, a => a.toLowerCase());
  const bei = /^Der |^Das /.test(m.satz) ? "beim " + m.satz.slice(4) : /^Die /.test(m.satz) ? "bei der " + m.satz.slice(4) : "bei " + m.satz;
  const tNext = first ? `${fmtDate(first.date)}${first.start ? ", " + timeText(first) : ""}` : "";
  const mFaq = [
    ...(first ? [[`Wann findet ${nom} das nächste Mal statt?`, `Der nächste Termin ist am ${tNext}.${m.events.filter(e => !e.cancelled).length > 1 ? " Alle weiteren Termine stehen oben unter „Nächste Termine“." : ""}`]] : [[`Wann findet ${nom} wieder statt?`, "Derzeit ist kein Termin angekündigt. Sobald der Veranstalter neue Termine veröffentlicht, stehen sie hier."]]),
    ...(first && first.start && !mixed ? [[`Wie lange hat ${nom} geöffnet?`, `${first.end ? `Von ${hmText(first.start)} bis ${hmText(first.end)} Uhr` : `Ab ${hmText(first.start)} Uhr`}, so steht es beim nächsten Termin. Wer früh kommt, hat die größte Auswahl.`]] : []),
    [`Wo findet ${nom} statt?`, `${m.place !== m.name ? m.place + ", " : ""}${m.addr}${m.oepnv ? `. Nächste Haltestelle: ${m.oepnv}` : ""}.`],
    ...(m.tags.includes("Überdacht") ? [[`Findet ${nom} auch bei Regen statt?`, `Der Markt ist ganz oder teilweise überdacht. Kurzfristige Absagen sind trotzdem möglich, schau am besten vorher beim Veranstalter nach.`]] : []),
    [`Wie bekomme ich einen Stand ${bei}?`, `Standplätze vergibt der Veranstalter${m.org ? " " + m.org : ""}. Frag am besten dort nach, wie die Anmeldung läuft${m.web ? `: [Website des Veranstalters](${m.web})` : ""}. Tipps für deinen Stand stehen im Ratgeber ${KBY["flohmarktstand-anmelden"] ? "[Flohmarktstand anmelden](/ratgeber/flohmarktstand-anmelden/)" : "Verkaufen"}.`]
  ];
  const Ym = yearSpan(m.events.filter(e => !e.cancelled).slice(0, 1).length ? [first] : []);
  const baseT = m.t || `${m.name}: Termine & Öffnungszeiten`;
  const mTitle = !first || /20\d\d/.test(baseT) || (baseT + " " + Ym).length > 60 ? baseT : /\bTermine?\b/.test(baseT) ? baseT.replace(/\bTermine?\b/, x => `${x} ${Ym}`) : `${baseT} ${Ym}`;
  const mDesc = first ? pickDesc(
      fresh(m.d) && `Nächster Termin: ${dDate(first.date)}${first.start ? ", " + timeText(first) : ""}. ${m.d}`,
      `${m.name}${m.name.includes(m.area) ? "" : ` (${m.area})`}: nächster Termin ${dDate(first.date)}${first.start ? ", " + timeText(first) : ""}. ${m.note || ""} Adresse und Anfahrt.`,
      `${m.name}${m.name.includes(m.area) ? "" : ` in ${m.area}`}: nächster Termin ${dDate(first.date)}${first.start ? ", " + timeText(first) : ""}. Alle Termine ${Ym}, Adresse, Anfahrt und Tipps für deinen Besuch.`,
      `${m.name}: nächster Termin ${dDate(first.date)}. Alle Termine ${Ym}, Uhrzeiten, Adresse und Anfahrt.`)
    : pickDesc(fresh(m.d), `${m.name} in ${m.area}: ${m.note || ""} Neue Termine folgen, sobald der Veranstalter sie veröffentlicht. Adresse und Anfahrt.`, `${m.name}: ${m.note || ""} Adresse, Anfahrt und neue Termine, sobald der Veranstalter sie veröffentlicht.`, `${m.name}: Adresse, Anfahrt und alle Termine, sobald der Veranstalter sie veröffentlicht. Täglich aktualisiert.`, `${m.short}: Adresse, Anfahrt und neue Termine, sobald der Veranstalter sie veröffentlicht.`);
  const body = crumbs([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name, `/flohmarkt-hamburg/${r.k}/`], [m.short]]) + `<article class="kb">
<h1>${esc(m.name)}: Öffnungszeiten und Termine</h1>
<div class="byline"><span>${ic("pin")}${esc(m.area)}</span><span>${ic("map")}${esc(regionLabel(r))}</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${answer}</p></div>
<dl class="facts"><div><dt>${ic("cal")}Wann</dt><dd>${esc(cap(when) || (far ? m.later.slice(0, 4).map(x => fmtDateY(x.date)).join(" · ") : "Derzeit kein Termin"))}</dd></div><div><dt>${ic("clock")}Uhrzeit</dt><dd>${!first ? (far && far.start ? timeText(far) : "–") : mixed ? "je nach Termin, siehe unten" : timeText(first)}</dd></div>
<div><dt>${ic("pin")}Adresse</dt><dd>${addrNb(m.addr)}<br><a class="route" href="${route}" rel="noopener">${ic("route")}Route planen</a></dd></div>
${m.oepnv ? `<div><dt>${ic("tram")}Nächste Haltestelle</dt><dd>${esc(m.oepnv)}</dd></div>` : ""}${m.org || m.web ? `<div><dt>${ic("user")}Veranstalter</dt><dd>${esc(m.org)}${m.web ? `${m.org ? "<br>" : ""}<a href="${esc(m.web)}" rel="noopener">Website des Veranstalters</a>` : ""}</dd></div>` : ""}${m.tags.length ? `<div><dt>${ic("tag")}Art des Markts</dt><dd class="tags-dd">${m.tags.map(t => CAT_BY_TAG[t] ? `<a class="tag" href="/${CAT_BY_TAG[t].s}/">${tagIc(t)}${esc(t)}</a>` : `<span class="tag">${tagIc(t)}${esc(t)}</span>`).join(" ")}</dd></div>` : ""}</dl>
<div class="share-row">${shareBtn(m, first, "btn share-big")}<a class="route" href="${route}" rel="noopener">${ic("route")}Route planen</a></div>${first ? wxSay(wxEv(first), "für " + (first.k === key(TODAY) ? "heute" : first.k === key(addDays(TODAY, 1)) ? "morgen" : WDL[first.date.getUTCDay()])) : ""}
${m.intro ? `<section class="block kb-body"><h2>Über den Markt</h2><p>${rich(m.intro)}</p></section>` : ""}
<section class="block"><h2>Nächste Termine</h2>${nx.length ? `<ul class="dates">${nx.map(e => `<li${e.cancelled ? ' class="off"' : ""}><span class="dt">${fmtDate(e.date)}</span><span class="tm">${e.cancelled ? "fällt aus" : timeText(e)}</span>${e.note ? `<span class="meta">${esc(e.note)}</span>` : ""}</li>`).join("")}</ul>` : '<p class="meta">Die nächsten Termine sind noch nicht angekündigt.</p>'}</section>
${m.tips.length ? `<section class="block kb-body"><h2>Gut zu wissen</h2><ul class="tips">${m.tips.map(t => `<li>${rich(t)}</li>`).join("")}</ul></section>` : ""}
${m.hint ? `<p class="hint">${rich(m.hint)}</p>` : ""}
${faqBlock(mFaq, `Häufige Fragen zu ${esc(m.short)}`)}
<p class="hint">Angaben nach öffentlichen Informationen des Veranstalters${m.web ? ` (<a href="${esc(m.web)}" rel="noopener">Website</a>)` : ""}, ohne Gewähr. Märkte können kurzfristig ausfallen. Du veranstaltest diesen Markt? <a href="/veranstalter/#korrektur">Eintrag ändern oder entfernen lassen</a>.</p>
<section class="related"><div class="sec-head"><h2>Tipps für deinen Besuch</h2>${more("/ratgeber/", "Ratgeber")}</div>${grid(kbFor(m).map(kbCard))}</section>
<section class="related"><div class="sec-head"><h2>Weitere Flohmärkte ${esc(r.im)}</h2>${more(`/flohmarkt-hamburg/${r.k}/`, "Alle", "Alle Märkte " + r.im)}</div>${others.length ? grid(others.map(mCard)) : '<p class="meta">Weitere Märkte folgen.</p>'}</section>
${others.length < 2 ? (() => { const nb = (NEAR[m.bez] || []).flatMap(k => MARKETS.filter(x => x.bez === k && x.events.some(e => !e.cancelled))).sort((a, b) => a.events.find(e => !e.cancelled).k.localeCompare(b.events.find(e => !e.cancelled).k)).slice(0, 3); return nb.length ? `<section class="related"><div class="sec-head"><h2>Flohmärkte in der Nähe</h2></div>${grid(nb.map(mCard))}</section>` : ""; })() : ""}</article>`;
  if (!m.t) warn("SEO", `${m.name}: SEO-Titel fehlt.`);
  layout({ p: `/flohmarkt/${m.slug}/`, title: `${mTitle} | ${NAME}`, desc: mDesc, body, nav: "maerkte", ld: G([crumbLD([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name, `/flohmarkt-hamburg/${r.k}/`], [m.name]]), faqLD(mFaq)].concat(nx.map(eventLD))) });
}

/* ---------------------------------------------------------------- Bezirke und Regionen */
for (const r of REGIONS) {
  const ms = MARKETS.filter(m => m.bez === r.k), ev30 = upcoming(31, e => e.m.bez === r.k);
  const longList = ev30.filter(e => !e.cancelled).length < 3, ev = longList ? EVENTS.filter(e => e.m.bez === r.k).slice(0, 12) : ev30, first = ev.find(e => !e.cancelled);
  // Märkte, die in der Einleitung aus dem Sheet (noch) nicht verlinkt sind, werden automatisch ergänzt
  const missing = ms.filter(m => !(r.intro || "").includes(`/flohmarkt/${m.slug}/`));
  // In der Nähe: Märkte aus Nachbarbezirken mit den nächsten Terminen
  const near = (NEAR[r.k] || []).flatMap(k => MARKETS.filter(m => m.bez === k && m.events.some(e => !e.cancelled))).sort((a, b) => a.events.find(e => !e.cancelled).k.localeCompare(b.events.find(e => !e.cancelled).k)).slice(0, ms.length < 3 ? 6 : 3);
  const Yr = yearSpan(upcoming(60, e => e.m.bez === r.k && !e.cancelled).length ? upcoming(60, e => e.m.bez === r.k && !e.cancelled) : EVENTS.filter(e => e.m.bez === r.k && !e.cancelled));
  const rDesc = pickDesc(
    `${cap(r.im)}: ${ms.length === 1 ? "ein Flohmarkt" : ms.length + " Flohmärkte"}, ${listNames(ms.map(m => m.short), 3)}${ms.length > 3 ? " und weitere" : ""}.${first ? ` Nächster Termin ${dDate(first.date)}.` : ""} Alle Termine ${Yr}.`,
    `Alle ${ms.length === 1 ? "Flohmärkte" : ms.length + " Flohmärkte"} ${r.im} mit Terminen ${Yr}, Uhrzeiten und Adressen.${first ? ` Nächster Termin: ${first.m.short} am ${dDate(first.date)}.` : ""}`,
    fresh(r.d));
  const body = crumbs([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name]]) + `<article class="kb"><h1>${esc(r.h)}</h1>
<div class="byline"><span>${ic("map")}${esc(regionLabel(r))}</span><span>${ic("pin")}${ms.length === 1 ? "1 Markt" : ms.length + " Märkte"}</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(cap(r.im))} ${ms.length === 1 ? "steht ein Flohmarkt" : `stehen ${ms.length} Flohmärkte`} im ${esc(NAME)}-Kalender.${first ? ` Der nächste Termin: ${esc(first.m.name)} am ${fmtDate(first.date)}, ${timeText(first)}.` : ""}</p></div>
${r.intro || missing.length ? `<section class="block kb-body"><p>${rich(r.intro || "")}${missing.length ? `${r.intro ? " " : ""}Außerdem ${r.im}: ${listNames(missing.map(m => `[${m.name}](/flohmarkt/${m.slug}/)`), 8)}.` : ""}</p></section>` : ""}
<section class="related"><div class="sec-head"><h2>Die Märkte</h2></div>${grid(ms.map(mCard))}</section>
<section class="related"><div class="sec-head"><h2>Nächste Termine</h2><small>${longList ? "alle bekannten Termine" : "nächste 30 Tage"}</small></div>${groupList(ev, 3) || '<p class="meta">Derzeit sind keine Termine angekündigt.</p>'}</section>
${near.length ? `<section class="related"><div class="sec-head"><h2>Flohmärkte in der Nähe</h2></div>${grid(near.map(mCard))}</section>` : ""}
${CATS_ON.some(c => c.ms.some(m => m.bez === r.k)) ? `<section class="related"><div class="sec-head"><h2>Nach Art des Markts</h2></div>${catChips(null, m => m.bez === r.k)}</section>` : ""}
<section class="related"><div class="sec-head"><h2>Weitere Bezirke und Zeiträume</h2></div>${regionChips(`/flohmarkt-hamburg/${r.k}/`)}</section>
<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2></div>${grid(["flohmaerkte-hamburg", "flohmarkt-knigge"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p: `/flohmarkt-hamburg/${r.k}/`, title: `${r.t} | ${NAME}`, desc: rDesc, body, nav: "maerkte", noindex: !ms.some(m => m.events.some(e => !e.cancelled)), ld: G([crumbLD([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name]]), { "@type": "ItemList", itemListElement: ms.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name, url: `${SITE}/flohmarkt/${m.slug}/` })) }].concat(ev.map(eventLD))) });
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
      const lt = live(key(TODAY));
      return { h: "Flohmarkt Hamburg heute", sub: fmtDate(TODAY), t: "Flohmarkt Hamburg heute: Welche Märkte haben geöffnet?", evs, ans,
        d: pickDesc(lt.length === 1 ? `Heute, ${dDate(TODAY)}, hat in Hamburg ein Flohmarkt geöffnet: ${lt[0].m.name}${lt[0].start ? ", " + timeText(lt[0]) : ""}. Adresse, Anfahrt und die nächsten Termine.` : lt.length ? `Heute, ${dDate(TODAY)}: ${lt.length} Flohmärkte in Hamburg und Umgebung geöffnet${darunter(lt)}. Mit Uhrzeit und Adresse.` : "",
          "Welche Flohmärkte haben heute in Hamburg geöffnet? Tagesaktuelle Übersicht mit Uhrzeiten und Adressen, und falls heute nichts ist, der nächste Termin."),
        next: ["/morgen/", "Und morgen? Alle Flohmärkte von morgen"] };
    },
    wochenende: () => {
      const { sat, sun, sunOnly } = weekendDays(), a = sunOnly ? [] : live(key(sat)), b = live(key(sun));
      const evs = (sunOnly ? [] : (byDay.get(key(sat)) || [])).concat(byDay.get(key(sun)) || []), n = a.length + b.length, c = x => x === 0 ? "keiner" : x === 1 ? "einer" : String(x);
      const ans = sunOnly
        ? `Heute, am Sonntag, ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}, ${b.length === 0 ? "findet laut Kalender kein Flohmarkt" : b.length === 1 ? "findet ein Flohmarkt" : "finden " + b.length + " Flohmärkte"} in Hamburg und im Umland statt.${b.length ? " " + names(b) + "." : ""}`
        : `Am Wochenende ${sat.getUTCDate()}. und ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]} ${n === 1 ? "findet ein Flohmarkt" : "finden " + n + " Flohmärkte"} in Hamburg und im Umland statt, ${c(a.length)} am Samstag und ${c(b.length)} am Sonntag.`;
      return { h: "Flohmarkt Hamburg am Wochenende", sub: sunOnly ? `Sonntag, ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}` : `${sat.getUTCDate()}. und ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}`, t: "Flohmarkt Hamburg am Wochenende: alle Termine", evs, ans,
        d: pickDesc(n ? (sunOnly ? `Heute, am Sonntag: ${b.length} Flohmärkte in Hamburg und Umgebung${darunter(b)}. Alle Termine mit Uhrzeit und Adresse.` : `Am Wochenende ${sat.getUTCDate()}./${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}: ${n} Flohmärkte in Hamburg und Umgebung, ${a.length} am Samstag und ${b.length} am Sonntag. Alle Termine mit Uhrzeit.`) : "",
          "Alle Flohmärkte in Hamburg am kommenden Wochenende, Samstag und Sonntag, mit Uhrzeiten, Adressen und Links zu jedem Markt. Täglich aktualisiert.") };
    },
    sonntag: () => {
      const s0 = addDays(TODAY, (7 - TODAY.getUTCDay()) % 7), ks = [0, 7, 14, 21].map(n => key(addDays(s0, n))), first = live(ks[0]);
      return { h: "Flohmarkt Hamburg am Sonntag", sub: "ab " + fmtDate(s0), t: "Flohmarkt Hamburg Sonntag: die nächsten Termine", evs: ks.flatMap(k => byDay.get(k) || []),
        d: pickDesc(first.length ? `Flohmarkt in Hamburg am Sonntag: Am ${dDate(s0)} öffnen ${first.length === 1 ? "ein Markt" : first.length + " Märkte"}${darunter(first)}. Alle Sonntagstermine mit Uhrzeit.` : "",
          "Flohmarkt in Hamburg am Sonntag: die nächsten Sonntagstermine mit Uhrzeiten und Adressen, in der Stadt und im Umland bis 30 Kilometer."),
        ans: (first.length ? `Am ${fmtDate(s0)} ${first.length === 1 ? "findet ein Flohmarkt" : "finden " + first.length + " Flohmärkte"} in Hamburg und im Umland statt: ${names(first)}.` : "Am kommenden Sonntag steht kein Flohmarkt im Kalender.") + " In der Stadt sind es sonntags vor allem Nachbarschaftsmärkte, im Umland kommen viele Märkte auf Bau- und Supermarktparkplätzen dazu." };
    },
    samstag: () => {
      const s0 = addDays(TODAY, (6 - TODAY.getUTCDay() + 7) % 7), ks = [0, 7, 14, 21].map(n => key(addDays(s0, n))), first = live(ks[0]);
      return { h: "Flohmarkt Hamburg am Samstag", sub: "ab " + fmtDate(s0), t: "Flohmarkt Hamburg Samstag: die nächsten Termine", evs: ks.flatMap(k => byDay.get(k) || []),
        d: pickDesc(first.length ? `Flohmarkt in Hamburg am Samstag: Am ${dDate(s0)} öffnen ${first.length === 1 ? "ein Markt" : first.length + " Märkte"}${darunter(first)}. Alle Samstagstermine mit Uhrzeit.` : "",
          "Flohmarkt in Hamburg am Samstag: die nächsten Samstagstermine mit Uhrzeiten und Adressen, in der Stadt und im Umland bis 30 Kilometer."),
        ans: (first.length ? `Am ${fmtDate(s0)} ${first.length === 1 ? "findet ein Flohmarkt" : "finden " + first.length + " Flohmärkte"} in Hamburg und im Umland statt: ${names(first)}.` : "Am kommenden Samstag steht kein Flohmarkt im Kalender.") + " Der Samstag ist in Hamburg der wichtigste Flohmarkttag, viele Märkte beginnen schon früh am Morgen." };
    },
    morgen: () => {
      const d = addDays(TODAY, 1), k = key(d), lv = live(k);
      let evs = byDay.get(k) || [], ans;
      if (lv.length) ans = `Morgen, ${fmtDate(d)}, ${lv.length === 1 ? "hat ein Flohmarkt" : "haben " + lv.length + " Flohmärkte"} in Hamburg und im Umland geöffnet: ${names(lv)}.`;
      else { const nk = [...byDay.keys()].sort().find(x => x > k && live(x).length); evs = nk ? byDay.get(nk) : []; ans = `Morgen, ${fmtDate(d)}, findet laut Kalender kein Flohmarkt in Hamburg und im Umland statt.${nk ? ` Der nächste Markttag ist ${fmtDate(evs[0].date)}: ${names(live(nk))}.` : ""}`; }
      return { h: "Flohmarkt Hamburg morgen", sub: fmtDate(d), t: "Flohmarkt Hamburg morgen: Welche Märkte öffnen?", evs, ans,
        d: pickDesc(lv.length === 1 ? `Morgen, ${dDate(d)}, hat in Hamburg ein Flohmarkt geöffnet: ${lv[0].m.name}${lv[0].start ? ", " + timeText(lv[0]) : ""}. Adresse, Anfahrt und die nächsten Termine.` : lv.length ? `Morgen, ${dDate(d)}: ${lv.length} Flohmärkte in Hamburg und Umgebung${darunter(lv)}. Mit Uhrzeit und Adresse.` : "",
          "Welche Flohmärkte haben morgen in Hamburg geöffnet? Übersicht mit Uhrzeiten und Adressen, und falls morgen nichts ist, der nächste Termin."),
        next: ["/heute/", "Zurück zu heute: alle Flohmärkte von heute"] };
    }
  };
  for (const [k, fn] of Object.entries(Z)) {
    const z = fn();
    const body = crumbs([[NAME, "/"], ["Termine", "/termine/"], [z.h.replace("Flohmarkt Hamburg ", "")]]) + `<article class="kb"><h1>${z.h}</h1><div class="byline"><span>${ic("cal")}${esc(z.sub)}</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(z.ans)}</p></div>${rainBox(z.evs)}${nearBox()}<section class="block">${groupList(z.evs) || '<p class="meta">Keine Termine im Kalender.</p>'}</section>${z.next ? `<a class="more" href="${z.next[0]}">${z.next[1]}</a>` : ""}
<section class="related"><div class="sec-head"><h2>Weitere Zeiträume und Bezirke</h2></div>${regionChips(`/${k}/`)}</section>
<section class="related"><div class="sec-head"><h2>Vor dem Besuch lesen</h2></div>${grid(["beste-uhrzeit-flohmarkt", "was-mitnehmen-flohmarkt", "flohmarkt-knigge"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
    layout({ p: `/${k}/`, title: `${z.t} | ${NAME}`, desc: z.d, body, nav: "termine", ld: G([crumbLD([[NAME, "/"], ["Termine", "/termine/"], [z.h]])].concat(z.evs.map(eventLD))) });
  }
}

/* ---------------------------------------------------------------- Seiten nach Art des Markts */
const CAT_FORM = { "antikmarkt-hamburg": "", "frauenflohmarkt-hamburg": "links", "nachbarschaftsflohmarkt-hamburg": "rund", "groesste-flohmaerkte-hamburg": "rund links" };
for (const c of CATS_ON) {
  const p = `/${c.s}/`, ms = [...c.ms].sort((a, b) => ((a.events.find(e => !e.cancelled) || {}).k || "9").localeCompare((b.events.find(e => !e.cancelled) || {}).k || "9"));
  const ev60 = upcoming(60, e => c.ms.includes(e.m)), nx = nextOf(c.evs), Y = yearSpan(ev60.filter(e => !e.cancelled).length ? ev60.filter(e => !e.cancelled) : c.evs);
  const cr = [[NAME, "/"], ["Alle Märkte", "/flohmaerkte/"], [c.chip]];
  const withEv = ms.filter(m => m.events.some(e => !e.cancelled));
  const ans = `In Hamburg und Umgebung ${c.ms.length === 1 ? "steht ein Markt" : `stehen ${c.ms.length} ${c.pl}`} im ${NAME}-Kalender${withEv.length < c.ms.length ? `, ${withEv.length} davon mit angekündigten Terminen` : ""}.${nx ? ` Der nächste Termin: ${nx.m.name} am ${fmtDate(nx.date)}${nx.start ? ", " + timeText(nx) : ""}.` : " Neue Termine folgen, sobald die Veranstalter sie veröffentlichen."}`;
  const faq = [...(nx ? [[`Wann ist der nächste Termin?`, `${nx.m.name} am ${fmtDate(nx.date)}${nx.start ? ", " + timeText(nx) : ""}. Alle weiteren Termine stehen oben in der Liste.`]] : []),
    [`Welche ${c.pl} gibt es in Hamburg?`, `${listMore(ms.map(m => `[${m.name}](/flohmarkt/${m.slug}/)`), 6)}.`], ...c.f];
  const desc = pickDesc(
    `${cap(c.pl)} in Hamburg und Umgebung: ${c.ms.length} Märkte${nx ? `, nächster Termin ${dDate(nx.date)}` : ""}. Alle Termine ${Y} mit Uhrzeit, Adresse und Anfahrt.`,
    `${cap(c.pl)} in Hamburg und Umgebung: ${c.ms.length} Märkte mit allen Terminen ${Y}, Uhrzeiten und Adressen. Täglich aktualisiert.`,
    `Alle ${c.pl} in Hamburg: ${c.ms.length} Märkte mit Terminen ${Y}, Uhrzeiten und Adressen.`);
  const body = crumbs(cr) + `<article class="kb"><h1>${esc(c.h1)}</h1>
<div class="byline"><span>${ic("pin")}${c.ms.length} Märkte</span><span>${ic("cal")}${c.evs.filter(e => !e.cancelled).length} Termine</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(ans)}</p></div>${nearBox()}
<section class="related"><div class="sec-head"><h2>Nächste Termine</h2><small>nächste 60 Tage</small></div>${groupList(ev60, 3) || '<p class="meta">In den nächsten 60 Tagen keine Termine. Die Märkte unten melden neue Termine meist rechtzeitig vorher.</p>'}</section>
<section class="related"><div class="sec-head"><h2>Alle Märkte im Überblick</h2></div>${grid(ms.map(mCard))}</section>
<div class="kb-body">${sideImg(`seite-${c.s}`, CAT_FORM[c.s] ?? ["", "rund", "links", "rund links"][CATS_ON.indexOf(c) % 4])}<p class="intro">${esc(c.lead)}</p>${c.b().map(([h, x]) => `<h2>${esc(h)}</h2><p>${rich(x)}</p>`).join("")}</div>
${faqBlock(faq)}
<section class="related"><div class="sec-head"><h2>Weitere Arten von Flohmärkten</h2></div>${catChips(c.s)}</section>
<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2></div>${grid(c.kb.filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p, title: `${c.t(Y)} | ${NAME}`, desc, body, nav: "maerkte", ld: G([crumbLD(cr), { "@type": "ItemList", itemListElement: ms.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name, url: `${SITE}/flohmarkt/${m.slug}/` })) }, faqLD(faq)].concat(ev60.slice(0, 40).map(eventLD))) });
}

/* ---------------------------------------------------------------- Monatsseiten */
for (const mo of MONTHS) {
  const p = `/${mo.s}/`, live = mo.evs.filter(e => !e.cancelled), mkts = [...new Set(live.map(e => e.m))];
  const label = `${mo.name} ${mo.y}`, cr = [[NAME, "/"], ["Termine", "/termine/"], [label]];
  const big = mkts.filter(m => m.tags.includes("Groß & bekannt")), top = [...big, ...mkts.filter(m => !big.includes(m)).sort((a, b) => live.filter(e => e.m === b).length - live.filter(e => e.m === a).length)].map(m => m.name);
  const hols = [...new Set(live.filter(e => HOLI[e.k]).map(e => e.k))].map(k => { const n = live.filter(e => e.k === k).length; return `${HOLI[k]} (${dDate(new Date(k + "T00:00:00Z"))}): ${n === 1 ? "ein Markt" : n + " Märkte"}`; });
  const sats = live.filter(e => e.date.getUTCDay() === 6).length, suns = live.filter(e => e.date.getUTCDay() === 0).length;
  const ans = `Im ${label} stehen ${live.length} Flohmarkttermine in Hamburg und im Umland im Kalender, verteilt auf ${mkts.length} Märkte: ${sats} an Samstagen, ${suns} an Sonntagen und ${live.length - sats - suns} unter der Woche.${hols.length ? " Feiertage: " + hols.join(", ") + "." : ""}${mo.partial ? " Weitere Termine kommen dazu, sobald die Veranstalter sie veröffentlichen." : ""}`;
  const desc = pickDesc(
    `Alle ${live.length} Flohmarkttermine in Hamburg und Umgebung im ${label}: ${mkts.length} Märkte, darunter ${listNames(top, 2)}. Mit Uhrzeit und Adresse.`,
    `Flohmarkt in Hamburg im ${label}: ${live.length} Termine auf ${mkts.length} Märkten in der Stadt und im Umland, mit Uhrzeit, Adresse und Anfahrt.`,
    `Flohmarkt Hamburg im ${label}: alle ${live.length} Termine mit Uhrzeit und Adresse.`);
  const body = crumbs(cr) + `<article class="kb"><h1>Flohmarkt Hamburg im ${esc(label)}</h1>
<div class="byline"><span>${ic("cal")}${live.length} Termine</span><span>${ic("pin")}${mkts.length} Märkte</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(ans)}</p></div>${nearBox()}
<section class="block">${groupList(mo.evs)}</section>
<section class="related"><div class="sec-head"><h2>Andere Monate</h2></div>${monthChips(mo.s) || '<p class="meta">Weitere Monate folgen.</p>'}</section>
<section class="related"><div class="sec-head"><h2>Nach Art des Markts</h2></div>${catChips()}</section>
<section class="related"><div class="sec-head"><h2>Vor dem Besuch lesen</h2></div>${grid(["beste-uhrzeit-flohmarkt", "was-mitnehmen-flohmarkt", "flohmarkt-bei-regen"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p, title: `Flohmarkt Hamburg ${label}: alle Termine | ${NAME}`, desc, body, nav: "termine", ld: G([crumbLD(cr)].concat(mo.evs.slice(0, 100).map(eventLD))) });
}

/* ---------------------------------------------------------------- Schilder (Schildgenerator)
   Eine Übersichtsseite plus eine Seite je Vorlage. Das Schild entsteht im Browser (src/site.js),
   gedruckt wird über den normalen Druckdialog. Es wird nichts gespeichert oder verschickt.
   Texte der Vorlagen stehen hier, damit sie ohne Sheet funktionieren. */
const QR = { n: 25, d: "M0 0h7v1h-7zM11 0h1v1h-1zM13 0h1v1h-1zM16 0h1v1h-1zM18 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM10 1h1v1h-1zM13 1h3v1h-3zM18 1h1v1h-1zM24 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h2v1h-2zM14 2h3v1h-3zM18 2h1v1h-1zM20 2h3v1h-3zM24 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h3v1h-3zM12 3h3v1h-3zM18 3h1v1h-1zM20 3h3v1h-3zM24 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h1v1h-1zM12 4h1v1h-1zM14 4h1v1h-1zM16 4h1v1h-1zM18 4h1v1h-1zM20 4h3v1h-3zM24 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1zM14 5h2v1h-2zM18 5h1v1h-1zM24 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h7v1h-7zM8 7h2v1h-2zM12 7h1v1h-1zM15 7h1v1h-1zM0 8h1v1h-1zM2 8h5v1h-5zM9 8h1v1h-1zM13 8h2v1h-2zM18 8h5v1h-5zM0 9h1v1h-1zM3 9h1v1h-1zM5 9h1v1h-1zM7 9h1v1h-1zM9 9h4v1h-4zM14 9h1v1h-1zM16 9h2v1h-2zM19 9h1v1h-1zM23 9h1v1h-1zM1 10h2v1h-2zM5 10h2v1h-2zM8 10h2v1h-2zM13 10h1v1h-1zM15 10h7v1h-7zM23 10h2v1h-2zM1 11h1v1h-1zM4 11h2v1h-2zM7 11h2v1h-2zM11 11h2v1h-2zM14 11h1v1h-1zM16 11h2v1h-2zM19 11h1v1h-1zM24 11h1v1h-1zM4 12h1v1h-1zM6 12h1v1h-1zM8 12h1v1h-1zM11 12h1v1h-1zM13 12h2v1h-2zM17 12h4v1h-4zM22 12h3v1h-3zM0 13h2v1h-2zM9 13h1v1h-1zM12 13h1v1h-1zM16 13h2v1h-2zM19 13h1v1h-1zM21 13h1v1h-1zM23 13h1v1h-1zM0 14h1v1h-1zM5 14h5v1h-5zM14 14h2v1h-2zM17 14h5v1h-5zM23 14h2v1h-2zM0 15h1v1h-1zM3 15h3v1h-3zM10 15h1v1h-1zM12 15h1v1h-1zM14 15h4v1h-4zM19 15h2v1h-2zM24 15h1v1h-1zM0 16h1v1h-1zM3 16h1v1h-1zM6 16h1v1h-1zM9 16h2v1h-2zM12 16h2v1h-2zM16 16h5v1h-5zM22 16h1v1h-1zM8 17h1v1h-1zM13 17h1v1h-1zM15 17h2v1h-2zM20 17h2v1h-2zM0 18h7v1h-7zM9 18h1v1h-1zM11 18h4v1h-4zM16 18h1v1h-1zM18 18h1v1h-1zM20 18h1v1h-1zM22 18h3v1h-3zM0 19h1v1h-1zM6 19h1v1h-1zM8 19h2v1h-2zM11 19h1v1h-1zM16 19h1v1h-1zM20 19h2v1h-2zM24 19h1v1h-1zM0 20h1v1h-1zM2 20h3v1h-3zM6 20h1v1h-1zM8 20h1v1h-1zM11 20h10v1h-10zM22 20h1v1h-1zM0 21h1v1h-1zM2 21h3v1h-3zM6 21h1v1h-1zM8 21h1v1h-1zM12 21h1v1h-1zM15 21h2v1h-2zM18 21h1v1h-1zM20 21h5v1h-5zM0 22h1v1h-1zM2 22h3v1h-3zM6 22h1v1h-1zM8 22h1v1h-1zM14 22h1v1h-1zM21 22h2v1h-2zM24 22h1v1h-1zM0 23h1v1h-1zM6 23h1v1h-1zM9 23h1v1h-1zM15 23h3v1h-3zM19 23h3v1h-3zM24 23h1v1h-1zM0 24h7v1h-7zM8 24h1v1h-1zM12 24h3v1h-3zM19 24h6v1h-6z" }; // QR-Code zu https://www.flohlotse.de (fest, wird nicht bei jedem Bau neu berechnet)
const qrSVG = cls => `<svg class="${cls}" viewBox="-2 -2 ${QR.n + 4} ${QR.n + 4}" aria-hidden="true" focusable="false"><rect x="-2" y="-2" width="${QR.n + 4}" height="${QR.n + 4}" fill="#fff"/><path fill="#15211B" d="${QR.d}"/></svg>`;
const SIGN_BASE = "/flohmarkt-schilder/";
const kl = (s, t) => KBY[s] ? `<a href="/ratgeber/${s}/">${t}</a>` : t; // Ratgeber-Link, falls der Artikel existiert
const SIGNS = [
  { s: "preisschilder", kind: "tags", chip: "Preisschilder", short: "24 Preisschilder pro A4-Blatt, auch für Etiketten 70 × 37 mm.",
    h1: "Preisschilder für den Flohmarkt: Vorlage zum Ausdrucken", title: "Preisschilder Flohmarkt: Vorlage zum Ausdrucken",
    desc: "Kostenlose Preisschilder für den Flohmarkt: 24 Stück pro A4-Blatt, zum Beschriften oder mit festem Preis. Passt auf Etikettenbögen 70 × 37 mm.",
    ans: "Hier druckst du 24 Preisschilder auf ein A4-Blatt. Lass das Preisfeld leer, wenn du mit Stift beschriften willst, oder tipp einen festen Preis ein. Die Felder messen 70 × 37 mm und passen auf gängige Etikettenbögen in diesem Format.",
    v: [{ l: "Zum Beschriften", price: "" }, { l: "50 Cent", price: "50 Cent" }, { l: "1 €", price: "1 €" }, { l: "2 €", price: "2 €" }, { l: "5 €", price: "5 €" }],
    b: () => [["Preise, die man von Weitem liest", `Schreib Preise groß und mit dickem Filzstift, dann sieht man sie auch von der anderen Tischseite. Ein Kreuz bei „VB“ zeigt, dass du über den Preis redest. Wie du sinnvolle Preise findest, steht im Ratgeber ${kl("preise-festlegen-flohmarkt", "Preise auf dem Flohmarkt festlegen")}.`],
      ["Kleben, klemmen oder einstecken", "Auf Etikettenbögen gedruckt klebst du die Schilder direkt auf. Auf normalem Papier schneidest du sie aus und befestigst sie mit Kreppband, das sich meist ohne Rückstände ablöst. An Kleidung hält ein Schild mit Sicherheitsnadel, in Büchern und Plattenhüllen legst du es lose ein."]],
    f: [["Welches Etikettenformat passt?", "Die Vorlage hat drei Spalten und acht Reihen zu je 70 × 37 mm, also 24 Etiketten pro A4-Bogen. Stell beim Drucken die Größe auf 100 % oder „Tatsächliche Größe“, nicht auf „An Seite anpassen“."],
      ["Kann ich verschiedene Preise auf ein Blatt drucken?", "Lass das Preisfeld leer und schreib die Preise mit Stift drauf. So bist du am flexibelsten und kannst am Nachmittag auch mal einen Preis durchstreichen."],
      ["Hinterlässt Klebeband Spuren?", "Kreppband lässt sich meist sauber abziehen. Auf empfindlichen Buchumschlägen und Schallplattenhüllen legst du das Schild trotzdem besser lose ein."]],
    kb: ["preise-festlegen-flohmarkt", "checkliste-flohmarktstand", "was-verkauft-sich-gut-flohmarkt"] },
  { s: "alles-1-euro", fmt: "quer", chip: "Alles 1 €", short: "Das Schild für die Wühlkiste, auch als 50 Cent, 2 € oder 5 €.",
    h1: "Alles-1-Euro-Schild für den Flohmarkt: kostenlos drucken", title: "Alles 1 Euro Schild für den Flohmarkt: kostenlos",
    desc: "Schild „Alles 1 €“ für deine Flohmarkt-Kiste: kostenlos gestalten und drucken, auch für 50 Cent, 2 € oder 5 €. Als A4 oder acht kleine Schilder.",
    ans: "Ein „Alles 1 €“-Schild auf der Wühlkiste ist eines der wirkungsvollsten Schilder am Stand: Die Leute greifen zu, ohne erst nach dem Preis zu fragen. Wähl unten den Betrag, druck das Schild aus und klemm es gut sichtbar an die Kiste.",
    v: [{ l: "1 €", top: "Alles", main: "1 €", bot: "pro Teil" }, { l: "50 Cent", top: "Alles", main: "50 Cent", bot: "pro Teil" }, { l: "2 €", top: "Alles", main: "2 €", bot: "pro Teil" }, { l: "5 €", top: "Alles", main: "5 €", bot: "pro Teil" }],
    b: () => [["Warum Festpreis-Kisten funktionieren", "Bei Kleinkram wie Taschenbüchern, Tassen oder Kinderspielzeug lohnt sich Feilschen für beide Seiten kaum. Ein fester Preis nimmt die Hemmung, und du musst nicht jede Frage einzeln beantworten. Gerade am Nachmittag hilft so eine Kiste, Restposten loszuwerden."],
      ["Tipps für die Kiste", "Stell die Kiste vorn an den Tisch oder davor auf den Boden, damit man gut darin wühlen kann. Sortier zwischendurch nach, dann wirkt sie nicht leer gekauft. Mit dem Format „8 pro Blatt“ bekommst du kleine Schilder für mehrere Kisten auf einmal."]],
    f: [["Welcher Betrag passt für meine Kiste?", "Für Taschenbücher, Kleinkram und Kinderkleidung sind 50 Cent bis 1 € üblich, für Hardcover, Spiele oder bessere Kleidung eher 2 bis 5 €. Am Nachmittag kannst du den Preis senken und einfach ein neues Schild drucken."],
      ["Kann ich das Schild ohne Farbe drucken?", "Ja. Schalte den Sparmodus ein, dann druckt das Schild mit schwarzem Rahmen statt gelber Fläche. Das schont die Druckerpatrone."]],
    kb: ["preise-festlegen-flohmarkt", "was-verkauft-sich-gut-flohmarkt", "reste-nach-dem-flohmarkt"] },
  { s: "handeln-erwuenscht", fmt: "quer", chip: "Handeln erwünscht", short: "Lädt zum Verhandeln ein und bringt Leute ins Gespräch.",
    h1: "Handeln-erwünscht-Schild für den Flohmarkt zum Ausdrucken", title: "Handeln erwünscht: Schild für den Flohmarkt",
    desc: "Kostenloses Schild „Handeln erwünscht“ für deinen Flohmarktstand: lädt zum Verhandeln ein und bringt mehr Leute ins Gespräch. Gestalten und drucken.",
    ans: "Ein „Handeln erwünscht“-Schild senkt die Hemmschwelle: Viele Leute trauen sich sonst nicht, ein Angebot zu machen, und gehen weiter. Wähl einen Spruch, druck das Schild und stell es gut sichtbar auf den Tisch.",
    v: [{ l: "Handeln erwünscht", top: "", main: "Handeln erwünscht", bot: "Mach mir ein Angebot" }, { l: "Mach ein Angebot", top: "Gefällt dir was?", main: "Mach ein Angebot", bot: "Ich beiße nicht" }, { l: "Alle Preise VB", top: "", main: "Alle Preise VB", bot: "VB heißt: Wir reden drüber" }],
    b: () => [["Wann das Schild sinnvoll ist", "Besonders bei größeren Stücken wie Möbeln, Lampen oder Elektrogeräten wartet die Kundschaft oft auf ein Zeichen, dass der Preis nicht in Stein gemeißelt ist. Plan beim Auspreisen etwas Spielraum ein, dann kannst du entspannt nachgeben."],
      ["So verhandelst du freundlich", `Hör dir das Angebot an, nenn einen Gegenvorschlag und trefft euch in der Mitte. Wer mehrere Teile nimmt, bekommt einen Paketpreis. Mehr dazu im Ratgeber ${kl("handeln-auf-dem-flohmarkt", "Handeln auf dem Flohmarkt")}.`]],
    f: [["Verkaufe ich mit dem Schild unter Wert?", "Nicht unbedingt. Wenn du deine Preise mit etwas Spielraum ansetzt, kommst du beim Verhandeln trotzdem gut weg und verkaufst mehr."],
      ["Was heißt VB?", "VB steht für Verhandlungsbasis. Der Preis ist ein Vorschlag, über den man reden kann."]],
    kb: ["handeln-auf-dem-flohmarkt", "preise-festlegen-flohmarkt", "flohmarkt-knigge"] },
  { s: "bar-und-paypal", fmt: "quer", chip: "Bar & PayPal", short: "Zeigt sofort, wie man bei dir bezahlen kann.",
    h1: "Zahlungsschild für den Flohmarkt: Bar, PayPal oder per App", title: "Zahlungsschild Flohmarkt: Bar & PayPal zum Drucken",
    desc: "Kostenloses Zahlungsschild für den Flohmarkt: Zeig deiner Kundschaft, ob du Bargeld, PayPal oder andere Bezahl-Apps annimmst. Anpassen und drucken.",
    ans: "Ein Zahlungsschild beantwortet die häufigste Frage am Stand, bevor sie gestellt wird. Trag ein, was du annimmst, zum Beispiel Bargeld und PayPal, und häng das Schild an deine Kasse.",
    v: [{ l: "Bar & PayPal", top: "Bei mir zahlst du", main: "Bar & PayPal", bot: "Kleingeld ist willkommen" }, { l: "Nur Bargeld", top: "", main: "Nur Bargeld", bot: "Danke für passendes Kleingeld" }, { l: "Bar & per App", top: "Bei mir zahlst du", main: "Bar & per App", bot: "Frag einfach nach" }],
    b: () => [["Warum das Schild Zeit spart", "Nicht alle haben genug Bargeld dabei. Wer sieht, dass er per App zahlen kann, kauft eher, statt zum Geldautomaten zu laufen. Umgekehrt vermeidet ein „Nur Bargeld“ enttäuschte Gesichter an der Kasse."],
      ["Tipp für Zahlungen per App", `Übergib die Ware erst, wenn die Zahlung auf deinem Handy angekommen ist. Den QR-Code aus deiner Bezahl-App kannst du ausdrucken und neben das Schild kleben. Mehr dazu im Ratgeber ${kl("bezahlen-auf-dem-flohmarkt", "Wie bezahlt man auf dem Flohmarkt?")}.`]],
    f: [["Kann ich meinen Zahlungs-QR-Code aufs Schild drucken?", "Im Generator nicht. Druck den QR-Code direkt aus deiner Bezahl-App aus und kleb ihn neben das Schild."],
      ["Wie viel Wechselgeld brauche ich?", `Das hängt von deinen Preisen ab. Eine Übersicht mit Beispielen findest du im Ratgeber ${kl("wechselgeld-flohmarkt", "Wechselgeld für den Flohmarkt")}.`]],
    kb: ["bezahlen-auf-dem-flohmarkt", "wechselgeld-flohmarkt", "diebstahl-am-flohmarktstand"] },
  { s: "mengenrabatt", fmt: "quer", chip: "3 für 5 €", short: "Mengenrabatt wie „3 für 5 €“ oder „Tüte voll 5 €“.",
    h1: "Mengenrabatt-Schild für den Flohmarkt: „3 für 5 €“ und mehr", title: "Mengenrabatt-Schild für den Flohmarkt drucken",
    desc: "Schild für Mengenrabatt am Flohmarktstand, etwa „3 für 5 €“ oder „Tüte voll 5 €“: kostenlos gestalten, ausdrucken und an die Kiste hängen.",
    ans: "Mit einem Mengenrabatt verkaufst du mehr Teile pro Kunde. Ein Schild wie „3 für 5 €“ macht das Angebot auf einen Blick klar. Betrag wählen, drucken, an die Kiste klemmen.",
    v: [{ l: "3 für 5 €", top: "Mengenrabatt", main: "3 für 5 €", bot: "Gilt für diese Kiste" }, { l: "Nimm 3, zahl 2", top: "Mengenrabatt", main: "Nimm 3, zahl 2", bot: "Das günstigste Teil ist gratis" }, { l: "Tüte voll 5 €", top: "Ausverkauf", main: "Tüte voll: 5 €", bot: "Du packst, ich kassiere" }],
    b: () => [["Wofür sich Mengenrabatt eignet", "Bücher, DVDs, Kinderkleidung und Schallplatten werden gern im Stapel gekauft. Ein Mengenrabatt lädt dazu ein, noch ein Teil mehr mitzunehmen, und du musst am Ende weniger wieder einpacken."],
      ["Tüte voll für einen Preis", `Gegen Ende des Markttags ist „Tüte voll: 5 €“ ein bewährter Trick für Restposten. Leg ein paar Tüten bereit, dann geht es schneller. Was danach übrig bleibt, steht im Ratgeber ${kl("reste-nach-dem-flohmarkt", "Nach dem Flohmarkt: Wohin mit den Resten?")}.`]],
    f: [["Wie rechne ich einen fairen Mengenrabatt?", "Eine einfache Faustregel: Wer drei Teile nimmt, bekommt eines etwa zum halben Preis. So ist der Rabatt spürbar, ohne dass du draufzahlst."],
      ["Kann ich mehrere Rabattschilder auf ein Blatt drucken?", "Ja. Wähl das Format „8 pro Blatt“, dann bekommst du acht kleine Schilder für verschiedene Kisten."]],
    kb: ["preise-festlegen-flohmarkt", "reste-nach-dem-flohmarkt", "was-verkauft-sich-gut-flohmarkt"] },
  { s: "reserviert-verkauft", fmt: "quer", chip: "Reserviert", short: "„Reserviert“ oder „Verkauft“, mit Platz für Name und Uhrzeit.",
    h1: "Reserviert- und Verkauft-Schild für den Flohmarkt", title: "Reserviert-Schild & Verkauft-Schild zum Ausdrucken",
    desc: "Kostenlose Schilder „Reserviert“ und „Verkauft“ für den Flohmarkt: mit Platz für Name oder Abholzeit, als A4 oder acht kleine Schilder pro Blatt.",
    ans: "Wenn jemand ein großes Stück später abholen will, zeigt ein „Reserviert“-Schild allen anderen, dass es vergeben ist. Trag in die kleine Zeile den Namen oder die Abholzeit ein, dann gibt es keine Missverständnisse.",
    v: [{ l: "Reserviert", top: "", main: "Reserviert", bot: "für ________ bis ____ Uhr" }, { l: "Verkauft", top: "", main: "Verkauft", bot: "Danke! Schau dich gern weiter um" }, { l: "Nicht zu verkaufen", top: "", main: "Nicht zu verkaufen", bot: "Gehört zur Deko" }],
    b: () => [["Reservieren ohne Ärger", "Vereinbart eine klare Abholzeit und sprecht ab, was passiert, wenn bis dahin niemand kommt. Bei teureren Stücken ist eine kleine Anzahlung eine gute Idee. Schreib die Uhrzeit ruhig mit aufs Schild."],
      ["Verkauft, aber noch da", `Große Möbel bleiben oft bis zum Marktende am Stand stehen. Ein „Verkauft“-Schild erspart dir die immer gleiche Frage. Wie Zurücklegen fair klappt, steht im Ratgeber ${kl("zuruecklegen-lassen-flohmarkt", "Zurücklegen lassen")}.`]],
    f: [["Soll ich bei Reservierungen eine Anzahlung nehmen?", "Bei teureren Stücken ist das sinnvoll. So ist die Reservierung für beide Seiten verbindlicher."],
      ["Kann ich den Namen direkt eintippen?", "Ja, schreib ihn in die kleine Zeile unten. Oder lass die Linien stehen und füll sie am Stand mit Stift aus."]],
    kb: ["zuruecklegen-lassen-flohmarkt", "diebstahl-am-flohmarktstand", "checkliste-flohmarktstand"] },
  { s: "zu-verschenken", fmt: "quer", chip: "Zu verschenken", short: "Für Restkisten, Hausflur oder Gartenzaun.",
    h1: "Zu-verschenken-Schild: kostenlos gestalten und drucken", title: "Zu verschenken Schild: kostenlos zum Ausdrucken",
    desc: "Schild „Zu verschenken“ für Flohmarkt-Reste, Hausflur oder Gartenzaun: kostenlos gestalten und drucken, als A4 oder acht kleine Schilder pro Blatt.",
    ans: "Am Ende des Markttags bleibt fast immer etwas übrig. Statt alles wieder einzupacken, stellst du eine Kiste mit „Zu verschenken“ an den Stand. Das Schild funktioniert genauso im Hausflur oder am Gartenzaun.",
    v: [{ l: "Zu verschenken", top: "Kostenlos", main: "Zu verschenken", bot: "Nimm mit, was dir gefällt" }, { l: "Gratis mitnehmen", top: "", main: "Gratis zum Mitnehmen", bot: "Viel Freude damit!" }, { l: "Bitte nur eins", top: "Kostenlos", main: "Zu verschenken", bot: "Bitte nimm nur, was du brauchst" }],
    b: () => [["Reste sinnvoll loswerden", `Was nach dem Markt übrig ist, findet in einer Verschenkkiste oft noch dankbare Abnehmer. Was danach noch bleibt, kannst du spenden. Ideen dafür findest du im Ratgeber ${kl("reste-nach-dem-flohmarkt", "Nach dem Flohmarkt: Wohin mit den Resten?")}.`],
      ["Damit es ordentlich bleibt", "Stell die Kiste so, dass niemand stolpert, und schau ab und zu, ob alles noch ordentlich aussieht. Bei Regen schützt eine Klarsichthülle das Schild."]],
    f: [["Wann stelle ich die Verschenkkiste raus?", "Am besten in der letzten Stunde des Markts. Vorher nimmst du dir sonst selbst das Geschäft weg."],
      ["Was eignet sich zum Verschenken?", "Alles, was noch funktioniert und sauber ist: Bücher, Geschirr, Deko, Kinderkleidung. Kaputtes gehört nicht in die Kiste."]],
    kb: ["reste-nach-dem-flohmarkt", "second-hand-nachhaltig", "checkliste-flohmarktstand"] }
];
const SIGN_BY = Object.fromEntries(SIGNS.map(t => [t.s, t]));
const signUrl = t => SIGN_BASE + t.s + "/";
const signImg = t => `/assets/schilder/flohmarkt-${t.s}-vorlage.svg`;
const SIGN_PAGE_IMGS = new Map(); // für die Bild-Sitemap

// Startzustand einer Vorlage (erste Variante)
const signState = (t, x = t.v[0]) => ({ kind: t.kind || "sign", fmt: t.kind === "tags" ? "tags" : (t.fmt || "quer"), top: x.top || "", main: x.main || "", bot: x.bot || "", price: x.price || "" });
// Markup: dieselben Bausteine nutzt src/site.js (Vorlagen <template id="tplSign"> und "tplTag")
const SG_UNIT = `<div class="sg"><div class="sg-top"></div><div class="sg-main"><span></span></div><div class="sg-bot"></div><div class="sg-foot">${qrSVG("sg-qr")}<span><b>flohlotse.de</b>Alle Flohmärkte in Hamburg</span></div></div>`;
const TG_UNIT = `<div class="tg"><i class="tg-hole"></i><div class="tg-price"><span></span></div><div class="tg-vb"><i></i>VB</div><div class="tg-brand">flohlotse.de</div></div>`;
function sheetHTML(st) {
  if (st.kind === "tags") {
    const u = `<div class="tg"><i class="tg-hole"></i><div class="tg-price${st.price ? "" : " blank"}"><span>${st.price ? esc(st.price) : "€"}</span></div><div class="tg-vb"><i></i>VB</div><div class="tg-brand">flohlotse.de</div></div>`;
    return `<div class="sheet f-tags" id="sheet">${u.repeat(24)}</div>`;
  }
  const u = `<div class="sg"><div class="sg-top">${esc(st.top)}</div><div class="sg-main"><span>${esc(st.main)}</span></div><div class="sg-bot">${esc(st.bot)}</div><div class="sg-foot">${qrSVG("sg-qr")}<span><b>flohlotse.de</b>Alle Flohmärkte in Hamburg</span></div></div>`;
  return `<div class="sheet f-${st.fmt}" id="sheet">${st.fmt === "acht" ? u.repeat(8) : u}</div>`;
}
function genHTML(st, presets, heading) {
  const pj = p => esc(JSON.stringify(p));
  const fmtBtn = (f, l) => `<button type="button" class="chip" data-fmt="${f}" aria-pressed="${st.fmt === f}">${l}</button>`;
  return `<section class="gen" id="gen" data-kind="${st.kind}" data-fmt="${st.fmt}" aria-labelledby="genH">
<h2 id="genH">${heading}</h2>
${presets.length > 1 ? `<div class="chips gen-presets" role="group" aria-label="Vorlage wählen">${presets.map((p, i) => `<button type="button" class="chip" data-set="${pj(p.set)}" aria-pressed="${i === 0}">${esc(p.l)}</button>`).join("")}</div>` : ""}
<div class="sheet-wrap" id="sheetWrap">${sheetHTML(st)}</div>
<div class="gen-form">
<label class="only-sign"><span>Großer Text</span><input id="fMain" type="text" value="${esc(st.main)}" maxlength="40" autocomplete="off" enterkeyhint="done"></label>
<label class="only-sign"><span>Kleine Zeile oben <small>(optional)</small></span><input id="fTop" type="text" value="${esc(st.top)}" maxlength="40" autocomplete="off" enterkeyhint="done"></label>
<label class="only-sign"><span>Kleine Zeile unten <small>(optional)</small></span><input id="fBot" type="text" value="${esc(st.bot)}" maxlength="60" autocomplete="off" enterkeyhint="done"></label>
<label class="only-tags"><span>Preis <small>(leer lassen zum Beschriften)</small></span><input id="fPrice" type="text" value="${esc(st.price)}" maxlength="12" autocomplete="off" enterkeyhint="done" placeholder="z. B. 2 €"></label>
<div class="gen-opts"><div class="seg only-sign" role="group" aria-label="Format">${fmtBtn("quer", "A4 quer")}${fmtBtn("hoch", "A4 hoch")}${fmtBtn("acht", "8 pro Blatt")}</div>
<label class="switch only-tags"><input type="checkbox" id="fVb" checked>Kästchen „VB“</label>
<label class="switch"><input type="checkbox" id="fSave">Sparmodus: Rahmen statt Farbe</label></div>
</div>
<button class="btn gen-print" id="doPrint" type="button">${ic("printer")}Drucken oder als PDF speichern</button>
<p class="gen-hint">Kein Drucker? Wähl im Druckfenster „Als PDF speichern“ und lass das PDF im Copyshop drucken. Deine Texte bleiben auf deinem Gerät.</p>
<noscript><p class="gen-hint">Der Schilder-Designer braucht JavaScript. Die Vorlagen unten kannst du dir trotzdem ansehen.</p></noscript>
<template id="tplSign">${SG_UNIT}</template><template id="tplTag">${TG_UNIT}</template>
</section>`;
}
// Vorschaubild (SVG) je Vorlage für Übersicht und Google-Bildersuche
function signPreviewSVG(t) {
  const st = signState(t), F = "'Arial Black','Helvetica Neue',Arial,sans-serif", B = "Arial,Helvetica,sans-serif";
  const head = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="594" height="420" role="img"><title>${esc(t.h1)}</title><rect width="297" height="210" rx="6" fill="#fff"/><rect x=".5" y=".5" width="296" height="209" rx="6" fill="none" stroke="#DCE3DC"/>`;
  if (st.kind === "tags") {
    const prices = ["50 Cent", "1 €", "2 €", "", "5 €", "1 €", "", "3 €", "50 Cent"]; let g = "";
    prices.forEach((p, i) => { const x = 14 + (i % 3) * 92, y = 16 + Math.floor(i / 3) * 62;
      g += `<rect x="${x}" y="${y}" width="86" height="54" rx="3" fill="#fff" stroke="#c9c9c9" stroke-dasharray="3 2"/><circle cx="${x + 9}" cy="${y + 27}" r="3.2" fill="none" stroke="#15211B" stroke-width=".8"/><rect x="${x + 17}" y="${y + 8}" width="62" height="26" rx="4" fill="#F6E03A"/>`
        + (p ? `<text x="${x + 48}" y="${y + 27}" text-anchor="middle" font-family="${F}" font-size="${p.length > 4 ? 11 : 15}" font-weight="900" fill="#15211B">${esc(p)}</text>` : `<line x1="${x + 24}" y1="${y + 27}" x2="${x + 66}" y2="${y + 27}" stroke="#15211B" stroke-width=".8"/><text x="${x + 72}" y="${y + 27}" text-anchor="middle" font-family="${F}" font-size="10" fill="#15211B">€</text>`)
        + `<rect x="${x + 17}" y="${y + 39}" width="5" height="5" rx="1" fill="none" stroke="#15211B" stroke-width=".7"/><text x="${x + 25}" y="${y + 43.5}" font-family="${B}" font-size="6" font-weight="700" fill="#15211B">VB</text><text x="${x + 80}" y="${y + 50}" text-anchor="end" font-family="${B}" font-size="4" fill="#7a867f">flohlotse.de</text>`; });
    return head + g + "</svg>\n";
  }
  const main = st.main, words = main.split(" ");
  let lines = [main];
  if (main.length > 11 && words.length > 1) { let best = 1, diff = 1e9; for (let i = 1; i < words.length; i++) { const a = words.slice(0, i).join(" ").length, b = words.slice(i).join(" ").length, d = Math.abs(a - b); if (d < diff) { diff = d; best = i; } } lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")]; }
  const longest = Math.max(...lines.map(l => l.length)), fs = Math.min(lines.length > 1 ? 44 : 70, 232 / (longest * 0.66));
  const cy = 112, lh = fs * 1.02, y0 = cy - (lines.length - 1) * lh / 2 + fs * 0.35;
  return head + (st.top ? `<text x="148.5" y="38" text-anchor="middle" font-family="${F}" font-size="17" font-weight="900" fill="#15211B">${esc(st.top)}</text>` : "")
    + `<rect x="22" y="${st.top ? 50 : 34}" width="253" height="${st.top ? 118 : 134}" rx="10" fill="#F6E03A" transform="rotate(-1.2 148.5 109)"/>`
    + lines.map((l, i) => `<text x="148.5" y="${(y0 + i * lh).toFixed(1)}" text-anchor="middle" font-family="${F}" font-size="${fs.toFixed(1)}" font-weight="900" fill="#15211B" transform="rotate(-1.2 148.5 109)">${esc(l)}</text>`).join("")
    + (st.bot ? `<text x="148.5" y="188" text-anchor="middle" font-family="${B}" font-size="11.5" font-weight="700" fill="#15211B">${esc(st.bot)}</text>` : "")
    + `<text x="283" y="203" text-anchor="end" font-family="${B}" font-size="5" fill="#5A6961">flohlotse.de</text></svg>\n`;
}
const signAlt = t => t.kind === "tags" ? "Vorlage: Preisschilder für den Flohmarkt zum Ausdrucken" : `Vorlage: „${t.chip}“-Schild für den Flohmarkt`;
const signCard = t => `<a class="card sg-card" href="${signUrl(t)}"><img src="${signImg(t)}" width="297" height="210" alt="${esc(signAlt(t))}" loading="lazy" decoding="async"><h3>${esc(t.chip)}</h3><p>${esc(t.short)}</p></a>`;
const signLD = (p, crumbsArr, faq) => G([crumbLD(crumbsArr),
  { "@type": "WebApplication", name: `${NAME} Schilder-Designer`, url: SITE + p, applicationCategory: "DesignApplication", operatingSystem: "Web", inLanguage: "de", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" } },
  { "@type": "FAQPage", mainEntity: faq.map(([q, x]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(x.replace(/<[^>]+>/g, "")) } })) }]);
const signByline = `<div class="byline"><span>${ic("tag")}Kostenlos</span><span>${ic("user")}Ohne Anmeldung</span><span>${ic("printer")}Drucken oder PDF</span></div>`;
const faqHTML = f => `<section class="faq"><h2>Häufige Fragen</h2>${f.map(([q, x]) => `<details><summary>${esc(q)}</summary><p>${x}</p></details>`).join("")}</section>`;
// Übersichtsseite
{
  const p = SIGN_BASE, cr = [[NAME, "/"], ["Schilder"]];
  const presets = SIGNS.map(t => ({ l: t.chip, set: signState(t) })).concat([{ l: "Eigener Text", set: { kind: "sign", fmt: "quer", top: "", main: "Dein Text", bot: "" } }]);
  const first = SIGN_BY["alles-1-euro"]; presets.sort((a, b) => (b.l === first.chip) - (a.l === first.chip));
  const faq = [["Kostet der Schilder-Designer etwas?", "Nein. Du kannst so viele Schilder gestalten und drucken, wie du möchtest, ohne Anmeldung."],
    ["Werden meine Texte gespeichert?", "Nein. Das Schild entsteht direkt in deinem Browser. Wir sehen nicht, was du eintippst."],
    ["Kann ich auf Etiketten drucken?", `Ja. Die <a href="${signUrl(SIGN_BY.preisschilder)}">Preisschilder-Vorlage</a> hat 24 Felder im Format 70 × 37 mm und passt auf gängige Etikettenbögen mit diesem Maß. Stell beim Drucken die Größe auf 100 %.`],
    ["Warum steht unten flohlotse.de?", "Damit deine Kundschaft weitere Flohmärkte in Hamburg findet. Der Hinweis ist klein und stört das Schild nicht."]];
  const body = crumbs(cr) + `<article class="kb"><h1>Flohmarkt-Schilder und Preisschilder zum Ausdrucken</h1>${signByline}
<p class="lead">Der Schilder-Designer für deinen Stand: Vorlage wählen, Text eintippen, drucken. Ohne Drucker speicherst du das Schild als PDF und druckst es im Copyshop.</p>
${genHTML(signState(first), presets, "Schild gestalten und drucken")}
<section class="related"><div class="sec-head"><h2>Alle Vorlagen</h2></div>${grid(SIGNS.map(signCard))}</section>
<div class="kb-body"><h2>Welche Schilder lohnen sich am Stand?</h2><p>Ein großes Schild für die Wühlkiste wie <a href="${signUrl(first)}">„Alles 1 €“</a> erspart dir an einem vollen Markttag Dutzende Fragen. Ein <a href="${signUrl(SIGN_BY["bar-und-paypal"])}">Zahlungsschild</a> verhindert peinliche Momente an der Kasse, und <a href="${signUrl(SIGN_BY["handeln-erwuenscht"])}">„Handeln erwünscht“</a> holt Leute ins Gespräch, die sonst nur gucken. Für einzelne Stücke nimmst du <a href="${signUrl(SIGN_BY.preisschilder)}">kleine Preisschilder</a>.</p>
${sideImg("seite-schilder", "quer kante")}<h2>So hält dein Schild den ganzen Tag</h2><p>Steck das Blatt in eine Klarsichthülle, dann übersteht es Nieselregen und Kaffeeflecken. Mit Wäscheklammern oder Kreppband hält es an Kisten und Tischkanten, bei Wind hilft ein Stück Pappe dahinter. Was sonst noch in die Tasche gehört, steht in der ${kl("checkliste-flohmarktstand", "Checkliste für deinen Flohmarktstand")}.</p>
<h2>Drucken ohne eigenen Drucker</h2><p>Tipp auf „Drucken oder als PDF speichern“ und wähl im Druckfenster „Als PDF speichern“. Das PDF druckst du im Copyshop oder bei Freunden aus. Für die gelbe Fläche reicht ein normaler Farbdrucker, im Sparmodus genügt Schwarzweiß.</p></div>
${faqHTML(faq)}
<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2>${more("/ratgeber/#verkaufen", "Verkaufen")}</div>${grid(["checkliste-flohmarktstand", "preise-festlegen-flohmarkt", "flohmarktstand-anmelden"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p, title: `Flohmarkt-Schilder & Preisschilder zum Ausdrucken | ${NAME}`, desc: "Kostenlose Schilder und Preisschilder für deinen Flohmarktstand: Vorlage wählen, Text eintippen, drucken oder als PDF speichern. Ohne Anmeldung.", body, nav: "schilder", ld: signLD(p, cr, faq) });
  SIGN_PAGE_IMGS.set(p, SIGNS.map(t => [signImg(t), signAlt(t)]));
}
// Eine Seite je Vorlage
for (const t of SIGNS) {
  const p = signUrl(t), cr = [[NAME, "/"], ["Schilder", SIGN_BASE], [t.chip]];
  const others = SIGNS.filter(x => x !== t);
  const body = crumbs(cr) + `<article class="kb"><h1>${esc(t.h1)}</h1>${signByline}
${genHTML(signState(t), t.v.map(x => ({ l: x.l, set: signState(t, x) })), t.kind === "tags" ? "Preisschilder gestalten" : `„${esc(t.chip)}“-Schild gestalten`)}
<div class="kb-body"><p class="intro">${esc(t.ans)}</p>${t.b().map(([h, x]) => `<h2>${esc(h)}</h2><p>${x}</p>`).join("")}</div>
${faqHTML(t.f)}
<section class="related"><div class="sec-head"><h2>Weitere Schilder-Vorlagen</h2>${more(SIGN_BASE, "Alle")}</div>${grid(others.map(signCard))}</section>
<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2></div>${grid(t.kb.filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p, title: `${t.title} | ${NAME}`, desc: t.desc, body, nav: "schilder", ld: signLD(p, cr, t.f) });
  SIGN_PAGE_IMGS.set(p, others.map(x => [signImg(x), signAlt(x)]));
}
// Hinweis-Kasten in passenden Ratgeber-Artikeln (wird dort eingefügt)
const SIGN_CTA = { "preise-festlegen-flohmarkt": "preisschilder", "checkliste-flohmarktstand": "", "reste-nach-dem-flohmarkt": "zu-verschenken", "wechselgeld-flohmarkt": "bar-und-paypal", "bezahlen-auf-dem-flohmarkt": "bar-und-paypal", "handeln-auf-dem-flohmarkt": "handeln-erwuenscht", "zuruecklegen-lassen-flohmarkt": "reserviert-verkauft", "was-verkauft-sich-gut-flohmarkt": "alles-1-euro", "kinderflohmarkt-verkaufen": "preisschilder", "flohmarktstand-anmelden": "" };
const signCta = t => `<a class="cta-box" href="${t ? signUrl(t) : SIGN_BASE}">${ic("printer")}<span><b>${!t ? "Gratis: Schilder für deinen Stand" : t.kind === "tags" ? "Gratis: Preisschilder zum Ausdrucken" : `Gratis-Vorlage: „${esc(t.chip)}“-Schild`}</b>${t ? esc(t.short) : "Preisschilder, „Alles 1 €“ und mehr, direkt drucken."}</span>${ic("chev")}</a>`;

/* ---------------------------------------------------------------- Ratgeber */
// Bildform je Bereich im Artikel: Banner (leer), „kante“ (schwarze Kante), „rund“ oder „rund links“ (Kreis neben dem Text).
const KB_FORM = { verkaufen: "kante", knigge: "rund links", grundwissen: "rund" };
const THUMB_FORM = ["", "rund"];
const clusterThumb = (c, i) => { const x = pickImg(`ratgeber-${c}-klein`) || pickImg(`ratgeber-${c}`); return x ? `<img class="cl-thumb ${THUMB_FORM[i % 2]}" src="${imgUrl(x.f)}" width="760" height="332" alt="${esc(altOf(x))}"${i ? ' loading="lazy"' : ""} decoding="async">` : ""; };
{
  const body = crumbs([[NAME, "/"], ["Ratgeber"]]) + `<section class="hub-head"><h1>Flohmarkt-Ratgeber: Antworten auf die häufigsten Fragen</h1>
<p>Unsere Empfehlungen zum Kaufen, Verkaufen, Handeln und Organisieren. Jeder Artikel beginnt mit einer kurzen Antwort, danach folgen die Details.</p>
<div class="search"><label for="kbSearch" class="kicker">Frage suchen</label><input id="kbSearch" type="search" placeholder="z. B. handeln, Steuern, Standgebühr" autocomplete="off"></div></section>
${Object.entries(CLUSTERS).map(([c, info], i) => { const items = KB.filter(a => a.c === c); return items.length ? `<section class="cluster" id="${c}"><div class="cl-head${i % 2 ? " flip" : ""}"><div><h2>${esc(info.t)}</h2><p>${esc(info.p)}</p></div>${clusterThumb(c, i)}</div><div class="qlist">${items.map(a => `<a href="/ratgeber/${a.s}/" data-q="${esc((a.h + " " + a.kw + " " + plain(a.a)).toLowerCase())}"><span>${brColon(esc(a.h))}</span>${ic("chev")}</a>`).join("")}</div></section>` : ""; }).join("")}
${CRED_SRC ? `<p class="meta cl-cred">Symbolfotos: ${credLink()}${S["Bildnachweis"] ? " · " + esc(String(S["Bildnachweis"]).replace(/^Fotos:\s*/, "").replace(/\.$/, "")) : ""}</p>` : ""}
<div class="empty" id="kbLeer" hidden>Dazu gibt es noch keinen Artikel. Versuch einen anderen Begriff, etwa „Steuern“ oder „Stand“.</div>`;
  layout({ p: "/ratgeber/", title: `Flohmarkt-Ratgeber: Die wichtigsten Fragen | ${NAME}`, desc: "Kaufen, verkaufen, handeln, Knigge und Tipps für Veranstalter: Der Ratgeber beantwortet die häufigsten Fragen rund um den Flohmarkt, kurz und verständlich.", body, nav: "ratgeber", ld: G([crumbLD([[NAME, "/"], ["Ratgeber"]]), { "@type": "CollectionPage", name: "Flohmarkt-Ratgeber", hasPart: KB.map(a => ({ "@type": "Article", headline: a.h, url: `${SITE}/ratgeber/${a.s}/` })) }]) });
}
for (const a of KB) {
  const cl = CLUSTERS[a.c] || { t: a.c };
  const words = (plain(a.a) + " " + a.b.map(x => x.join(" ")).join(" ")).split(/\s+/).length;
  const body = crumbs([[NAME, "/"], ["Ratgeber", "/ratgeber/"], [cl.t, `/ratgeber/#${a.c}`]]) + `<article class="kb"><h1>${esc(a.h)}</h1>
<div class="byline"><span>${ic("book")}${esc(NAME)} Ratgeber</span><span>${ic("update")}Stand: ${STAND}</span><span>${ic("clock")}${Math.max(2, Math.round(words / 200))} Min. Lesezeit</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${rich(a.a)}</p></div>
${/rund/.test(KB_FORM[a.c]) ? "" : clusterImg(a.c, `kb-photo${KB_FORM[a.c] ? " " + KB_FORM[a.c] : ""}`)}<div class="kb-body">${/rund/.test(KB_FORM[a.c]) ? sideImg(`ratgeber-${a.c}-klein`, KB_FORM[a.c]) : ""}${a.b.map(([h, p]) => `<h2>${esc(h)}</h2><p>${rich(p)}</p>`).join("")}</div>
${a.s in SIGN_CTA || a.c === "verkaufen" ? signCta(SIGN_BY[SIGN_CTA[a.s]]) : ""}
${CAT_BY_S[ART_CTA[a.s]] ? catCta(CAT_BY_S[ART_CTA[a.s]]) : ""}
${a.f.length ? `<section class="faq"><h2>Häufige Fragen</h2>${a.f.map(([q, x]) => `<details><summary>${esc(q)}</summary><p>${rich(x)}</p></details>`).join("")}</section>` : ""}
${a.x ? '<p class="hint">Unser Tipp: Verbindliche Auskünfte für deinen Fall bekommst du bei den zuständigen Stellen, zum Beispiel beim Finanzamt, beim Bezirksamt oder beim Veranstalter des Markts.</p>' : ""}
<p class="ai-note">Dieser Text ist mit Unterstützung von künstlicher Intelligenz entstanden.</p>
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
<div class="kb-body"><h2>So funktioniert es</h2><ol class="steps"><li>${FORM_MAIL ? "Du schickst uns eine kurze E-Mail mit Name des Markts, Datum, Uhrzeit, Adresse und, falls vorhanden, dem Link zu deiner Website." : "Du füllst ein kurzes Formular aus: Name des Markts, Datum, Uhrzeit, Adresse und eine E-Mail-Adresse für Rückfragen."}</li><li>Wir prüfen die Angaben und veröffentlichen den Termin im Kalender, auf der Seite deines Bezirks und auf einer eigenen Seite für deinen Markt.</li><li>Regelmäßige Märkte tragen wir als Serie ein. Du musst nicht jeden Termin einzeln melden.</li><li>Ändert sich etwas oder fällt ein Termin aus, gib uns kurz Bescheid. Wir kennzeichnen den Termin dann als abgesagt.</li></ol>
<h2>Was wir veröffentlichen</h2><p>Name und Adresse des Markts, Termine, Uhrzeiten und den Namen des Veranstalters. Deine E-Mail-Adresse veröffentlichen wir nicht. Mehr dazu in den <a href="/datenschutz/">Datenschutzhinweisen</a>. Du planst einen neuen Markt? Lies vorher, <a href="/ratgeber/flohmarkt-organisieren-genehmigung/">wo du in Hamburg nachfragst</a>.</p></div>
<div class="org block"><h2>Termin eintragen</h2><p>Mit ${FORM_MAIL ? "deiner E-Mail" : "dem Absenden"} bestätigst du, dass du den Markt veranstaltest oder dazu beauftragt bist und wir die Angaben veröffentlichen dürfen.</p>${!FORM ? `<p class="small">Das Formular ist bald verfügbar.</p>` : FORM_MAIL ? `<a class="btn" href="${esc(FORM)}">${ic("mail")}E-Mail schreiben</a><p class="small">An ${esc(decodeURIComponent(FORM.slice(7).split("?")[0]))}</p>` : `<a class="btn" href="${esc(FORM)}" rel="noopener">Zum Formular</a>${/docs\.google\.com\/forms|forms\.gle/i.test(FORM) ? `<p class="small">Das Formular wird von Google Formulare bereitgestellt.</p>` : ""}`}</div>
<section class="block kb-body" id="korrektur"><h2>Eintrag ändern oder entfernen</h2><p>Dein Markt steht im Kalender und etwas stimmt nicht, oder du möchtest nicht genannt werden? Schreib uns${FORM_MAIL ? ` eine <a href="${esc(FORM)}">E-Mail</a>` : ` über die Angaben im <a href="/impressum/">Impressum</a>`}. Wir korrigieren oder entfernen den Eintrag umgehend und ohne Rückfragen. Mehr dazu in den <a href="/datenschutz/">Datenschutzhinweisen</a>.</p></section>
<section class="block kb-body" id="waechter"><h2>Automatischer Termin-Check</h2><p>Damit der Kalender aktuell bleibt, ruft ${esc(NAME)} höchstens einmal pro Nacht die öffentliche Termin-Seite jedes eingetragenen Veranstalters ab und prüft, ob sich dort Datumsangaben geändert haben. In den Zugriffsprotokollen erscheint der Abruf als „FlohlotseBot“. Wir übernehmen dabei keine Texte und speichern nur die gefundenen Datumsangaben. Vorgaben in der robots.txt beachten wir. Du möchtest das für deine Website nicht? Eine kurze Nachricht genügt.</p></section>
<section class="block kb-body badge-box" id="badge"><h2>Für deine Website: Link zu deinen Terminen</h2><p>Dein Markt steht schon bei ${esc(NAME)}? Verlinke deine Seite bei uns, dann finden Besucher alle Termine, Uhrzeiten und die Anfahrt an einem Ort. Wähl deinen Markt aus und kopier den Code in deine Website.</p>
<label class="bdg-sel">Dein Markt<select id="bdgSel" data-site="${esc(SITE)}">${[...MARKETS].sort((a, b) => a.name.localeCompare(b.name, "de")).map(m => `<option value="${m.slug}">${esc(m.name)}</option>`).join("")}</select></label>
<div class="bdg-prev" id="bdgPrev" aria-label="Vorschau"></div>
<label class="bdg-code">Code für deine Website<textarea id="bdgCode" rows="4" readonly></textarea></label>
<button class="btn" id="bdgCopy" type="button">Code kopieren</button></section></article>`;
  if (!FORM) warn("Einstellungen", "Weder Formular-Link noch Impressum-E-Mail eingetragen. Auf der Seite Für Veranstalter steht so lange „bald verfügbar“.");
  layout({ p: "/veranstalter/", title: `Flohmarkt eintragen: kostenlos für Veranstalter | ${NAME}`, desc: "Veranstaltest du einen Flohmarkt in Hamburg oder im Umland? Trag deine Termine kostenlos ein. Wir prüfen jeden Eintrag und verlinken auf deine Seite.", body, nav: "org", ld: G([crumbLD([[NAME, "/"], ["Für Veranstalter"]])]) });
}

/* ---------------------------------------------------------------- Impressum und Datenschutz */
{
  const f = k => S[k] || "";
  const ph = (k, label) => f(k) ? esc(f(k)) : `<mark class="ph">${esc(label)}</mark>`;
  const need = IMP_NEED;
  const missing = need.filter(k => !f(k));
  if (missing.length) warn("Impressum", `Noch nicht ausgefüllt: ${missing.map(k => k.replace("Impressum: ", "")).join(", ")}. Die Seite ist bis dahin als Vorlage markiert.`);
  const note = missing.length ? '<div class="legal-note"><b>Vorlage, noch nicht vollständig.</b> Die gelb markierten Angaben fehlen noch im Blatt Einstellungen.</div>' : "";
  const mail = f("Impressum: E-Mail"), tel = f("Impressum: Telefon");
  const mailHTML = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(mail) ? `<a href="mailto:${esc(mail)}">${esc(mail)}</a>` : ph("Impressum: E-Mail", "E-Mail-Adresse");
  const telHTML = tel ? `<a href="tel:${esc(tel.replace(/[^\d+]/g, ""))}">${esc(tel)}</a>` : ph("Impressum: Telefon", "Telefonnummer");
  const addrHTML = `${ph("Impressum: Name oder Firma", "Vor- und Nachname oder Firma mit Rechtsform")}<br>${ph("Impressum: Straße", "Straße und Hausnummer")}<br>${ph("Impressum: PLZ und Ort", "PLZ und Ort")}<br>Deutschland`;
  const respHTML = f("Impressum: Verantwortlich nach § 18 MStV") ? esc(f("Impressum: Verantwortlich nach § 18 MStV")) : `${ph("Impressum: Name oder Firma", "Vor- und Nachname")}, Anschrift wie oben`;
  const lic = [
    IMGS.size ? `<h3>Bilder</h3><p>Die Bilder auf dieser Website sind Symbolbilder und zeigen keinen der hier gelisteten Flohmärkte.${ANY_KI ? " Einige wurden mit künstlicher Intelligenz erzeugt und sind am Bild als „KI-generiert“ gekennzeichnet." : ""}${f("Bildnachweis") ? " " + esc(f("Bildnachweis")) : ""}</p>${CRED_SRC && (CREDITS.werke || []).length ? `<p>Fotos von ${esc(CRED_SRC.name)}, kostenlose Lizenz mit Namensnennung: ${credLink()}. Verwendet werden Ausschnitte dieser Fotos:</p><ul>${CREDITS.werke.filter(w => /^https:\/\//.test(w[2] || "")).map(w => `<li>„${esc(w[0])}“, Urheber: ${esc(w[1])}, <a href="${esc(w[2])}" rel="noopener nofollow">zum Foto bei ${esc(CRED_SRC.name)}</a></li>`).join("")}</ul>` : ""}` : "",
    `<h3>Texte</h3><p>Texte auf dieser Website entstehen mit Unterstützung von künstlicher Intelligenz.</p>`,
    PLZ_ROWS.length ? `<h3>Postleitzahlen und Karte</h3><p>Postleitzahlen und ihre Lage: <a href="https://www.geonames.org" rel="noopener">GeoNames</a>, Lizenz <a href="https://creativecommons.org/licenses/by/4.0/deed.de" rel="noopener">CC BY 4.0</a>.${HAS_MAP ? ` Karte: <a href="https://leafletjs.com" rel="noopener">Leaflet</a> (BSD-2-Clause), Kartendaten © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap-Mitwirkende</a>, Lizenz ODbL.` : ""}</p>` : "",
    `<h3>Wetter</h3><p>Quelle der Wettervorhersage: <a href="https://www.dwd.de" rel="noopener">Deutscher Wetterdienst</a> (DWD), Lizenz <a href="https://creativecommons.org/licenses/by/4.0/deed.de" rel="noopener">CC BY 4.0</a>, abgerufen über <a href="https://brightsky.dev" rel="noopener">Bright Sky</a>. Die Daten wurden zu kurzen Hinweisen zusammengefasst. Die Vorhersage wird einmal pro Aktualisierung der Website geladen und kann sich kurzfristig ändern.</p>`,
    fontsFound.length ? `<h3>Schriften</h3><p>${[...new Set(fontsFound.map(x => x.fam))].join(", ")}: SIL Open Font License 1.1 (<a href="/fonts/OFL.txt">Lizenztext und Urhebervermerke</a>).</p>` : "",
    `<h3>Icons</h3><p><a href="https://phosphoricons.com" rel="noopener">Phosphor Icons</a>, MIT-Lizenz (<a href="/assets/icons-lizenz.txt">Lizenztext</a>). Frosch-Icon: <a href="https://fontawesome.com" rel="noopener">Font Awesome Free</a>, Lizenz <a href="https://creativecommons.org/licenses/by/4.0/deed.de" rel="noopener">CC BY 4.0</a>, unverändert.</p>`].join("");
  const imp = crumbs([[NAME, "/"], ["Impressum"]]) + `<article class="kb"><h1>Impressum</h1>${note}<div class="kb-body legal">
<h2>Angaben gemäß § 5 DDG</h2><p>${addrHTML}</p>
${f("Impressum: Vertreten durch") ? `<p>Vertreten durch: ${esc(f("Impressum: Vertreten durch"))}</p>` : ""}
<h2>Kontakt</h2><p>E-Mail: ${mailHTML}<br>Telefon: ${telHTML}</p>
${f("Impressum: Register") || f("Impressum: USt-IdNr.") ? `<h2>Register und Umsatzsteuer</h2><p>${esc(f("Impressum: Register"))}${f("Impressum: Register") && f("Impressum: USt-IdNr.") ? "<br>" : ""}${f("Impressum: USt-IdNr.") ? "Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: " + esc(f("Impressum: USt-IdNr.")) : ""}</p>` : ""}
<h2>Verantwortlich für den Inhalt gemäß § 18 Abs. 2 MStV</h2><p>${respHTML}</p>
<h2>Verbraucherstreitbeilegung</h2><p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
<h2>Kostenlos und unabhängig</h2><p>${esc(NAME)} ist für Besucher und Veranstalter kostenlos. Es gibt keine bezahlten Einträge, keine bezahlten Platzierungen und keine Werbung.</p>
<h2>Hinweis zu Termindaten</h2><p>Alle Termine beruhen auf öffentlichen Angaben der jeweiligen Veranstalter. Wir prüfen sie sorgfältig, können aber nicht garantieren, dass ein Markt wie angegeben stattfindet. Maßgeblich sind die Angaben des Veranstalters.</p>
<h2>Links zu anderen Websites</h2><p>Wir verlinken auf Websites von Veranstaltern und auf Kartendienste. Für die Inhalte dieser Seiten sind deren Betreiber verantwortlich. Beim Setzen der Links haben wir keine Rechtsverstöße erkannt.</p>
<h2>Fehler oder Rechtsverletzung melden</h2><p>Stimmt ein Eintrag nicht, funktioniert ein Link nicht mehr oder siehst du deine Rechte durch einen Inhalt verletzt? Schreib uns an die E-Mail-Adresse oben. Wir prüfen die Meldung und ändern oder entfernen den Inhalt umgehend. Veranstalter finden den kurzen Weg unter <a href="/veranstalter/#korrektur">Eintrag ändern oder entfernen</a>.</p>
<h2>Nutzung der Inhalte</h2><p>Bitte übernimm Texte und Bilder dieser Website nicht ohne Rückfrage. Die Schilder und Preisschilder darfst du für deinen eigenen Stand frei ausdrucken und verwenden.</p>
<h2>Quellen und Lizenzen</h2>${lic}
<h2>Datenschutz</h2><p>Wie wir mit Daten umgehen und warum diese Website ohne Cookie-Banner auskommt, steht in der <a href="/datenschutz/">Datenschutzerklärung</a>.</p></div></article>`;
  layout({ p: "/impressum/", title: `Impressum | ${NAME}`, desc: `Impressum von ${NAME}.`, body: imp, noindex: true });
  const isGitHub = /github/i.test(f("Datenschutz: Hoster"));
  const formKind = !FORM ? "mail" : /^mailto:/i.test(FORM) ? "mail" : /docs\.google\.com\/forms|forms\.gle/i.test(FORM) ? "google" : "other";
  const formHost = formKind === "other" ? (() => { try { return new URL(FORM).hostname; } catch { return "einem externen Anbieter"; } })() : "";
  const dsMissing = ["Datenschutz: Hoster", ...(isGitHub ? [] : ["Datenschutz: Löschfrist Logdateien (Tage)"]), "Datenschutz: Löschfrist Formular", "Datenschutz: Stand"].filter(k => !f(k));
  if (dsMissing.length) warn("Datenschutz", `Noch nicht ausgefüllt: ${dsMissing.map(k => k.replace("Datenschutz: ", "")).join(", ")}.`);
  const ds = crumbs([[NAME, "/"], ["Datenschutz"]]) + `<article class="kb"><h1>Datenschutzerklärung</h1>${missing.length || dsMissing.length ? '<div class="legal-note"><b>Vorlage, noch nicht vollständig.</b> Gelb markierte Angaben im Blatt Einstellungen ergänzen und die Erklärung vor dem Livegang fachlich prüfen lassen.</div>' : ""}<div class="kb-body legal">
<h2>1. Verantwortlicher</h2><p>Verantwortlich für die Datenverarbeitung auf dieser Website im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:</p><p>${addrHTML}<br>E-Mail: ${mailHTML}</p><p>Einen Datenschutzbeauftragten haben wir nicht benannt, weil wir dazu gesetzlich nicht verpflichtet sind. Fragen zum Datenschutz beantworten wir unter der genannten E-Mail-Adresse.</p>
${isGitHub
  ? `<h2>2. Hosting und Server-Logdateien</h2><p>Die Website wird über GitHub Pages bereitgestellt, einen Dienst der GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA. Beim Aufruf einer Seite speichert GitHub die IP-Adresse der Besucher zu Sicherheitszwecken, außerdem technische Daten wie Datum, Uhrzeit und aufgerufene Seite. Wir haben auf diese Daten keinen Zugriff. Wie lange GitHub sie speichert, legt GitHub fest (<a href="https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener">Datenschutzerklärung von GitHub</a>). Rechtsgrundlage ist unser berechtigtes Interesse, die Website sicher und zuverlässig auszuliefern (Art. 6 Abs. 1 lit. f DSGVO). Dabei können Daten in die USA übermittelt werden. GitHub ist nach dem EU-U.S. Data Privacy Framework zertifiziert, für das die EU-Kommission einen Angemessenheitsbeschluss erlassen hat (Art. 45 DSGVO).</p>`
  : `<h2>2. Hosting und Server-Logdateien</h2><p>Die Website wird bei ${ph("Datenschutz: Hoster", "Name und Sitz des Hosters")} betrieben. Beim Aufruf speichert der Server automatisch technische Daten wie IP-Adresse, Datum und Uhrzeit, aufgerufene Seite und Browser. Das ist nötig, um die Website sicher auszuliefern (Art. 6 Abs. 1 lit. f DSGVO). Die Daten werden nach ${ph("Datenschutz: Löschfrist Logdateien (Tage)", "Anzahl")} Tagen gelöscht, soweit der Hoster sie nicht länger zur Abwehr von Angriffen benötigt.${yes(f("Datenschutz: Vertrag mit Hoster")) ? " Mit dem Hoster haben wir einen Vertrag zur Auftragsverarbeitung geschlossen (Art. 28 DSGVO). Die Daten werden in Deutschland verarbeitet." : ""}</p>`}
<h2>3. Keine Inhalte von fremden Servern</h2>${INSTA ? `<p>Unser Instagram-Profil ist nur als gewöhnlicher Link eingebunden. Es werden keine Inhalte, Schaltflächen oder Skripte von Instagram geladen. Erst wenn du den Link antippst, wechselst du zu Instagram; ab dann gelten die Datenschutzhinweise von Meta Platforms Ireland Limited.</p>` : ""}<p>Schriften, Icons, Bilder, Skripte und die Kartensoftware gehören zur Website selbst und werden von unserem Hoster (Abschnitt 2) mit ausgeliefert. Beim Aufruf einer Seite wird keine Verbindung zu Google, zu sozialen Netzwerken oder zu anderen Drittanbietern aufgebaut. Auch die Wettervorhersage laden nicht die Besucher: Wir rufen sie einmal bei der Aktualisierung der Website ab und liefern sie als festen Text mit aus.</p>
<h2>4. Cookies, Tracking und warum es hier keinen Cookie-Banner gibt</h2><p>Diese Website setzt keine Cookies. Sie speichert nichts auf deinem Gerät (auch nicht im sogenannten Local Storage) und liest dort nichts aus. Es gibt keine Reichweitenmessung, keine Werbung, keine Social-Media-Plugins, keine eingebetteten Videos und kein Nutzerprofil.</p><p>Eine Einwilligung ist nach § 25 Abs. 1 TDDDG nur nötig, wenn eine Website Informationen auf dem Gerät speichert oder von dort ausliest und das nicht unbedingt erforderlich ist. Beides passiert hier nicht. Es gibt also nichts, in das du einwilligen müsstest, und deshalb keinen Cookie-Banner.</p><p>Zwei Funktionen brauchen deine ausdrückliche Handlung und starten erst dann: die Karte („Karte laden“) und die Standortabfrage („Mein Standort“). Beide sind in Abschnitt 9 beschrieben.</p>
<h2>5. Termine eintragen</h2><p>${formKind === "google" ? "Veranstalter können Termine über ein Formular von Google Formulare (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland) einreichen. Das Formular öffnet sich erst, wenn du den Link anklickst. Dabei gelten zusätzlich die Datenschutzbestimmungen von Google." : formKind === "other" ? `Veranstalter können Termine über ein Formular bei ${esc(formHost)} einreichen. Das Formular öffnet sich erst, wenn du den Link anklickst. Dabei gelten zusätzlich die Datenschutzbestimmungen dieses Anbieters.` : "Veranstalter können uns Termine per E-Mail schicken."} Wir verarbeiten die Angaben zum Markt und deine E-Mail-Adresse. Die Marktdaten veröffentlichen wir nach Prüfung. Die E-Mail-Adresse nutzen wir nur für Rückfragen zu deinem Eintrag und veröffentlichen sie nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und f DSGVO. Wir löschen die E-Mail-Adresse ${ph("Datenschutz: Löschfrist Formular", "Frist, z. B. zwölf Monate nach dem letzten Termin")}.</p>
<h2>6. Kontakt per E-Mail</h2><p>Schreibst du uns eine E-Mail, verarbeiten wir deine Angaben, um die Anfrage zu beantworten (Art. 6 Abs. 1 lit. b oder f DSGVO), und löschen sie, sobald die Anfrage erledigt ist und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.${f("Datenschutz: E-Mail-Anbieter") ? ` Unser E-Mail-Postfach liegt bei ${esc(f("Datenschutz: E-Mail-Anbieter"))}.` : ""}</p>
<h2>7. Links zu anderen Websites</h2><p>Links wie „Route planen“ führen zu Google Maps oder zu Websites der Veranstalter. Erst wenn du einen solchen Link anklickst, werden Daten an den jeweiligen Anbieter übertragen. Das gilt auch für „Teilen“: Erst wenn du darauf tippst, öffnet sich die Teilen-Funktion deines Geräts mit einer vorformulierten Nachricht. Welche App du dann wählst, entscheidest du. Vorher werden keine Daten an andere Dienste übertragen.</p>
<h2>8. Angaben zu Märkten und Veranstaltern</h2><p>Im Kalender nennen wir zu jedem Markt den Namen des Veranstalters, manchmal ist das eine Einzelperson. Diese Angaben stammen aus öffentlich zugänglichen Quellen, in der Regel von der Website des Veranstalters oder aus dessen eigener Ankündigung, oder der Veranstalter hat sie uns selbst geschickt. Wir veröffentlichen sie, damit Besucher wissen, wer hinter einem Markt steht und an wen sie sich wenden können. Rechtsgrundlage ist unser berechtigtes Interesse an einem vollständigen und überprüfbaren Flohmarkt-Kalender (Art. 6 Abs. 1 lit. f DSGVO). Verarbeitet werden der Name des Veranstalters, die Angaben zum Markt und, soweit öffentlich, die Adresse seiner Website. Die Angaben bleiben veröffentlicht, solange der Markt im Kalender steht. Empfänger sind unser Hoster (Abschnitt 2) und Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland, weil wir den Kalender in einer Tabelle bei Google pflegen. Du bist Veranstalter und möchtest, dass ein Eintrag geändert oder entfernt wird? Dann schreib uns an die E-Mail-Adresse in Abschnitt 1. Du kannst der Veröffentlichung jederzeit widersprechen (Art. 21 DSGVO), wir ändern oder entfernen den Eintrag dann umgehend.</p>
<h2>9. Umkreissuche und Karte</h2><p>Die Umkreissuche nach Postleitzahl oder Standort läuft vollständig in deinem Browser. Postleitzahl und Standort werden nicht an uns übertragen und nicht gespeichert. Deinen Standort fragt der Browser nur ab, wenn du auf „Mein Standort“ tippst und der Abfrage in deinem Browser zustimmst. Wie dein Gerät den Standort ermittelt, legt dein Browser oder Betriebssystem fest; je nach Gerät nutzt es dafür einen eigenen Ortungsdienst seines Herstellers.</p>${HAS_MAP ? `<p>Die Karte auf der Seite „Alle Märkte“ lädt erst, wenn du auf „Karte laden“ tippst. Dann werden Kartenbilder von Servern der OpenStreetMap Foundation (St John’s Innovation Centre, Cowley Road, Cambridge, CB4 0WS, Vereinigtes Königreich) geladen, dabei wird deine IP-Adresse übertragen. Rechtsgrundlage ist deine Einwilligung durch den Klick (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Die Einwilligung gilt nur für den aktuellen Seitenaufruf und wird nicht gespeichert: Nach dem Neuladen der Seite bleibt die Karte wieder aus. Du kannst sie also jederzeit für die Zukunft widerrufen, indem du die Seite verlässt oder neu lädst. Für das Vereinigte Königreich gilt ein Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO). Die Kartensoftware (Leaflet) gehört zur Website selbst und wird nicht von OpenStreetMap geladen. Mehr dazu in der <a href="https://osmfoundation.org/wiki/Privacy_Policy" rel="noopener">Datenschutzerklärung der OpenStreetMap Foundation</a>.</p>` : ""}
<h2>10. Deine Rechte</h2><p>Soweit wir personenbezogene Daten von dir verarbeiten, hast du diese Rechte:</p><ul><li>Auskunft über deine Daten (Art. 15 DSGVO)</li><li>Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li><li>Löschung (Art. 17 DSGVO)</li><li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li><li>Datenübertragbarkeit (Art. 20 DSGVO)</li><li>Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO)</li></ul><p><b>Widerspruchsrecht (Art. 21 DSGVO):</b> Stützen wir eine Verarbeitung auf unser berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO), kannst du ihr aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit widersprechen.</p><p>Um ein Recht auszuüben, genügt eine formlose Nachricht an die E-Mail-Adresse in Abschnitt 1.</p><p><b>Beschwerde:</b> Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), zum Beispiel beim <a href="https://datenschutz-hamburg.de" rel="noopener">Hamburgischen Beauftragten für Datenschutz und Informationsfreiheit</a>.</p>
<h2>11. Pflicht zur Angabe von Daten, automatisierte Entscheidungen</h2><p>Du kannst diese Website nutzen, ohne Angaben zu deiner Person zu machen. Es besteht keine gesetzliche oder vertragliche Pflicht, uns Daten bereitzustellen. Automatisierte Entscheidungen oder Profiling (Art. 22 DSGVO) finden nicht statt.</p>
<p>Stand: ${ph("Datenschutz: Stand", "Datum")}</p></div></article>`;
  layout({ p: "/datenschutz/", title: `Datenschutz | ${NAME}`, desc: `Datenschutzerklärung von ${NAME}.`, body: ds, noindex: true });
}

/* ---------------------------------------------------------------- Flohmärkte in Zahlen */
// Zitierbare Fakten aus dem eigenen Kalender, jede Nacht neu berechnet. Gut für Suchmaschinen und KI-Antworten.
const STATS_P = "/flohmarkt-hamburg-statistik/";
{
  const live = EVENTS.filter(e => !e.cancelled), n = MARKETS.length;
  const hh = MARKETS.filter(m => !(RBY[m.bez] || {}).umland), um = n - hh.length;
  const nf = x => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const byReg = REGIONS.map(r => ({ r, ms: MARKETS.filter(m => m.bez === r.k).length, evs: live.filter(e => e.m.bez === r.k).length })).filter(x => x.ms).sort((a, b) => b.ms - a.ms || b.evs - a.evs);
  const byDay = [6, 0, 5, 1, 2, 3, 4].map(d => ({ d, c: live.filter(e => e.date.getUTCDay() === d).length })).filter(x => x.c).sort((a, b) => b.c - a.c);
  const sa = (byDay.find(x => x.d === 6) || { c: 0 }).c, so = (byDay.find(x => x.d === 0) || { c: 0 }).c;
  const timed = live.filter(e => e.start), early = timed.filter(e => parseInt(e.start, 10) <= 7).length, late = timed.filter(e => parseInt(e.start, 10) >= 10).length;
  const startCount = {}; for (const e of timed) startCount[e.start] = (startCount[e.start] || 0) + 1;
  const topStart = Object.entries(startCount).sort((a, b) => b[1] - a[1])[0];
  const dayCount = {}; for (const e of live) dayCount[e.k] = (dayCount[e.k] || 0) + 1;
  const topDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const topDayEv = topDay ? live.find(e => e.k === topDay[0]) : null;
  const top = byReg[0], cr = [[NAME, "/"], ["Flohmärkte in Zahlen"]];
  const ans = `Der ${NAME}-Kalender führt aktuell ${n} Flohmärkte: ${hh.length} in Hamburg und ${um} im Umland bis 30 km. In den nächsten ${HORIZON} Tagen stehen ${nf(live.length)} Termine fest, ${pct(sa + so, live.length)} % davon an einem Samstag oder Sonntag. Stand: ${STAND}.`;
  const faq = [
    ["Wie viele Flohmärkte gibt es in Hamburg?", `${NAME} führt aktuell ${hh.length} Flohmärkte im Hamburger Stadtgebiet und ${um} weitere im Umland bis 30 km (Stand ${STAND}). Eine amtliche Zahl gibt es nicht, weil Flohmärkte nirgends zentral erfasst werden.`],
    ...(top ? [["In welchem Bezirk gibt es die meisten Flohmärkte?", `Im ${NAME}-Kalender liegt ${esc(top.r.name)} mit ${top.ms} Märkten vorn${byReg[1] ? `, gefolgt von ${esc(byReg[1].r.name)} mit ${byReg[1].ms}` : ""}.`]] : []),
    ["An welchem Wochentag sind die meisten Flohmärkte?", `Von ${nf(live.length)} Terminen der nächsten ${HORIZON} Tage fallen ${sa} auf einen Samstag und ${so} auf einen Sonntag.`],
    ...(topStart ? [["Wann öffnen Flohmärkte in Hamburg?", `Die häufigste Anfangszeit im Kalender ist ${hmText(topStart[0])} Uhr. ${pct(early, timed.length)} % der Termine beginnen bis 7 Uhr, ${pct(late, timed.length)} % erst ab 10 Uhr.`]] : []),
    ["Woher stammen die Zahlen?", `Aus dem ${NAME}-Kalender. Die Termine stammen von den Veranstaltern, die Seite wird jede Nacht neu berechnet. Gezählt werden nur Märkte, die im Kalender stehen.`]];
  const row = (a, b, c) => `<tr><td>${a}</td><td class="num">${b}</td>${c !== undefined ? `<td class="num">${c}</td>` : ""}</tr>`;
  const body = crumbs(cr) + `<article class="kb zahlen"><h1>Flohmärkte in Hamburg in Zahlen</h1>
<div class="byline"><span>${ic("pin")}${n} Märkte</span><span>${ic("cal")}${nf(live.length)} Termine</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(ans)}</p></div>
<div class="kb-body">
<h2>Flohmärkte nach Bezirk</h2><p>So verteilen sich die ${n} Märkte auf die Hamburger Bezirke und das Umland. Die Termine beziehen sich auf die nächsten ${HORIZON} Tage.</p>
<div class="tbl"><table><thead><tr><th>Bezirk oder Region</th><th class="num">Märkte</th><th class="num">Termine</th></tr></thead><tbody>${byReg.map(x => row(`<a href="/flohmarkt-hamburg/${x.r.k}/">${esc(x.r.name)}</a>`, x.ms, x.evs)).join("")}${row("<b>Gesamt</b>", `<b>${n}</b>`, `<b>${nf(live.length)}</b>`)}</tbody></table></div>
<h2>Flohmärkte nach Art</h2><p>Ein Markt kann zu mehreren Arten gehören, zum Beispiel überdacht und groß.</p>
<div class="tbl"><table><thead><tr><th>Art</th><th class="num">Märkte</th></tr></thead><tbody>${[...CATS_ON].sort((a, b) => b.ms.length - a.ms.length).map(c => row(`<a href="/${c.s}/">${esc(c.chip)}</a>`, c.ms.length)).join("")}</tbody></table></div>
<h2>Termine nach Wochentag</h2><p>${sa + so} von ${nf(live.length)} Terminen liegen am Wochenende.${topDayEv ? ` Der Tag mit den meisten Flohmärkten im Zeitraum ist ${fmtDateY(topDayEv.date)} mit ${topDay[1]} Märkten.` : ""}</p>
<div class="tbl"><table><thead><tr><th>Wochentag</th><th class="num">Termine</th><th class="num">Anteil</th></tr></thead><tbody>${byDay.map(x => row(WDL[x.d], x.c, pct(x.c, live.length) + " %")).join("")}</tbody></table></div>
${topStart ? `<h2>Uhrzeiten</h2><p>Die häufigste Anfangszeit ist ${hmText(topStart[0])} Uhr (${topStart[1]} Termine). ${early} Termine beginnen bis 7 Uhr und sind etwas für <a href="/termine/">Frühaufsteher</a>, ${late} beginnen erst ab 10 Uhr. Wann sich welche Uhrzeit lohnt, steht im Ratgeber ${KBY["beste-uhrzeit-flohmarkt"] ? `<a href="/ratgeber/beste-uhrzeit-flohmarkt/">Wann ist die beste Uhrzeit für den Flohmarkt?</a>` : "zur besten Uhrzeit"}.</p>` : ""}
<h2>So entstehen die Zahlen</h2><p>Alle Angaben werden jede Nacht aus dem ${esc(NAME)}-Kalender berechnet. Gezählt werden Flohmärkte in Hamburg und im Umkreis von rund 30 km, die im Kalender stehen. Die Termine stammen von den Veranstaltern. Es ist keine amtliche Statistik: Märkte, die wir noch nicht kennen, fehlen. Wer die Zahlen zitiert, nennt bitte ${esc(NAME)} (${esc(SITE.replace(/^https?:\/\//, ""))}) und das Datum als Quelle.</p></div>
${faqHTML(faq)}</article>`;
  layout({ p: STATS_P, title: `Flohmärkte in Hamburg in Zahlen: Statistik ${YEAR} | ${NAME}`, desc: `Wie viele Flohmärkte gibt es in Hamburg? ${n} Märkte, ${nf(live.length)} Termine, Verteilung nach Bezirk, Art, Wochentag und Uhrzeit. Täglich neu berechnet.`, body,
    ld: G([crumbLD(cr), faqLD(faq), { "@type": "Dataset", name: "Flohmärkte in Hamburg und Umgebung in Zahlen", description: plain(ans), url: SITE + STATS_P, dateModified: key(TODAY), creator: { "@type": "Organization", name: NAME, url: SITE + "/" }, spatialCoverage: "Hamburg und Umland bis 30 km", isAccessibleForFree: true }]) });
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
const withBase = t => BASE ? t.replace(/srcset="([^"]*)"/g, (m, v) => `srcset="${v.replace(/(^|,\s*)\/(?!\/)/g, `$1${BASE}/`)}"`).replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`).replace(/url\("\/fonts\//g, `url("${BASE}/fonts/`) : t;
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
if (PLZ_ROWS.length) fs.writeFileSync(path.join(OUT, "assets/plz.json"), JSON.stringify(PLZ_C));
if (HAS_MAP) for (const f of ["leaflet.js", "leaflet.css"]) fs.copyFileSync(path.join(ROOT, "src", f), path.join(OUT, "assets", f));
fs.writeFileSync(path.join(OUT, "assets/icons-lizenz.txt"), ICON_LICENSE);
fs.writeFileSync(path.join(OUT, "assets/icons.svg"), SPRITE_FILE);
if (WATCH_ON) fs.writeFileSync(path.join(OUT, "assets/waechter.json"), JSON.stringify(WATCH));
fs.mkdirSync(path.join(OUT, "assets/schilder"), { recursive: true });
for (const t of SIGNS) fs.writeFileSync(path.join(OUT, signImg(t).slice(1)), signPreviewSVG(t));
if (IMGS.size) { fs.mkdirSync(path.join(OUT, "assets/img"), { recursive: true }); for (const x of IMGS) fs.copyFileSync(path.join(imgDir, x), path.join(OUT, "assets/img", imgOut(x))); }
if (fontsFound.length) {
  fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true }); for (const x of fontsFound) fs.copyFileSync(path.join(fontDir, x.f), path.join(OUT, "fonts", x.f));
  // Die Open Font License verlangt, dass Urhebervermerk und Lizenztext mit den Schriften ausgeliefert werden
  const FONT_C = { "Bricolage Grotesque": "Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)", "Figtree": "Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree)", "DM Mono": "Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono)" };
  fs.writeFileSync(path.join(OUT, "fonts/OFL.txt"), [...new Set(fontsFound.map(x => FONT_C[x.fam]).filter(Boolean))].join("\n") + "\n\n" + OFL_TEXT + "\n");
}
const indexable = [...pages].filter(([p, pg]) => !pg.noindex && p !== "/404.html").map(([p]) => p);
// Sitemap, bei den Schilder-Seiten mit Vorschaubildern für die Google-Bildersuche
// Änderungsdatum je Seite: bleibt stehen, solange sich der Inhalt nicht ändert (Google nutzt lastmod nur, wenn es verlässlich ist).
// Der Merkzettel liegt unter /assets/seiten-stand.json auf der Website und wird beim nächsten Bau von dort gelesen.
const LASTMOD = {}, PAGE_STATE = {};
{
  const { createHash } = await import("node:crypto");
  let old = {};
  if (process.env.SHEET_ID || process.env.SEITENSTAND === "an") { try { const r = await fetch(SITE + "/assets/seiten-stand.json", { signal: AbortSignal.timeout(8000) }); if (r.ok) { const j = await r.json(); if (j && typeof j === "object") old = j; } } catch { /* erster Lauf: alle Seiten bekommen das heutige Datum */ } }
  const today = key(TODAY);
  for (const p of indexable) {
    const sig = createHash("sha1").update(pages.get(p).html.split(STAND).join("").split(today).join("")).digest("hex").slice(0, 12), o = old[p];
    const d = Array.isArray(o) && o[0] === sig && /^\d{4}-\d{2}-\d{2}$/.test(o[1]) && o[1] <= today ? o[1] : today;
    LASTMOD[p] = d; PAGE_STATE[p] = [sig, d];
  }
}
fs.writeFileSync(path.join(OUT, "assets/seiten-stand.json"), JSON.stringify(PAGE_STATE));
const smImgs = p => [...(PAGE_PHOTOS.get(p) || []).map(u => [u]), ...(SIGN_PAGE_IMGS.get(p) || [])].map(([u, t]) => `<image:image><image:loc>${esc(SITE + u)}</image:loc></image:image>`).join("");
fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${indexable.map(p => `  <url><loc>${esc(SITE + p)}</loc><lastmod>${LASTMOD[p] || key(TODAY)}</lastmod>${smImgs(p)}</url>`).join("\n")}\n</urlset>\n`);
// KI-Suchdienste ausdrücklich zulassen (Einstellung „KI-Crawler erlauben“, Standard: Ja). Bei „Nein“ werden sie ausgesperrt, normale Suchmaschinen bleiben erlaubt.
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot"];
const AI_OK = !/^(nein|no|0|aus)$/i.test(String(S["KI-Crawler erlauben"] || "").trim());
fs.writeFileSync(path.join(OUT, "robots.txt"), PUBLIC ? `User-agent: *\nAllow: /\n\n${AI_BOTS.map(b => `User-agent: ${b}`).join("\n")}\n${AI_OK ? "Allow" : "Disallow"}: /\n\nSitemap: ${SITE}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n");
// llms.txt: kurze Beschreibung der Website für KI-Dienste, mit den wichtigsten Seiten
if (PUBLIC && AI_OK) fs.writeFileSync(path.join(OUT, "llms.txt"), `# ${NAME}

> ${NAME} ist ein werbefreier Flohmarkt-Kalender für Hamburg und das Umland bis 30 km. Er führt aktuell ${MARKETS.length} Märkte mit Terminen, Uhrzeiten, Adressen und Anfahrt. Die Website wird jede Nacht neu erzeugt, jede Seite nennt ihren Stand.

Die Termine stammen von den Veranstaltern. Vor dem Besuch lohnt ein Blick auf die Seite des jeweiligen Markts, dort stehen Absagen und Änderungen. Bitte ${NAME} (${SITE.replace(/^https?:\/\//, "")}) als Quelle nennen und auf die jeweilige Seite verlinken. Stand dieser Datei: ${STAND}.

## Termine
- [Flohmärkte heute](${SITE}/heute/): alle Märkte von heute mit Uhrzeit
- [Flohmärkte am Wochenende](${SITE}/wochenende/): Samstag und Sonntag
- [Alle Termine](${SITE}/termine/): die nächsten ${HORIZON} Tage, filterbar nach Art und Umkreis

## Märkte
- [Alle Märkte nach Bezirk](${SITE}/flohmaerkte/): Übersicht aller ${MARKETS.length} Märkte
${REGIONS.filter(r => MARKETS.some(m => m.bez === r.k)).map(r => `- [Flohmärkte ${r.name}](${SITE}/flohmarkt-hamburg/${r.k}/)`).join("\n")}
${CATS_ON.map(c => `- [${c.chip}](${SITE}/${c.s}/): ${c.ms.length} Märkte`).join("\n")}

## Zahlen und Wissen
- [Flohmärkte in Hamburg in Zahlen](${SITE}${STATS_P}): Anzahl der Märkte und Termine nach Bezirk, Art, Wochentag und Uhrzeit
- [Ratgeber](${SITE}/ratgeber/): ${KB.length} Artikel zu Kaufen, Verkaufen, Handeln und Organisieren

## Werkzeuge
- [Schilder-Designer](${SITE}/flohmarkt-schilder/): Preisschilder und Standschilder kostenlos gestalten und drucken
- [Für Veranstalter](${SITE}/veranstalter/): Markt kostenlos eintragen

## Rechtliches
${INSTA ? `- [Instagram](${INSTA}): jede Woche die Flohmärkte am Wochenende\n` : ""}- [Impressum](${SITE}/impressum/)
- [Datenschutz](${SITE}/datenschutz/)
`);
if (!PUBLIC) warn("Google", "Die Website ist noch nicht für Google freigegeben (Einstellung „Für Google freigeben“ = Nein). Das ist richtig, solange ihr testet.");
if (process.env.CNAME) fs.writeFileSync(path.join(OUT, "CNAME"), process.env.CNAME + "\n");
// Einstellungen für Webspace mit Apache (z. B. Hetzner). GitHub Pages beachtet die Datei nicht.
{
  const host = new URL(SITE).hostname, bare = host.replace(/^www\./, ""), rx = bare.replace(/\./g, "\\.");
  fs.writeFileSync(path.join(OUT, ".htaccess"), `# Automatisch erzeugt von build.mjs. Änderungen hier gehen beim nächsten Bau verloren.
Options -Indexes
ErrorDocument 404 /404.html
AddDefaultCharset utf-8

<IfModule mod_rewrite.c>
RewriteEngine On
# Immer https://${host} (gilt nur für die eigene Domain, nicht für die Test-Adresse des Hosters)
RewriteCond %{HTTP_HOST} ^${rx}$ [NC]
RewriteRule ^ https://${host}%{REQUEST_URI} [R=301,L]
RewriteCond %{HTTP_HOST} ^www\\.${rx}$ [NC]
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !=https
RewriteRule ^ https://${host}%{REQUEST_URI} [R=301,L]
</IfModule>

<IfModule mod_mime.c>
AddType font/woff2 .woff2
AddType image/webp .webp
AddType image/svg+xml .svg
</IfModule>

<IfModule mod_deflate.c>
AddOutputFilterByType DEFLATE text/html text/css text/plain application/javascript text/javascript image/svg+xml application/json application/xml text/xml
</IfModule>

<IfModule mod_expires.c>
ExpiresActive On
ExpiresDefault "access plus 1 hour"
ExpiresByType text/html "access plus 10 minutes"
ExpiresByType application/json "access plus 10 minutes"
ExpiresByType application/xml "access plus 1 hour"
ExpiresByType text/css "access plus 1 day"
ExpiresByType application/javascript "access plus 1 day"
ExpiresByType text/javascript "access plus 1 day"
ExpiresByType image/svg+xml "access plus 1 week"
ExpiresByType image/webp "access plus 1 month"
ExpiresByType image/jpeg "access plus 1 month"
ExpiresByType font/woff2 "access plus 1 year"
</IfModule>

<IfModule mod_headers.c>
Header set X-Content-Type-Options "nosniff"
Header set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
`);
}

/* ---------------------------------------------------------------- Bericht */
const evCount = [...pages.values()].reduce((n, pg) => n + (pg.html.match(/"@type":"Event"/g) || []).length, 0);
const summary = [`# ${NAME}: Website gebaut`, "", `Stand ${STAND} · ${pages.size} Seiten (${PUBLIC ? indexable.length + " für Google" : "noch nicht für Google freigegeben"}) · ${MARKETS.length} Märkte · ${EVENTS.length} Termine in den nächsten ${HORIZON} Tagen · ${KB.length} Ratgeber-Artikel · ${evCount} Event-Auszeichnungen`, ""];
if (warnings.length) {
  summary.push(`## ${warnings.length} Hinweise zum Prüfen`, "", "| Bereich | Hinweis |", "|---|---|");
  for (const [b, t] of warnings) summary.push(`| ${b} | ${t.replace(/\|/g, "/")} |`);
} else summary.push("Keine Hinweise. Alles in Ordnung.");
if (WATCH_ROWS.length) {
  const rows = WATCH_ROWS.sort((a, b) => a.row[0].localeCompare(b.row[0]) || a.k.localeCompare(b.k));
  summary.push("", `## Termin-Wächter: ${rows.length} ${rows.length === 1 ? "Vorschlag" : "Vorschläge"} zum Einfügen`, "",
    "Diese Tage stehen neu auf Veranstalterseiten und fehlen in der Tabelle. **Erst auf der Seite des Veranstalters prüfen**, ob es wirklich ein Markttermin ist und ob die Uhrzeit stimmt (eingesetzt ist die übliche Uhrzeit des Markts). Dann die Zeilen markieren, kopieren und im Blatt „Termine“ in die erste freie Zeile einfügen. Die Spalten sind: Markt, Datum, Beginn, Ende, Status, Hinweis.", "",
    "```", ...rows.map(r => r.row.join("\t")), "```", "", "Quellen:", ...[...new Set(rows.map(r => r.src))].map(u => `- ${u}`));
}
const report = summary.join("\n") + "\n";
fs.writeFileSync(path.join(ROOT, "bericht.md"), report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
