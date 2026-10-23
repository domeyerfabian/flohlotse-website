// Flohlotse – Website-Generator
// Liest die Redaktionstabelle (Google Sheets oder lokale CSV-Dateien) und baut die komplette Website in den Ordner dist/.
// Keine Abhängigkeiten, läuft mit Node 18 oder neuer:  node build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, domainToUnicode } from "node:url";
import { createHash as hashOf } from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "dist");
// Versionskürzel für Stil und Skript: Ändert sich die Datei, ändert sich die Adresse, und Browser laden sofort die neue Fassung statt der gespeicherten.
const ver = f => { try { return "?v=" + hashOf("sha1").update(fs.readFileSync(path.join(ROOT, f))).digest("hex").slice(0, 8); } catch { return ""; } };
const JS_V = ver("src/site.js"), ICON_V = ver("src/icon.svg");
// Symbole für Browser-Tab, Lesezeichen, Startbildschirm und Google (liegen im Ordner src; fehlt eines, bleibt es beim einfachen Symbol)
const APP_ICONS = ["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
const HAS_ICONS = APP_ICONS.every(f => fs.existsSync(path.join(ROOT, "src", f)));
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
// info = true: nur zur Kenntnis (steht im Bericht unten), sonst: zu erledigen
const warn = (bereich, text, info = false) => { const k = bereich + "|" + text; if (!warnSeen.has(k)) { warnSeen.add(k); warnings.push([bereich, text, info]); } };

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
// Freiwillige Blätter: Fehlt das Blatt (oder liefert Google ein anderes Blatt), entfällt der Bereich ohne Fehler.
async function loadOpt(name, need) {
  if (!process.env.SHEET_ID && !fs.existsSync(path.join(ROOT, "daten", name + ".csv"))) return [];
  try { const rows = await loadTab(name); if (rows.length && need.every(c => c in rows[0])) return rows; } catch (e) { /* Blatt fehlt */ }
  warn(name, `Tabellenblatt „${name}“ nicht gefunden oder ohne die Spalten ${need.join(", ")}. Der Bereich wird ausgelassen.`, true); return [];
}
const [loaded, kcRows] = await Promise.all([Promise.all(TABS.map(loadTab)), loadOpt("Kauf-Check", ["Kennung", "Aktiv", "Bereich", "Artikel", "Kurz gesagt"])]);
TABS.forEach((t, i) => { data[t] = loaded[i]; });
data["Kauf-Check"] = kcRows;
const S = Object.fromEntries(data.Einstellungen.map(r => [r["Einstellung"], r["Wert"]]));
const siteRaw = (S["Website-Adresse"] || "").replace(/\/+$/, "");
const SITE = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(siteRaw) ? siteRaw : "https://www.example.org";
if (!siteRaw) warn("Einstellungen", "Website-Adresse fehlt. Links für Google zeigen so lange auf www.example.org.");
else if (SITE !== siteRaw) warn("Einstellungen", `Website-Adresse „${siteRaw}“ ist ungültig. Bitte nur die Domain eintragen, z. B. https://www.flohlotse.de.`);
const NAME = S["Name"] || "Flohlotse";
// Der Markenname wird überall so geschrieben wie in der Einstellung „Name“ – auch in Texten aus der Tabelle, in denen noch „Flohlotse“ steht.
if (NAME !== "Flohlotse") for (const t of TABS) if (t !== "Einstellungen") for (const r of data[t] || []) for (const k of Object.keys(r)) if (typeof r[k] === "string" && r[k].includes("Flohlotse")) r[k] = r[k].replace(/Flohlotse(?![A-Za-zäöüß])/g, NAME);
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
// Briefumschlag „Termin melden“ (Kopfzeile und Marktseiten): öffnet ein kleines Fenster mit zwei vorbereiteten E-Mails.
// Nur wenn Termine per E-Mail kommen. Ist ein Formular eingetragen, führt der Briefumschlag direkt dorthin. Nichts wird gespeichert.
const MS_ADDR = FORM_MAIL ? decodeURIComponent(FORM.slice(7).split("?")[0]) : "";
const msMail = (subj, lines) => `mailto:${MS_ADDR}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent([`Hallo ${NAME},`, "", ...lines, "", "Viele Grüße", ""].join("\r\n"))}`;
const msSheet = mk => {
  if (!MS_ADDR) return "";
  const u = mk ? `${SITE}/flohmarkt/${mk.slug}/` : "";
  const neu = mk ? msMail(`Termin für ${mk.name}`, ["ich möchte einen Termin nachreichen.", "", `Markt: ${mk.name}`, u, "", "Datum: ", "Uhrzeit von/bis: ", "Quelle oder Link (falls vorhanden): "])
    : msMail("Termin melden", ["ich möchte einen Flohmarkt-Termin melden.", "", "Name des Markts: ", "Datum: ", "Uhrzeit von/bis: ", "Adresse: ", "Link zur Website (falls vorhanden): ", "", "Ich veranstalte den Markt selbst: ja / nein"]);
  const alt = msMail(mk ? `Änderung: ${mk.name}` : "Änderung oder Absage", [mk ? "bei diesem Markt hat sich etwas geändert." : "bei einem Termin hat sich etwas geändert.", "", ...(mk ? [`Markt: ${mk.name}`, u, ""] : ["Name des Markts: "]), "Betroffener Termin (Datum): ", "Was ist neu? (abgesagt, verschoben, andere Uhrzeit): ", "Quelle oder Link (falls vorhanden): "]);
  return `<dialog class="ms" id="mailSheet" aria-labelledby="msH"><div class="ms-grab" aria-hidden="true"></div><button type="button" class="ms-x" aria-label="Schließen" data-ms-close>${ic("x")}</button>
<p class="ms-h" id="msH">${mk ? `Termin für ${esc(mk.name)} melden` : "Termin melden"}</p><p class="ms-p">${mk ? "Fehlt ein Termin, hat sich die Uhrzeit geändert oder fällt er aus? Wir prüfen jeden Hinweis." : "Neuer Flohmarkt, fehlender Termin oder eine Änderung? Schreib uns kurz, wir prüfen jeden Hinweis."}</p>
<a class="ms-opt" href="${esc(neu)}"><span class="ms-ic">${ic("cal")}</span><span><b>${mk ? "Termin nachreichen" : "Neuen Termin melden"}</b><small>${mk ? "Datum und Uhrzeit, mehr nicht" : "Markt, Datum, Uhrzeit und Adresse"}</small></span>${ic("chev")}</a>
<a class="ms-opt" href="${esc(alt)}"><span class="ms-ic dk">${ic("update")}</span><span><b>Änderung oder Absage</b><small>Termin verschoben, abgesagt oder falsch</small></span>${ic("chev")}</a>
<div class="ms-alt"><span>Kein Mail-Programm?</span><button type="button" data-copy="${esc(MS_ADDR)}">E-Mail-Adresse kopieren</button></div></dialog>`;
};
const mkOfPath = p => { const r = /^\/flohmarkt\/([^/]+)\/$/.exec(p); return r ? MARKETS.find(x => x.slug === r[1]) || null : null; };
const msLink = (cls, inner, label, fallback = "/veranstalter/") => MS_ADDR ? `<a class="${cls}" href="${fallback}"${label ? ` aria-label="${label}"` : ""} aria-haspopup="dialog" data-ms>${inner}</a>` : FORM ? `<a class="${cls}" href="${esc(FORM)}"${label ? ` aria-label="${label}"` : ""} rel="noopener">${inner}</a>` : "";
const IMP_NEED = ["Impressum: Name oder Firma", "Impressum: Straße", "Impressum: PLZ und Ort", "Impressum: E-Mail", "Impressum: Telefon"];
const IMP_OK = IMP_NEED.every(k => S[k]);
const PUBLIC = yes(S["Für Google freigeben"]) && IMP_OK;
if (yes(S["Für Google freigeben"]) && !IMP_OK) warn("Google", "„Für Google freigeben“ steht auf Ja, aber das Impressum ist noch nicht vollständig. Die Website bleibt für Google gesperrt, bis alle Pflichtangaben im Blatt Einstellungen stehen.");
const BASE = (process.env.BASE_PATH || "").replace(/\/+$/, "");

const todayStr = process.env.TODAY || new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const TODAY = new Date(todayStr + "T00:00:00Z");
const STAND = `${pad(TODAY.getUTCDate())}.${pad(TODAY.getUTCMonth() + 1)}.${TODAY.getUTCFullYear()}`;
// Artikel und ruhige Seiten nennen nicht den Tag des Baus, sondern den Tag, an dem sich ihr Inhalt zuletzt geändert hat.
// Der steht erst ganz am Ende fest (Vergleich mit dem Merkzettel der letzten Nacht), deshalb hier Platzhalter, die beim Schreiben ersetzt werden.
const AKT_ISO = "%%AKT_ISO%%", AKT_TIME = `<time datetime="${AKT_ISO}">%%AKT_DE%%</time>`, SEITE_TIME = `<time datetime="%%SEITE_ISO%%">%%SEITE_DE%%</time>`;
const END = addDays(TODAY, HORIZON);

const REGIONS = data.Bezirke.filter(r => validSlug(r["Kennung"], "Bezirke", r["Name"])).map(r => ({ k: r["Kennung"], name: r["Name"], umland: yes(r["Umland"]), im: r["Im Satz"] || "in " + r["Name"], kw: r["Suchbegriff"], h: r["Überschrift"], t: r["SEO-Titel"], d: r["SEO-Beschreibung"], intro: r["Einleitung"] }));
const RBY = Object.fromEntries(REGIONS.map(r => [r.k, r]));
const CLUSTERS = Object.fromEntries(data.Bereiche.filter(r => validSlug(r["Kennung"], "Bereiche", r["Name"])).map(r => [r["Kennung"], { t: r["Name"], p: r["Beschreibung"] }]));

const MARKETS = data["Märkte"].filter(r => yes(r["Aktiv"]) && r["Kennung"] && validSlug(r["Kennung"], "Märkte", r["Name"])).map(r => ({
  slug: r["Kennung"], name: r["Name"], short: r["Kurzname"] || r["Name"], satz: r["Satzanfang"] || r["Name"], place: r["Ort (Platz)"] || r["Name"],
  area: r["Stadtteil"], addr: r["Adresse"], bez: r["Bezirk"], org: r["Veranstalter"], tags: list(r["Kategorien"]), rhythm: r["Rhythmus kurz"],
  when: r["Rhythmus im Satz"], note: r["Kurzbeschreibung"], intro: r["Einleitung"], tips: lines(r["Tipps"]), hint: r["Hinweis"], oepnv: r["Haltestelle"],
  kw: r["Suchbegriff"], t: r["SEO-Titel"], d: r["SEO-Beschreibung"], kb: list(r["Ratgeber-Artikel"]), events: [],
  geo: r["Koordinaten"] || "", entry: String(r["Eintritt"] || "").trim(),
  // Freiwillige Spalten für Besucher und Verkäufer (nur Angaben des Veranstalters)
  park: String(r["Parken"] || "").trim(), food: String(r["Essen & Trinken"] || "").trim(), fee: String(r["Standgebühr"] || "").trim(),
  signup: /^https?:\/\/[^\s"<>]+$/i.test(String(r["Anmeldung"] || "").trim()) ? String(r["Anmeldung"]).trim() : "", signupHint: String(r["Anmeldung Hinweis"] || "").trim(),
  sellers: String(r["Händler"] || "").trim(),
  web: /^https?:\/\/[^\s"<>]+$/i.test(String(r["Veranstalter-Website"] || "").trim()) ? String(r["Veranstalter-Website"]).trim() : ""
}));
if (!MARKETS.length) throw new Error("Keine aktiven Märkte gefunden (Blatt „Märkte“, Spalte „Aktiv“). Die Website wurde nicht veröffentlicht, damit keine leere Seite online geht.");
const MBY = Object.fromEntries(MARKETS.map(m => [m.slug, m]));
// Märkte mit Aktiv = Nein: ihre Termine und Serien werden ohne Hinweis übersprungen (nur wirklich unbekannte Kennungen melden)
const INACTIVE = new Set(data["Märkte"].filter(r => r["Kennung"] && !yes(r["Aktiv"])).map(r => r["Kennung"]));
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
  const m = MBY[r["Markt"]]; if (!m) { if (r["Markt"] && !INACTIVE.has(r["Markt"])) warn("Serien", `Markt „${r["Markt"]}“ ist unbekannt.`); continue; }
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
  (m.rules = m.rules || []).push({ wd, nth: nth ? +nth[1] : 0, last, months, skip, from, to: r["Gültig bis"] ? to : null });
}
// Fällt ein Tag unter eine Serie des Markts? (auch für Tage jenseits der Vorschau; nutzt der Termin-Wächter)
const ruleHits = (r, d) => d.getUTCDay() === r.wd && !r.skip.has(key(d)) && (!r.months || r.months.has(d.getUTCMonth() + 1)) && (!r.nth || Math.ceil(d.getUTCDate() / 7) === r.nth) && (!r.last || addDays(d, 7).getUTCMonth() !== d.getUTCMonth()) && d >= r.from && (!r.to || d <= r.to);
for (const r of data.Termine) {
  const m = MBY[r["Markt"]]; if (!m) { if (r["Markt"] && !INACTIVE.has(r["Markt"])) warn("Termine", `Markt „${r["Markt"]}“ ist unbekannt.`); continue; }
  if (!r["Datum"]) { warn("Termine", `${m.name}: Zeile ohne Datum. Falls ein Datum eingetragen ist, die Spalte als „Nur Text“ formatieren und das Datum neu eintippen.`); continue; }
  const d = parseDate(r["Datum"], m.name); if (!d || d < TODAY) continue;
  // Status „Kein Termin“: Der Tag ist kein Markttermin (z. B. ein Fehlalarm des Termin-Wächters). Er erscheint nirgends, der Wächter meldet ihn aber nicht mehr.
  if (/kein\s*(markt)?termin|ignorier/i.test(r["Status"] || "")) continue;
  // Termine jenseits der Vorschau („Tage im Voraus“) stehen nicht im Kalender, aber auf der Marktseite als nächster bekannter Termin.
  if (d > END) {
    const k = key(d); m.later = (m.later || []).filter(x => x.k !== k); // steht ein Tag doppelt in der Tabelle, gilt wie überall die letzte Zeile
    if (!/abgesagt|fällt aus|entfällt/i.test(r["Status"] || "")) { const st = parseTime(r["Beginn"], m.name) || ""; m.later.push({ m, date: d, k, start: st, end: checkEnd(st, parseTime(r["Ende"], m.name) || "", `${m.name} am ${fmtDate(d)}`), cancelled: false, note: r["Hinweis"] || "", far: true }); }
    if (!m.later.length) delete m.later;
    continue;
  }
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
// Für den Bericht: Termine der nächsten drei Wochen ohne Uhrzeit (eine Sammelzeile statt vieler Einzelzeilen)
const NO_TIME = EVENTS.filter(e => !e.start && !e.cancelled && (e.date - TODAY) / 864e5 < 21);
for (const m of MARKETS) if (m.later) m.later.sort((a, b) => a.date - b.date);
const fmtDateY = d => `${fmtDate(d)} ${d.getUTCFullYear()}`;
// nächster bekannter Termin eines Markts: im Vorschau-Zeitraum oder, falls dort keiner liegt, der nächste spätere
const nextEv = m => m.events.find(e => !e.cancelled) || (m.later ? m.later[0] : null);
const fmtShortY = e => fmtShort(e.date) + (e.far ? e.date.getUTCFullYear() : "");
const NO_DATES = MARKETS.filter(m => !m.events.length && !m.later);
// Merkzettel der letzten Nacht (wird weiter unten für Sitemap und Notbremse gebraucht, hier schon für die „Neu“-Kennzeichnung)
let OLD_STATE = {};
// Zum Ausprobieren am eigenen Rechner: SEITENSTAND_DATEI=pfad/seiten-stand.json nimmt einen gespeicherten Merkzettel statt den von der Website
if (process.env.SEITENSTAND_DATEI) { try { const j = JSON.parse(fs.readFileSync(process.env.SEITENSTAND_DATEI, "utf8")); if (j && typeof j === "object") OLD_STATE = j; } catch { /* kein Merkzettel: alle Seiten bekommen das heutige Datum */ } }
else if (process.env.SHEET_ID || process.env.SEITENSTAND === "an") { try { const r = await fetch(SITE + "/assets/seiten-stand.json", { signal: AbortSignal.timeout(8000) }); if (r.ok) { const j = await r.json(); if (j && typeof j === "object") OLD_STATE = j; } } catch { /* erster Lauf: alle Seiten bekommen das heutige Datum */ } }
/* „Neu“: Ein Markt, den es beim letzten Bau noch nicht gab, trägt drei Tage lang ein „Neu“-Schild (Tag des Eintragens und die zwei folgenden).
   Der Tag des ersten Erscheinens steht im Merkzettel unter _neu. Beim allerersten Bau ohne Merkzettel gilt nichts als neu. */
const NEU = {};
{ const alt = OLD_STATE._neu && typeof OLD_STATE._neu === "object" ? OLD_STATE._neu : {}, hatStand = Object.keys(OLD_STATE).some(p => p.startsWith("/flohmarkt/")), heute = key(TODAY);
  for (const m of MARKETS) { const seit = /^\d{4}-\d{2}-\d{2}$/.test(String(alt[m.slug])) ? alt[m.slug] : hatStand && !(`/flohmarkt/${m.slug}/` in OLD_STATE) ? heute : ""; if (seit && (TODAY - new Date(seit + "T00:00:00Z")) / 864e5 < 3) NEU[m.slug] = seit; } }
const NEU_MS = MARKETS.filter(m => NEU[m.slug]);
const neuPill = m => NEU[m.slug] ? ' <span class="neu">Neu</span>' : "";

const KB = data.Ratgeber.filter(r => yes(r["Aktiv"]) && r["Kennung"] && validSlug(r["Kennung"], "Ratgeber", r["Überschrift"])).map(r => ({
  s: r["Kennung"], c: r["Bereich"], kw: r["Suchbegriff"], i: r["Suchabsicht"], t: r["SEO-Titel"], d: r["SEO-Beschreibung"], h: r["Überschrift"], a: r["Kurz gesagt"],
  b: String(r["Abschnitte"] || "").split(/\n(?=## )/).map(block => { const [h, ...p] = block.replace(/^## /, "").split("\n"); return [h.trim(), p.join("\n").trim()]; }).filter(x => x[0]),
  f: String(r["Häufige Fragen"] || "").split(/\n\s*\n/).map(b => { const q = /F:\s*([\s\S]*?)\nA:\s*([\s\S]*)/.exec(b.trim()); return q ? [q[1].trim(), q[2].trim()] : null; }).filter(Boolean),
  r: list(r["Verwandte Artikel"]), x: yes(r["Rechtshinweis"]), top: yes(r["Auf Startseite"])
}));
assertUnique(KB.map(a => a.s), "Ratgeber");
const KBY = Object.fromEntries(KB.map(a => [a.s, a]));
if (!KB.length) warn("Ratgeber", "Keine aktiven Ratgeber-Artikel gefunden.");
/* Kauf-Check: Prüfpunkte für häufige Flohmarkt-Artikel (Blatt „Kauf-Check“). Eine Zeile pro Artikel, ein Prüfpunkt pro Zeile in der Zelle.
   „Stichwort: Text“ wird zu fettem Stichwort; Zeilen mit „Tipp…:“ sind Hinweise ohne Ankreuzfeld. */
const KC_P = "/kauf-check/";
const KC_AREAS = {
  mode: { t: "Mode", p: "Jeans, Jacken, Polos und Trikots: Woran du Markenware und Fälschungen unterscheidest und worauf du beim Zustand achtest.", kb: ["vintage-kleidung-flohmarkt", "faelschungen-erkennen-flohmarkt"], cat: "frauenflohmarkt-hamburg" },
  schuhe: { t: "Schuhe", p: "Sneaker werden massenhaft gefälscht. Mit dem Code in der Zunge und ein paar Blicken prüfst du sie direkt am Stand.", kb: ["faelschungen-erkennen-flohmarkt", "vintage-kleidung-flohmarkt"] },
  taschen: { t: "Taschen & Accessoires", p: "Designertaschen und Sonnenbrillen gehören zu den meistgefälschten Dingen auf dem Flohmarkt. Diese Details verraten viel.", kb: ["faelschungen-erkennen-flohmarkt"] },
  schmuck: { t: "Uhren & Schmuck", p: "Stempel, Magnet, Gewicht: So unterscheidest du Gold und Silber von vergoldet und versilbert und erkennst falsche Luxusuhren.", kb: ["antiquitaeten-erkennen-flohmarkt", "faelschungen-erkennen-flohmarkt"] },
  spielzeug: { t: "Spielzeug", p: "LEGO, Pokémon-Karten, Steiff und Tonies: Was echt ist, was komplett ist und worauf du bei gebrauchtem Spielzeug achtest.", kb: ["flohmarkt-mit-kindern", "faelschungen-erkennen-flohmarkt"], cat: "kinderflohmarkt-hamburg" },
  elektronik: { t: "Moderne Elektronik", p: "Handys, Laptops, Kopfhörer und Konsolen: Neben Fälschungen ist das größte Risiko ein gesperrtes oder gestohlenes Gerät. So prüfst du beides.", kb: ["elektrogeraete-flohmarkt", "faelschungen-erkennen-flohmarkt"], tip: "Auf den meisten Flohmärkten gibt es keinen Strom. Nimm eine Powerbank und ein USB-C-Kabel mit und lass dir das Gerät eingeschaltet zeigen. Lässt es sich nicht einschalten oder nicht vor deinen Augen zurücksetzen, lieber Finger weg." },
  retro: { t: "Retro-Technik & Games", p: "Game Boy, alte Konsolen, Analogkameras und Plattenspieler: Nachbauten erkennen und Technik prüfen, auch ohne Steckdose.", kb: ["elektrogeraete-flohmarkt", "schallplatten-flohmarkt"] },
  medien: { t: "Musik, Bücher & Medien", p: "Schallplatten, Erstausgaben, Comics und Autogramme: Original, Nachdruck oder Kopie?", kb: ["schallplatten-flohmarkt", "antiquitaeten-erkennen-flohmarkt"], cat: "antikmarkt-hamburg" },
  kueche: { t: "Porzellan, Glas & Küche", p: "Bodenmarken lesen, Silber von versilbert unterscheiden, Haarrisse finden: der Check für Geschirr, Besteck und Töpfe.", kb: ["antiquitaeten-erkennen-flohmarkt"], cat: "antikmarkt-hamburg" },
  wohnen: { t: "Möbel & Wohnen", p: "Designerstühle, Teakmöbel, Teppiche und Bilder: Original oder Nachbau, Druck oder Gemälde?", kb: ["antiquitaeten-erkennen-flohmarkt", "zuruecklegen-lassen-flohmarkt"] },
  sammeln: { t: "Sammeln", p: "Münzen, Briefmarken, Emailleschilder und Füller: Wo Nachbauten häufig sind und woran du sie erkennst.", kb: ["antiquitaeten-erkennen-flohmarkt"], cat: "antikmarkt-hamburg" },
  sport: { t: "Fahrrad & Sport", p: "Gebrauchte Fahrräder sind ein guter Kauf, aber auch häufiges Diebesgut. So prüfst du Herkunft und Zustand.", kb: ["gekauft-wie-gesehen"], cat: "fahrradflohmarkt-hamburg" },
  kinder: { t: "Kinder & Baby", p: "Kinderwagen, Kindersitz und Babytrage: Bei Kindersachen zählt vor allem die Sicherheit.", kb: ["flohmarkt-mit-kindern", "kinderflohmarkt-verkaufen"], cat: "kinderflohmarkt-hamburg" },
  sonstiges: { t: "Beauty & Sonstiges", p: "Parfum, Messing und Kupfer: Was sonst noch häufig angeboten wird.", kb: ["faelschungen-erkennen-flohmarkt"] }
};
const kcPts = v => lines(v).map(l => { const m = /^([^:]{2,40}):\s+(.+)$/.exec(l), rest = m ? m[2] : l, [q, ...x] = rest.split(/\s+\|\s+/); return { l: m ? m[1] : "", x: q.trim(), d: x.join(" ").trim(), tip: /^Tipp\b/.test(l) }; });
const KC = data["Kauf-Check"].filter(r => yes(r["Aktiv"]) && r["Kennung"] && r["Artikel"] && validSlug(r["Kennung"], "Kauf-Check", r["Artikel"])).map(r => ({
  s: r["Kennung"], a: r["Bereich"], n: r["Artikel"], own: yes(r["Eigene Seite"]), kw: r["Suchwörter"] || "", k: r["Kurz gesagt"],
  e: kcPts(r["Echt"]), g: kcPts(r["Gesperrt oder gestohlen"]), z: kcPts(r["Zustand"]), f: lines(r["Fragen"]), m: list(r["Passende Märkte"]), t: r["SEO-Titel"] || "", d: r["SEO-Beschreibung"] || ""
})).filter(i => { if (KC_AREAS[i.a]) return true; warn("Kauf-Check", `${i.n}: Bereich „${i.a}“ ist unbekannt. Möglich: ${Object.keys(KC_AREAS).join(", ")}.`); return false; });
assertUnique(KC.map(i => i.s).concat(Object.keys(KC_AREAS)), "Kauf-Check");
const KC_ON = KC.length > 0;
const kcUrl = i => i.own ? `${KC_P}${i.s}/` : `${KC_P}${i.a}/#${i.s}`;
const kcCnt = i => [...i.e, ...i.g, ...i.z].filter(x => !x.tip).length;
// Hinweisbox auf passenden Seiten (Ratgeber, Arten, Märkte)
const kcCta = (area, txt) => KC_ON && KC.some(i => i.a === area) ? `<a class="cta-box" href="${KC_P}${area}/">${ic("search")}<span><b>Kauf-Check: ${esc(KC_AREAS[area].t)}</b>${esc(txt || `Echt oder Fälschung, in Ordnung oder nicht? ${KC.filter(i => i.a === area).length} Artikel mit Prüfpunkten zum Abhaken am Stand.`)}</span>${ic("chev")}</a>` : "";
const KC_ART = { "faelschungen-erkennen-flohmarkt": "", "vintage-kleidung-flohmarkt": "mode", "schallplatten-flohmarkt": "medien", "antiquitaeten-erkennen-flohmarkt": "kueche", "elektrogeraete-flohmarkt": "elektronik", "flohmarkt-mit-kindern": "kinder", "gekauft-wie-gesehen": "", "haendler-erkennen-flohmarkt": "" };
const kcHubCta = () => KC_ON ? `<a class="cta-box" href="${KC_P}">${ic("search")}<span><b>Kauf-Check für ${KC.length} Artikel</b>Von Levi's bis LEGO, von iPhone bis Meissen: Prüfpunkte zum Abhaken direkt am Stand.</span>${ic("chev")}</a>` : "";
// Werkzeuge auf Marktseiten: Schilder im Kasten „Selbst verkaufen“, Kauf-Check passend zur Art des Markts (sonst allgemein)
const signBox = () => `<a class="cta-box" href="/flohmarkt-schilder/">${ic("printer")}<span><b>Gratis: Schilder für deinen Stand</b>Preisschilder, „Alles 1 €“ und Bar &amp; PayPal mit QR-Code, direkt drucken.</span>${ic("chev")}</a>`;
const kcForMarket = m => { if (!KC_ON) return ""; const a = Object.keys(KC_AREAS).find(x => KC_AREAS[x].cat && KC.some(i => i.a === x) && CATS.some(c => c.s === KC_AREAS[x].cat && c.ms.includes(m))); return a ? kcCta(a) : kcHubCta(); };
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
// Die letzten beiden Einträge sind nur Schriften für den Schilder-Designer: Sie werden nicht vorgeladen, der Browser holt sie erst, wenn jemand sie auswählt.
// Fraunces liegt bei. Pacifico (verspielt) ist freiwillig: Datei von fonts.google.com in den Ordner fonts legen, dann erscheint die Schrift im Designer.
const FONT_RULES = [[/bricolage.*\.(woff2|ttf)$/i, "Bricolage Grotesque", "200 800"], [/figtree.*variable.*\.(woff2|ttf)$|^figtree\.(woff2|ttf)$/i, "Figtree", "300 900"], [/fraunces.*\.(woff2|ttf)$/i, "Fraunces", "600", true], [/pacifico.*\.(woff2|ttf)$/i, "Pacifico", "400", true]];
const fontDir = path.join(ROOT, "fonts");
const fontFilesAll = fs.existsSync(fontDir) ? fs.readdirSync(fontDir) : [];
// Kursive Varianten nie nehmen; bei mehreren Treffern woff2 und variable Schriften bevorzugen
const fontScore = x => (x.endsWith("woff2") ? 2 : 0) + (/variable/i.test(x) ? 1 : 0);
const fontsFound = FONT_RULES.map(([re, fam, w, sign]) => { const f = fontFilesAll.filter(x => re.test(x) && !/italic/i.test(x)).sort((a, b) => fontScore(b) - fontScore(a) || a.localeCompare(b))[0]; return f && { f, fam, w, sign: !!sign }; }).filter(Boolean);
const FONT_PRELOAD = fontsFound.filter(x => x.f.endsWith("woff2") && !x.sign).map(x => `<link rel="preload" href="/fonts/${encodeURIComponent(x.f)}" as="font" type="font/woff2" crossorigin>`).join("");
const fontCSS = fontsFound.map(x => `@font-face{font-family:"${x.fam}";src:url("/fonts/${encodeURIComponent(x.f)}") format("${x.f.endsWith("woff2") ? "woff2" : "truetype"}");font-weight:${x.w};font-style:normal;font-display:swap}`).join("\n");
// Stil der Website: der Schriften-Teil (hängt von den Dateien im Ordner fonts ab) plus src/style.css. Das Versionskürzel entsteht aus beidem.
const CSS_SRC = fontCSS + "\n" + fs.readFileSync(path.join(ROOT, "src/style.css"), "utf8");
// Der Stil steht direkt in jeder Seite: So muss der Browser vor dem ersten Bild keine zweite Datei laden.
const CSS_INLINE = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "").replace(/<\/style/gi, "");
const CSS_V = "?v=" + hashOf("sha1").update(CSS_SRC).digest("hex").slice(0, 8);
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
const credOf = f => (CREDITS.bilder || {})[f] || (CREDITS.bilder || {})[String(f).replace(/(-klein|-mini)?\.(webp|jpg)$/, "")] || null;
const credLink = () => `<a href="${esc(CRED_SRC.url)}" rel="noopener nofollow">${esc(CRED_SRC.text)}</a>`;
// Dateiname auf der Website: sprechender Name aus nachweis.json (gut für die Google-Bildersuche), sonst der Dateiname aus dem Ordner.
const imgOut = f => { const c = credOf(f), m = /^(.*?)(-klein|-mini)?\.(webp|jpg)$/.exec(f); return c && /^[a-z0-9-]+$/.test(c.name || "") ? `${c.name}${m[2] || ""}.${m[3]}` : f; };
const imgUrl = f => `/assets/img/${imgOut(f)}`;
const IMG_BY_URL = Object.fromEntries([...IMGS].map(f => [imgUrl(f), f]));
const OG = pickImg("teilen", "jpg");
const OG_IMG = OG ? imgUrl(OG.f) : "";
const REAL_PHOTOS = [...IMGS].filter(x => !/-ki\.(webp|jpg)$/.test(x) && !/-(klein|mini)\./.test(x) && !(CRED_SRC && credOf(x)));
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
  check: "<path d=\"M228.24,76.24l-128,128a6,6,0,0,1-8.48,0l-56-56a6,6,0,0,1,8.48-8.48L96,191.51,219.76,67.76a6,6,0,0,1,8.48,8.48Z\"/>",
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
  download: "<path d=\"M222,144v64a14,14,0,0,1-14,14H48a14,14,0,0,1-14-14V144a6,6,0,0,1,12,0v64a2,2,0,0,0,2,2H208a2,2,0,0,0,2-2V144a6,6,0,0,1,12,0Zm-98.24,4.24a6,6,0,0,0,8.48,0l40-40a6,6,0,0,0-8.48-8.48L134,129.51V40a6,6,0,0,0-12,0v89.51L92.24,99.76a6,6,0,0,0-8.48,8.48Z\"/>",
  printer: "<path d=\"M214.67,74H198V40a6,6,0,0,0-6-6H64a6,6,0,0,0-6,6V74H41.33C28.47,74,18,83.87,18,96v80a6,6,0,0,0,6,6H58v34a6,6,0,0,0,6,6H192a6,6,0,0,0,6-6V182h34a6,6,0,0,0,6-6V96C238,83.87,227.53,74,214.67,74ZM70,46H186V74H70ZM186,210H70V158H186Zm40-40H198V152a6,6,0,0,0-6-6H64a6,6,0,0,0-6,6v18H30V96c0-5.51,5.08-10,11.33-10H214.67C220.92,86,226,90.49,226,96Zm-28-54a10,10,0,1,1-10-10A10,10,0,0,1,198,116Z\"/>",
  scissors: "<path d=\"M159.38,112a6,6,0,0,1,1.57-8.34l67.66-46.31a6,6,0,0,1,6.78,9.91l-67.67,46.3a6,6,0,0,1-8.34-1.56ZM237,197.09a6,6,0,0,1-8.34,1.56L136,135.27,91,166.06A34,34,0,1,1,84,156a1.8,1.8,0,0,0,.19.2L125.37,128,84.23,99.84,84,100a34,34,0,1,1,7-10.1l144.38,98.8A6,6,0,0,1,237,197.09ZM75.56,91.55a22,22,0,1,0-31.12,0,21.88,21.88,0,0,0,31.12,0ZM82,180a22,22,0,1,0-6.44,15.56h0A21.88,21.88,0,0,0,82,180Z\"/>",
  rain: "<path d=\"M157,195.33l-32,48a6,6,0,1,1-10-6.66l32-48a6,6,0,0,1,10,6.66ZM230,92a74.09,74.09,0,0,1-74,74H131.21L101,211.33a6,6,0,1,1-10-6.66L116.79,166H76A50,50,0,1,1,86.2,67,74.08,74.08,0,0,1,230,92Zm-12,0A62.06,62.06,0,0,0,94,88.35a6,6,0,0,1-12-.7,75.84,75.84,0,0,1,1.07-9A38,38,0,1,0,76,154h80A62.07,62.07,0,0,0,218,92Z\"/>",
  cloudsun: "<path d=\"M164,74a74.15,74.15,0,0,0-21.18,3.09,54.08,54.08,0,0,0-11.14-13.61l10.52-15a6,6,0,1,0-9.83-6.89l-10.52,15A53.9,53.9,0,0,0,96,50c-1.15,0-2.28,0-3.41.12L89.4,32.05a6,6,0,1,0-11.81,2.09L80.77,52.2A54,54,0,0,0,55.52,68.32L40.47,57.78a6,6,0,0,0-6.89,9.83l15,10.52A53.7,53.7,0,0,0,42,104c0,1.13,0,2.26.12,3.39l-18.07,3.18a6,6,0,0,0,1,11.91,6.38,6.38,0,0,0,1.05-.09L44.2,119.2a53.51,53.51,0,0,0,7.08,15A50,50,0,0,0,84,222h80a74,74,0,0,0,0-148ZM54,104a42,42,0,0,1,77.48-22.49A74.29,74.29,0,0,0,94.2,123,50.36,50.36,0,0,0,84,122a49.65,49.65,0,0,0-22.79,5.52A42,42,0,0,1,54,104ZM164,210H84a38,38,0,1,1,7.08-75.34,75.84,75.84,0,0,0-1.07,9,6,6,0,0,0,12,.7,61.54,61.54,0,0,1,2-12.24c0-.15.08-.29.11-.43A62.06,62.06,0,1,1,164,210Z\"/>",
  cloud: "<path d=\"M160,42A86.11,86.11,0,0,0,82.43,90.88,62,62,0,1,0,72,214h88a86,86,0,0,0,0-172Zm0,160H72a50,50,0,0,1,0-100,50.67,50.67,0,0,1,5.91.35A85.61,85.61,0,0,0,74,128a6,6,0,0,0,12,0,74,74,0,1,1,74,74Z\"/>",
  share: "<path d=\"M176,162a37.91,37.91,0,0,0-28.3,12.67L98.8,143.24a37.89,37.89,0,0,0,0-30.48l48.9-31.43a38,38,0,1,0-6.5-10.09L92.3,102.67a38,38,0,1,0,0,50.66l48.9,31.43A38,38,0,1,0,176,162Zm0-132a26,26,0,1,1-26,26A26,26,0,0,1,176,30ZM64,154a26,26,0,1,1,26-26A26,26,0,0,1,64,154Zm112,72a26,26,0,1,1,26-26A26,26,0,0,1,176,226Z\"/>",
  sunrise: "<path d=\"M240,154H197.28a70.91,70.91,0,0,0,.72-10,70,70,0,0,0-140,0,70.91,70.91,0,0,0,.72,10H16a6,6,0,0,0,0,12H240a6,6,0,0,0,0-12ZM70,144a58,58,0,1,1,115.13,10H70.87A58.63,58.63,0,0,1,70,144Zm144,56a6,6,0,0,1-6,6H48a6,6,0,0,1,0-12H208A6,6,0,0,1,214,200ZM74.63,42.69a6,6,0,0,1,10.74-5.37l8,16a6,6,0,0,1-10.74,5.36Zm-56,50.63a6,6,0,0,1,8.05-2.69l16,8a6,6,0,0,1-5.36,10.74l-16-8A6,6,0,0,1,18.63,93.32Zm192,13.36a6,6,0,0,1,2.69-8.05l16-8a6,6,0,1,1,5.36,10.74l-16,8a6,6,0,0,1-8.05-2.69Zm-48-53.36,8-16a6,6,0,0,1,10.74,5.37l-8,16a6,6,0,1,1-10.74-5.36Z\"/>",
  bed: "<path d=\"M216,74H30V48a6,6,0,0,0-12,0V208a6,6,0,0,0,12,0V174H242v34a6,6,0,0,0,12,0V112A38,38,0,0,0,216,74ZM30,86h76v76H30Zm88,76V86h98a26,26,0,0,1,26,26v50Z\"/>",
  heart: "<path d=\"M178,42c-21,0-39.26,9.47-50,25.34C117.26,51.47,99,42,78,42a60.07,60.07,0,0,0-60,60c0,29.2,18.2,59.59,54.1,90.31a334.68,334.68,0,0,0,53.06,37,6,6,0,0,0,5.68,0,334.68,334.68,0,0,0,53.06-37C219.8,161.59,238,131.2,238,102A60.07,60.07,0,0,0,178,42ZM128,217.11C111.59,207.64,30,157.72,30,102A48.05,48.05,0,0,1,78,54c20.28,0,37.31,10.83,44.45,28.27a6,6,0,0,0,11.1,0C140.69,64.83,157.72,54,178,54a48.05,48.05,0,0,1,48,48C226,157.72,144.41,207.64,128,217.11Z\"/>",
  heartfill: "<path d=\"M240,102c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,228.66,16,172,16,102A62.07,62.07,0,0,1,78,40c20.65,0,38.73,8.88,50,23.89C139.27,48.88,157.35,40,178,40A62.07,62.07,0,0,1,240,102Z\"/>",
  x: "<path d=\"M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z\"/>",
  undo: "<path d=\"M222,128a94,94,0,0,1-92.29,94H128a93.43,93.43,0,0,1-64.5-25.65,6,6,0,1,1,8.24-8.73A82,82,0,1,0,70,70.25L54.15,86H80a6,6,0,0,1,0,12H40a6,6,0,0,1-6-6V52a6,6,0,0,1,12,0V77.57L61.62,62A94,94,0,0,1,222,128Z\"/>",
  thumbsup: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"14\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M32,112H76v96H32Z\"/><path d=\"M76,112,114,34c19,0,34,13,34,34V90h58c14,0,24,11,22,25l-11,76c-2,10-10,17-20,17H76\"/></g>",
  thumbsdown: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"14\" stroke-linecap=\"round\" stroke-linejoin=\"round\" transform=\"matrix(1 0 0 -1 0 256)\"><path d=\"M32,112H76v96H32Z\"/><path d=\"M76,112,114,34c19,0,34,13,34,34V90h58c14,0,24,11,22,25l-11,76c-2,10-10,17-20,17H76\"/></g>",
  pause: "<path d=\"M92,44h20a8,8,0,0,1,8,8V204a8,8,0,0,1-8,8H92a8,8,0,0,1-8-8V52A8,8,0,0,1,92,44Zm52,0h20a8,8,0,0,1,8,8V204a8,8,0,0,1-8,8H144a8,8,0,0,1-8-8V52A8,8,0,0,1,144,44Z\"/>",
  play: "<path d=\"M92,46.4V209.6a8,8,0,0,0,12.2,6.8l130.6-81.6a8,8,0,0,0,0-13.6L104.2,39.6A8,8,0,0,0,92,46.4Z\"/>",
  car: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"13\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M36,124,62,72a16,16,0,0,1,14-8H180a16,16,0,0,1,14,8l26,52\"/><rect x=\"28\" y=\"124\" width=\"200\" height=\"56\" rx=\"12\"/><path d=\"M52,180v20M204,180v20\"/><path d=\"M68,152h16M172,152h16\"/></g>",
  cup: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"13\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M44,96H188v48a64,64,0,0,1-64,64H108a64,64,0,0,1-64-64Z\"/><path d=\"M188,108h8a28,28,0,0,1,0,56h-12\"/><path d=\"M84,36c-8,10,8,18,0,28M116,36c-8,10,8,18,0,28M148,36c-8,10,8,18,0,28\"/></g>",
  globe: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"13\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"128\" cy=\"128\" r=\"96\"/><path d=\"M32,128H224\"/><path d=\"M128,32c-26,26-40,60-40,96s14,70,40,96c26-26,40-60,40-96S154,58,128,32Z\"/></g>",
  camera: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"13\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M208,208H48a16,16,0,0,1-16-16V80A16,16,0,0,1,48,64H80L96,40h64l16,24h32a16,16,0,0,1,16,16V192A16,16,0,0,1,208,208Z\"/><circle cx=\"128\" cy=\"134\" r=\"36\"/></g>",
  search: "<path d=\"M228.24,219.76l-51.38-51.38a86.15,86.15,0,1,0-8.48,8.48l51.38,51.38a6,6,0,0,0,8.48-8.48ZM38,112a74,74,0,1,1,74,74A74.09,74.09,0,0,1,38,112Z\"/>",
  frog: "<path d=\"M368 32c41.7 0 75.9 31.8 79.7 72.5l85.6 26.3c25.4 7.8 42.8 31.3 42.8 57.9 0 21.8-11.7 41.9-30.7 52.7l-144.5 82.1 92.5 92.5h50.7c17.7 0 32 14.3 32 32s-14.3 32-32 32h-64c-8.5 0-16.6-3.4-22.6-9.4L346.9 360.2c11.7-36 3.2-77.1-25.4-105.7-40.6-40.6-106.3-40.6-146.9-.1l-73.6 70c-6.4 6.1-6.7 16.2-.6 22.6s16.2 6.6 22.6.6l73.8-70.2.1-.1.1-.1c3.5-3.5 7.3-6.6 11.3-9.2 27.9-18.5 65.9-15.4 90.5 9.2 24.7 24.7 27.7 62.9 9 90.9-2.6 3.8-5.6 7.5-9 10.9l-37 37H352c17.7 0 32 14.3 32 32s-14.3 32-32 32H64c-35.3 0-64-28.7-64-64C0 249.6 127 112.9 289.3 97.5 296.2 60.2 328.8 32 368 32m0 104a24 24 0 1 0 0-48 24 24 0 1 0 0 48\"/>",
};
const ICON_LICENSE = "Frosch-Icon (Wetterfrosch) und Symbole im Schilder-Designer: Font Awesome Free 7.1.0 by @fontawesome, https://fontawesome.com\nLizenz: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ , Copyright 2025 Fonticons, Inc. Unverändert übernommen.\n\nAlle anderen Icons: Phosphor Icons (https://phosphoricons.com), Stil Light\n\nMIT License\n\nCopyright (c) 2023 Phosphor Icons\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n";
const ICON_VB = { frog: "0 0 576 512" };
const SPRITE_FILE = `<!-- Icons: Phosphor Icons, MIT License, (c) 2023 Phosphor Icons; Frosch: Font Awesome Free, CC BY 4.0, (c) Fonticons, Inc.; siehe /assets/icons-lizenz.txt --><svg xmlns="http://www.w3.org/2000/svg"><defs>${Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="${ICON_VB[k] || "0 0 256 256"}" fill="currentColor">${v}</symbol>`).join("")}</defs></svg>`;
// Die Icon-Sammlung bekommt wie Stil und Skript ein Versionskürzel: Kommt ein Icon dazu, laden Browser sofort die neue Datei.
const ICONS_V = "?v=" + hashOf("sha1").update(SPRITE_FILE).digest("hex").slice(0, 8);
const ic = (n, cls = "i") => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="/assets/icons.svg${ICONS_V}#i-${ICONS[n] ? n : "tag"}"/></svg>`;
// Icons für die Marktarten aus der Tabelle; unbekannte Arten bekommen das Etikett-Icon
const TAG_ICON = { "Frühaufsteher": "sunrise", "Langschläfer": "bed", "Groß & bekannt": "star", "Abends": "moon", "Nachbarschaft": "home", "Sammler & Vinyl": "disc", "Kinder & Spielzeug": "smile", "Überdacht": "umbrella", "Umland": "tree", "Fahrräder": "bike" };
const tagIc = t => ic(TAG_ICON[t] || "tag");
// Logischer Umbruch nach dem Doppelpunkt („Handeln auf dem Flohmarkt:“ / „So feilschst du fair“)
// Lange Wörter in Überschriften: weiches Trennzeichen an der Wortfuge („Nachbarschafts-flohmarkt“), damit das Handy nicht mitten im Wort umbricht.
const SHY_RX = /(?<=\p{L}{4})(?<!floh)(?=(?:flohm[aä]rkt|m[aä]rkt|börse|basar|schild|gebühr|platten|kleider|feld|nachbar|rekorder|automat|erklärung|streit|beilegung|schutz))/giu;
const shyHeads = html => html.replace(/<(h[1-4])\b([^>]*)>([\s\S]*?)<\/\1>/g, (m, t, a, inner) => `<${t}${a}>${inner.replace(/(^|>)([^<]+)/g, (x, pre, txt) => pre + txt.replace(SHY_RX, "&shy;"))}</${t}>`);
const brColon = h => h.replace(/^(.{3,70}?): (.+)$/, '$1:<span class="br"> $2</span>');
// Adresse: Hausnummer bleibt bei der Straße, PLZ beim Ort. Umbrochen wird nach dem Komma.
const addrNb = a => esc(a).replace(/ (\d+\s?[a-zA-Z]?(?:[-–]\d+[a-zA-Z]?)?)(?=,|$)/g, "&nbsp;$1").replace(/(\d{5}) /g, "$1&nbsp;");
const more = (href, label, aria) => `<a class="more-link" href="${href}"${aria ? ` aria-label="${esc(aria)}"` : ""}>${label}${ic("chev")}</a>`;
// Suchfeld: Startseite (schickt zur Seite „Suchen“) und Seite „Suchen“ selbst (sucht beim Tippen)
const sxForm = (home = false) => `<form class="sx-form${home ? " sx-home" : ""}" action="/suche/" method="get" role="search"${home ? "" : ' id="sxForm"'}><label class="sx-field">${ic("search")}<span class="vh">Markt, Stadtteil oder Datum</span><input${home ? "" : ' id="sxQ"'} type="search" placeholder="Markt, Stadtteil oder Datum" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" maxlength="80"></label>${home ? `<button class="sx-go" type="submit" aria-label="Suchen">${ic("chev")}</button>` : `<button type="button" class="sx-clear js-only" id="sxClear" aria-label="Eingabe löschen" hidden>${ic("x")}</button>`}</form>`;
const TAGS_ALL = [...new Set(MARKETS.flatMap(m => m.tags))];
// Zwei Filter entstehen automatisch aus der Uhrzeit: Beginn bis 7 Uhr = Frühaufsteher, Beginn von 10 bis 15 Uhr = Langschläfer
const timeTags = e => { if (e.cancelled || !e.start) return []; const h = parseInt(String(e.start).match(/\d{1,2}/)[0], 10); return h <= 7 ? ["Frühaufsteher"] : h >= 10 && h <= 15 ? ["Langschläfer"] : []; };
const TIME_TAGS = ["Frühaufsteher", "Langschläfer"];
// Zwei Seiten, die auch unter der Woche gesucht werden: Märkte von Montag bis Freitag und Standgebühren im Vergleich
const TIPS_P = "/flohmarkt-tipps/", WEEK_P = "/flohmarkt-hamburg-unter-der-woche/", FEE_P = "/flohmarkt-standgebuehr-hamburg/", ABOUT_P = "/ueber-flohlotse/";
// Wer hinter den Artikeln steht: Google empfiehlt bei Artikeln einen Link auf eine Seite, die den Autor beschreibt (hier: Über Flohlotse).
const ORG_AUTHOR = { "@type": "Organization", name: NAME, url: SITE + ABOUT_P }, ORG_PUB = { "@type": "Organization", name: NAME, url: SITE + "/" };
// Zahl und Einheit bleiben in einer Zeile („4 m“, „12 €“, „7 Uhr“)
const nbU = t => esc(t).replace(/(\d) (?=€|%|(?:m|Uhr|km)\b)/g, "$1&nbsp;");
function menuHTML() {
  // Menü in vier Fragen: Wann? Was für ein Markt? Wo? Und die Werkzeuge. Seltenes steht klein darunter, Bezirke zum Aufklappen.
  // Kurze Namen im Menü, damit zwei Knöpfe nebeneinander passen (auch bei großer Schrift am Handy)
  const MN_SHORT = { "hallenflohmarkt-hamburg": "Überdacht", "nachtflohmarkt-hamburg": "Nachts", "kinderflohmarkt-hamburg": "Für Kinder", "fahrradflohmarkt-hamburg": "Fahrräder", "nachbarschaftsflohmarkt-hamburg": "Nachbarschaft", "frauenflohmarkt-hamburg": "Für Frauen", "flohmarkt-hamburg-umgebung": "Umland" };
  const cnt = k => MARKETS.filter(m => m.bez === k).length;
  const a = (h, l, c = "") => `<a href="${h}"${c ? ` class="${c}"` : ""}>${l}</a>`;
  const reg = um => REGIONS.filter(r => !!r.umland === um).map(r => a(`/flohmarkt-hamburg/${r.k}/`, `${esc(r.name)} <small>${cnt(r.k)}</small>`)).join("");
  const SUB = { sign: "Preisschilder gratis drucken", kc: "Echt oder Fälschung?", kb: `${KB.length} kurze Antworten` };
  const tool = ([k, h, i, t]) => `<a class="mn-tool" href="${h}">${ic(i)}<span><b>${t}</b><small>${SUB[k]}</small></span>${ic("chev")}</a>`;
  return `<details class="menu-wrap"><summary class="menu-btn">${ic("list", "i i-open")}${ic("x", "i i-shut")}<span>Menü</span></summary>
<div class="menu"><nav class="mn" aria-label="Alle Bereiche">
<div class="mn-when"><p class="mn-h">Wann?</p><div class="mn-days">${a("/heute/", "Heute")}${a("/morgen/", "Morgen")}${a("/wochenende/", "Wochenende")}</div>
<div class="mn-rows">${a("/termine/", `${ic("cal")}Alle Termine`)}${a(WEEK_P, `${ic("clock")}Unter der Woche`)}${a("/flohmaerkte/", `${ic("list")}Alle Märkte A–Z`)}${a("/entdecken/", `${ic("heart")}Wischen &amp; merken`)}</div></div>
<div class="mn-what"><p class="mn-h">Was für ein Markt?</p><div class="mn-chips">${CATS_ON.map(c => a(`/${c.s}/`, `${ic(c.icon)}${esc(MN_SHORT[c.s] || c.chip)}`)).join("")}</div></div>
<div class="mn-where"><p class="mn-h">Wo?</p><details class="mn-reg"><summary>Hamburg nach Bezirk</summary><div>${reg(false)}</div></details><details class="mn-reg"><summary>Umland bis 30 km</summary><div>${reg(true)}</div></details></div>
<div class="mn-tools"><p class="mn-h">Für deinen Flohmarkt</p>${TOOLS().map(tool).join("")}</div>
<div class="mn-more">${a(FEE_P, "Standgebühren")}${a(TIPS_P, "Tipps &amp; Vorlagen")}${a("/veranstalter/", "Für Veranstalter")}${a(ABOUT_P, "Über Flohlotse")}${INSTA ? instaA("Instagram") : ""}${a("/impressum/", "Impressum")}${a("/datenschutz/", "Datenschutz")}</div>
</nav></div></details>`;
}
const MENU = () => menuHTML();
// Fotos einer Seite: Angaben für Google (Urheber, Lizenz) und Einträge für die Bild-Sitemap. Die große Fassung zählt.
const PAGE_PHOTOS = new Map();
function imgLD(p, body) {
  const fs_ = [...new Set([...body.matchAll(/(?:src|srcset)="([^"]*\/assets\/img\/[^"]+)"/g)].flatMap(m => m[1].split(",").map(x => x.trim().split(" ")[0])))]
    .map(u => IMG_BY_URL[u]).filter(f => f && CRED_SRC && credOf(f) && !/-(klein|mini)\./.test(f));
  if (!fs_.length) return "";
  PAGE_PHOTOS.set(p, fs_.map(f => imgUrl(f)));
  const ldImg = fs_.map(f => { const c = credOf(f); return { "@context": "https://schema.org", "@type": "ImageObject", contentUrl: SITE + imgUrl(f), caption: String(c.alt || "").replace(/^Symbolfoto: /, ""), creditText: `${c.autor || CRED_SRC.name} / ${CRED_SRC.name}`, creator: { "@type": "Organization", name: c.autor || CRED_SRC.name }, copyrightNotice: `${c.autor || CRED_SRC.name} / ${CRED_SRC.name}`, ...(CRED_SRC.lizenz ? { license: CRED_SRC.lizenz, acquireLicensePage: CRED_SRC.url } : {}) }; });
  return `<script type="application/ld+json">${JSON.stringify(ldImg).replace(/</g, "\\u003c")}</script>`;
}
const REL_PAGES = new Set(["/", "/heute/", "/morgen/", "/wochenende/", "/samstag/", "/sonntag/"]);
// Werkzeug-Seiten (Schilder, Kauf-Check, Ratgeber): am Ende die beiden anderen Werkzeuge. Auf allen Seiten: schwebender Plus-Knopf zu den Werkzeugen
const TOOLS = () => [["sign", "/flohmarkt-schilder/", "printer", "Schilder-Designer", "Preisschilder, „Alles 1 €“ und Bar & PayPal mit QR-Code gratis drucken."],
  ...(KC_ON ? [["kc", KC_P, "search", "Kauf-Check", `Echt oder Fälschung? Prüfpunkte für ${KC.length} Artikel, direkt am Stand.`]] : []),
  ["kb", "/ratgeber/", "book", "Ratgeber", `${KB.length} Artikel mit kurzen Antworten zu Handeln, Preisen und Wechselgeld.`]];
const toolOf = p => p.startsWith("/flohmarkt-schilder/") ? "sign" : KC_ON && p.startsWith(KC_P) ? "kc" : p.startsWith("/ratgeber/") ? "kb" : "";
// Am Ende jeder Werkzeug-Seite ein leiser Hinweis auf den Kalender: Wer aus Hamburg kommt, findet so zu den Terminen.
const HH_HINT = `<p class="mt-hh">${ic("pin")}<span><b>Aus Hamburg?</b> Hier findest du <a href="/termine/">alle Flohmarkt-Termine für Hamburg und Umgebung</a>.</span></p>`;
const moreTools = cur => `<section class="sec more-tools"><div class="sec-head"><h2>Mehr für deinen Flohmarkt</h2></div><div class="mt-grid">${TOOLS().filter(x => x[0] !== cur).map(([, h, i, b, x]) => `<a class="cta-box" href="${h}">${ic(i)}<span><b>${b}</b>${esc(x)}</span>${ic("chev")}</a>`).join("")}</div>${HH_HINT}</section>`;
const fabHTML = cur => `<div class="fab" id="fab" hidden><div class="fab-dim" id="fabDim" hidden></div><nav class="fab-menu" id="fabMenu" aria-label="Schnellzugriff" hidden>${[["tm", "/termine/", "cal", "Termine"], ...TOOLS(), ["dk", "/entdecken/", "heart", "Wischen &amp; merken"]].map(([k, h, i, b]) => `<a href="${h}"${k === cur ? ' class="cur" aria-current="true"' : ""}>${ic(i)}${b}</a>`).join("")}</nav><button type="button" class="fab-btn" id="fabBtn" aria-expanded="false" aria-controls="fabMenu" aria-label="Schnellzugriff: Termine, Schilder, Kauf-Check, Ratgeber, Wischen und merken"><span class="fab-plus" aria-hidden="true"></span><span class="fab-lab" aria-hidden="true">Schilder · Kauf-Check · Ratgeber</span></button></div>`;
// art: Wortlaut eines Artikels (Überschrift, Text, Fragen). Ändert er sich, ändert sich das Datum „Stand“ im Artikel und in den Angaben für Google (dateModified).
function layout({ p, title, desc, body, ld, noindex, nav, extraHead = "", img = OG_IMG, art }) {
  const toolK = toolOf(p); if (toolK && p !== "/ratgeber/") body += moreTools(toolK); // Die Ratgeber-Übersicht zeigt die Werkzeuge schon oben
  else if (p === "/ratgeber/") body += `<section class="sec more-tools">${HH_HINT}</section>`;
  const url = SITE + p;
  // Google zeigt rund 60 Zeichen. Ist der Titel länger, fällt der angehängte Markenname weg (Google ergänzt den Seitennamen selbst).
  if (title.length > 60 && title.endsWith(` | ${NAME}`)) title = title.slice(0, -(` | ${NAME}`).length);
  // Am Computer (ab 1080 px) sind Übersichtsseiten breit („wide“). Lese- und Detailseiten behalten eine bequeme Lesebreite („read“).
  const readPg = /^\/(flohmarkt|ratgeber)\/[^/]+\/$/.test(p) || (p.startsWith(KC_P) && p !== KC_P) || ["/veranstalter/", "/impressum/", ABOUT_P, "/datenschutz/", "/404.html", "/flohmarkt-hamburg-statistik/"].includes(p);
  const mainCls = `wrap ${readPg ? "read" : "wide"}${p === "/" ? " pg-home" : p === TIPS_P ? " pg-start" : ""}`;
  // Hauptmenü in zwei Bereichen: der Kalender für Hamburg und die Werkzeuge, die auf jedem Flohmarkt helfen. Adressen bleiben, wie sie sind.
  const navK = toolK === "kc" ? "kc" : nav;
  const navA = ([h, l, k]) => `<a href="${h}"${k === navK ? ' aria-current="page"' : ""}>${l}</a>`;
  const navG = (lab, short, items) => `<div class="nav-g" role="group" aria-label="${lab}"><span class="nav-l" aria-hidden="true">${short}</span>${items.map(navA).join("")}</div>`;
  const navHTML = navG("Flohmärkte in Hamburg", "Hamburg", [["/termine/", "Termine", "termine"], ["/flohmaerkte/", "Märkte", "maerkte"]])
    + navG("Für jeden Flohmarkt", "Für jeden Flohmarkt", [["/flohmarkt-schilder/", "Schilder", "schilder"], ...(KC_ON ? [[KC_P, "Kauf-Check", "kc"]] : []), ["/ratgeber/", "Ratgeber", "ratgeber"]])
    + navA(["/veranstalter/", "Für Veranstalter", "org"]);
  // data-stand: Tag des Baus. Ist die Seite beim Aufruf älter (kurz nach Mitternacht oder nach einem ausgefallenen Neubau),
  // blendet das Skript vergangene Tage aus und zeigt einen Hinweis. data-rel: Seiten, die von „heute“ und „morgen“ sprechen.
  const html = `<!doctype html>
<html lang="de" data-stand="${key(TODAY)}"${REL_PAGES.has(p) ? " data-rel" : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${noindex || !PUBLIC ? "noindex,follow" : "index,follow"}">
<link rel="canonical" href="${esc(url)}">
${FONT_PRELOAD}
<meta property="og:type" content="website"><meta property="og:locale" content="de_DE"><meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">${img ? `\n<meta property="og:image" content="${esc(SITE + img)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<style>${CSS_INLINE}</style>
${HAS_ICONS ? `<link rel="icon" href="/favicon.ico" sizes="32x32">\n` : ""}<link rel="icon" href="/assets/icon.svg${ICON_V}" type="image/svg+xml">${HAS_ICONS ? `\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/manifest.webmanifest">` : ""}
<meta name="theme-color" content="#F2F4F0" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0F1411" media="(prefers-color-scheme: dark)">
<noscript><style>.js-only{display:none!important}</style></noscript>
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}${imgLD(p, body)}${extraHead}
</head>
<body>
<a class="skip" href="#inhalt">Zum Inhalt springen</a>
<header class="top"><div class="wrap">
<a class="brand" href="/"><i>€</i>${esc(NAME)}</a>
<nav class="nav" aria-label="Hauptmenü">${navHTML}</nav>
<a class="srch-top" href="/suche/" aria-label="Flohmarkt suchen"${nav === "suche" ? ' aria-current="page"' : ""}>${ic("search")}</a>
${msLink("mail-top", ic("mail"), "Termin melden")}
<a class="fav-top" href="/merkliste/" aria-label="Merkliste"${nav === "merk" ? ' aria-current="page"' : ""}>${ic("heart")}<span class="fav-n" hidden></span></a>
${MENU()}
</div></header>
<main class="${mainCls}" id="inhalt">
${shyHeads(body.replace(/<h1>([^<]{3,80}?): ([^<]+)<\/h1>/, '<h1>$1:<span class="h1-sub"> $2</span></h1>'))}
</main>
<footer class="wrap site-foot">
<div>Termine nach öffentlichen Angaben der Veranstalter. Bitte vor dem Besuch beim Veranstalter prüfen, Märkte können kurzfristig ausfallen. Ratgeber-Artikel ersetzen keine Rechts- oder Steuerberatung.${WX_OK ? ` Wettervorhersage: Deutscher Wetterdienst, Stand ${STAND}.` : ""}</div>
<details class="foot-grp"><summary>Flohmarkt Hamburg</summary><nav class="foot-links" aria-label="Flohmarkt Hamburg"><a href="/heute/">Heute</a><a href="/morgen/">Morgen</a><a href="/wochenende/">Wochenende</a><a href="/samstag/">Samstag</a><a href="/sonntag/">Sonntag</a><a href="${WEEK_P}">Unter der Woche</a>${REGIONS.map(r => `<a href="/flohmarkt-hamburg/${r.k}/">${esc(r.name)}</a>`).join("")}<a href="${FEE_P}">Standgebühren im Vergleich</a><a href="/flohmarkt-hamburg-statistik/">Flohmärkte in Zahlen</a></nav></details>
<details class="foot-grp"><summary>Nach Art und Monat</summary><nav class="foot-links" aria-label="Nach Art und Monat">${CATS_ON.map(c => `<a href="/${c.s}/">${esc(c.chip)}</a>`).join("")}${MONTHS.map(x => `<a href="/${x.s}/">${x.name} ${x.y}</a>`).join("")}</nav></details>
<details class="foot-grp"><summary>Für jeden Flohmarkt</summary><nav class="foot-links" aria-label="Für jeden Flohmarkt"><a href="${TIPS_P}">Tipps &amp; Vorlagen</a><a href="/ratgeber/">Ratgeber</a>${KC_ON ? `<a href="${KC_P}">Kauf-Check</a>` : ""}<a href="/flohmarkt-schilder/">Schilder-Designer</a></nav></details>
<details class="foot-grp"><summary>${esc(NAME)}</summary><nav class="foot-links" aria-label="${esc(NAME)}"><a href="${ABOUT_P}">Über Flohlotse</a><a href="/veranstalter/">Für Veranstalter</a>${INSTA ? instaA("Instagram") : ""}<a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a></nav></details>
<p class="foot-stand">Stand der Termine: ${STAND}</p>
</footer>
${msSheet(mkOfPath(p))}${fabHTML(toolK || (p === "/entdecken/" ? "dk" : p === "/termine/" ? "tm" : ""))}
<script src="/assets/site${JS_V ? "." + JS_V.slice(3) : ""}.js" defer></script>
</body>
</html>`;
  pages.set(p, { html, noindex, title, desc, art });
}
const crumbs = items => `<nav class="crumbs" aria-label="Brotkrümel">${items.map((it, i) => (i ? "<span>›</span>" : "") + (it[1] ? `<a href="${it[1]}">${esc(it[0])}</a>` : `<span>${esc(it[0])}</span>`)).join("")}</nav>`;
const crumbLD = items => ({ "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it[0], ...(it[1] ? { item: SITE + it[1] } : {}) })) });
const G = graph => ({ "@context": "https://schema.org", "@graph": graph });

/* ---------------------------------------------------------------- Bausteine */
// Freiwillige Spalte „Eintritt“ im Blatt Märkte: „frei“ oder ein Betrag wie „2 €“ / „2,50“. Nur dann gibt es Preisangaben für Google.
const priceOf = v => { v = String(v || "").trim().toLowerCase(); if (!v) return null; if (/^(eintritt\s+)?(frei|kostenlos|gratis)\b|^0([.,]0{1,2})?\s*(€|eur|euro)?\b/.test(v)) return 0; const m = /^(\d{1,3})(?:[.,](\d{1,2}))?\s*(€|eur|euro)(?=$|[\s,;(])/.exec(v) || /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(v); return m ? +(m[1] + "." + (m[2] || "0")) : null; };
// Anzeige: reine Angaben („frei“, „3 €“) einheitlich, längere Texte wie eingetragen
const entryText = m => { const p = priceOf(m.entry), plainV = /^(eintritt\s+)?(frei|kostenlos|gratis)$|^\d{1,3}([.,]\d{1,2})?\s*(€|eur|euro)?$/i.test(m.entry); return p === null || !plainV ? m.entry : p === 0 ? "frei" : p.toFixed(2).replace(".", ",").replace(",00", "") + " €"; };
function eventLD(e) {
  const m = e.m, parts = m.addr.split(", "), pm = /(\d{5})\s+(.+)/.exec(parts[parts.length - 1] || "");
  const ev = {
    "@type": "Event", name: m.name, url: `${SITE}/flohmarkt/${m.slug}/`,
    startDate: e.start ? `${e.k}T${tFirst(e.start)}:00${berlinOff(e.date)}` : e.k,
    eventStatus: e.cancelled ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", description: noPast(m.note) || m.name,
    location: { "@type": "Place", name: m.place, address: { "@type": "PostalAddress", streetAddress: parts[0], addressLocality: pm ? pm[2] : (parts.length > 1 ? parts[parts.length - 1] : (m.area || "Hamburg")), addressCountry: "DE", ...(pm ? { postalCode: pm[1] } : {}) } }
  };
  if (e.start && e.end) ev.endDate = `${e.k}T${tLast(e.end)}:00${berlinOff(e.date)}`;
  else if (!e.start) ev.endDate = e.k; // ohne Uhrzeit: Der Markt endet am selben Tag
  // Bild: das Logo (Google erlaubt „Bild oder Logo“). Bewusst kein Foto, damit keinem Markt ein fremdes Bild zugeordnet wird.
  if (HAS_ICONS) ev.image = [SITE + "/assets/icon-512.png"];
  const price = priceOf(m.entry);
  if (price !== null && !e.cancelled) ev.offers = { "@type": "Offer", price, priceCurrency: "EUR", availability: "https://schema.org/InStock", url: `${SITE}/flohmarkt/${m.slug}/`, validFrom: key(TODAY) };
  if (m.org) ev.organizer = { "@type": "Organization", name: m.org, ...(m.web ? { url: m.web } : {}) };
  return ev;
}
function evHTML(e, h = 3) {
  const m = e.m;
  // Kompakte Karte für Listen: Zeit, Name, Ort, Merken und „Zum Markt“. Beschreibung, Art, Rhythmus und Veranstalter stehen auf der Marktseite.
  // Zeit als „8–16 Uhr“ (Handy: gelbe Zeile, ab Tablet: runder Sticker mit „8–16“ über „Uhr“)
  const t = ic("clock") + (e.cancelled ? '<span class="t-lab">Termin</span><span class="t-main">fällt aus</span>' : !e.start ? '<span class="t-lab">Uhrzeit</span><span class="t-main">folgt</span>' : e.end ? `<span class="t-main">${hmText(e.start)}–${hmText(e.end)}</span><span class="t-u">Uhr</span>` : `<span class="t-lab">ab</span><span class="t-main">${hmText(e.start)}</span><span class="t-u">Uhr</span>`);
  return `<article class="ev${e.cancelled ? " off" : ""}" data-tags="${esc([...m.tags, ...timeTags(e)].join("|"))}"${llAttr(m)}${!e.cancelled && e.start ? ` data-s="${tFirst(e.start)}"${e.end ? ` data-e="${tLast(e.end)}"` : ""}` : ""}>${favBtn(m)}<div class="time" aria-label="${esc(e.cancelled ? "Abgesagt" : timeText(e))}">${t}</div><div class="ev-body">
<h${h}><a href="/flohmarkt/${m.slug}/">${esc(m.name)}</a>${neuPill(m)}</h${h}><p class="meta ln">${ic("pin")}<span><b>${esc(m.area)}</b> · ${addrNb(m.addr)}</span></p>
${e.cancelled ? `<p class="note warn-text">Dieser Termin fällt aus.${e.note ? " " + esc(e.note.replace(/([^.!?…])$/, "$1.")) : ""}</p>` : e.note ? `<p class="note ev-note">${esc(e.note.replace(/([^.!?…])$/, "$1."))}</p>` : ""}
<div class="row foot"><a class="route go" href="/flohmarkt/${m.slug}/" aria-label="Zum Markt: ${esc(m.name)}">Zum Markt${ic("chev")}</a></div></div></article>`;
}
// lvl = Überschriftenebene der Tage (2 direkt unter der H1, 3 innerhalb eines H2-Abschnitts)
// anchor: Jeder Tag bekommt eine Sprungmarke wie #24-oktober (Monatsseiten, Ziel der Suche nach Datum)
const dayId = d => `${d.getUTCDate()}-${MSLUG[d.getUTCMonth()]}`;
// Tage mit mehr als sechs Märkten in Stadt und Umland bekommen Zwischenüberschriften „Hamburg“ und „Umland“
const isUm = m => !!(RBY[m.bez] || {}).umland;
const listOf = (list, lvl) => {
  const hh = list.filter(e => !isUm(e.m)), um = list.filter(e => isUm(e.m)), card = e => evHTML(e, lvl + 1);
  if (list.length <= 6 || !hh.length || !um.length) return `<div class="list">${list.map(card).join("")}</div>`;
  return [["Hamburg", hh], ["Umland", um]].map(([l, a]) => `<div class="sub"><p class="sub-h">${l}</p><div class="list">${a.map(card).join("")}</div></div>`).join("");
};
const nMk = n => `${n} ${n === 1 ? "Markt" : "Märkte"}`;
// Tagesleiste über langen Listen: ein Tag je Feld mit Anzahl, Antippen springt zum Tag (Ziel: Sprungmarken der Tage, siehe groupList mit anchor)
const dayStrip = evs => { const g = new Map(); for (const e of evs) if (!e.cancelled) g.set(e.k, [...(g.get(e.k) || []), e]);
  // Statt Wochentag steht „Heute“ und „Morgen“ da, darunter die Anzahl als Wort („3 Märkte“). Das Skript zieht beides am nächsten Tag nach.
  const rel = { [key(TODAY)]: "Heute", [key(addDays(TODAY, 1))]: "Morgen" };
  return g.size < 3 ? "" : `<nav class="daystrip" aria-label="Zum Tag springen">${[...g].map(([k, l]) => { const d = l[0].date; return `<a class="ds${rel[k] ? " now" : ""}" href="#${dayId(d)}" data-day="${k}" data-wd="${WD[d.getUTCDay()]}"><span class="ds-w">${rel[k] || WD[d.getUTCDay()]}</span><span class="ds-d">${d.getUTCDate()}.${d.getUTCMonth() + 1}.</span><span class="ds-n">${nMk(l.length)}</span></a>`; }).join("")}</nav>`; };
function groupList(evs, lvl = 2, anchor = false) {
  const g = new Map(); for (const e of evs) { if (!g.has(e.k)) g.set(e.k, []); g.get(e.k).push(e); }
  return [...g].map(([k, list]) => `<div class="group${anchor ? " anc" : ""}" data-day="${k}"${anchor ? ` id="${dayId(list[0].date)}"` : ""}><h${lvl} class="group-h">${ic("cal")}${WDL[list[0].date.getUTCDay()]}, ${pad(list[0].date.getUTCDate())}.${pad(list[0].date.getUTCMonth() + 1)}.${list[0].date.getUTCFullYear()}${list.some(e => !e.cancelled) ? `<span class="gn">· ${nMk(list.filter(e => !e.cancelled).length)}</span>` : ""}${HOLI[k] ? ` <span class="hol">${HOLI[k]}</span>` : ""}${wxChip(wxDay(list))}</h${lvl}>${listOf(list, lvl)}</div>`).join("");
}
const kbCard = s => { const r = KBY[s]; if (!r) { warn("Ratgeber", `Verweis auf unbekannten Artikel „${s}“`); return ""; } return `<a class="card" href="/ratgeber/${r.s}/"><span class="kicker">Ratgeber · ${esc(CLUSTERS[r.c]?.t || "")}</span><h3>${brColon(esc(r.h))}</h3><p>${esc(short(plain(r.a), 110))}</p></a>`; };
function short(t, n) { t = String(t || ""); if (t.length <= n) return t; const cut = t.slice(0, n); return (cut.lastIndexOf(" ") > n * 0.6 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,.;:–-]+$/, "") + " …"; }
const mCard = m => { const n = nextEv(m); return `<a class="card" href="/flohmarkt/${m.slug}/"><span class="kicker">${esc(m.area)}${neuPill(m)}</span><h3>${esc(m.name)}</h3><p class="ln">${ic("repeat")}<span>${esc(m.rhythm)}</span></p>${n ? `<p class="ln" data-day="${n.k}">${ic("cal")}<span>Nächster Termin ${fmtShortY(n)}</span></p>` : ""}</a>`; };
const grid = cards => { cards = cards.filter(Boolean); const n = cards.length; return `<div class="news ${n % 3 === 0 ? "cols3" : n % 2 === 0 ? "cols2" : "fit"}">${cards.join("")}</div>`; };
const regionChips = skip => `<div class="chips">${[["/heute/", "Heute"], ["/morgen/", "Morgen"], ["/wochenende/", "Wochenende"], ["/samstag/", "Samstag"], ["/sonntag/", "Sonntag"], [WEEK_P, "Unter der Woche"]].filter(x => x[0] !== skip).map(([h, l]) => `<a class="chip" href="${h}">${ic(h === "/heute/" ? "sun" : "cal")}${l}</a>`).join("")}${REGIONS.filter(r => `/flohmarkt-hamburg/${r.k}/` !== skip).map(r => `<a class="chip" href="/flohmarkt-hamburg/${r.k}/">${esc(r.name)}</a>`).join("")}</div>`;
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
// Wischen & merken (Seite /entdecken/ und Hinweis auf der Startseite)
// Die Märkte der nächsten vier Wochen (höchstens 80 Karten). Das Skript blendet vergangene Tage und heute schon beendete Märkte aus.
const DK_EVS = EVENTS.filter(e => !e.cancelled && (e.date - TODAY) / 864e5 < 29).slice(0, 80);
const deckCard = e => {
  const m = e.m, hm = x => x.includes("/") ? hmText(x) : x;
  const t = !e.start ? "Uhrzeit folgt" : e.end ? `${hm(e.start)} bis ${hm(e.end)}` : `ab ${hm(e.start)}`;
  return `<article class="dk-card" data-fav="${m.slug}" data-name="${esc(m.short || m.name)}" data-day="${e.k}"${e.start ? ` data-s="${tFirst(e.start)}"` : ""}${e.start && e.end ? ` data-e="${tLast(e.end)}"` : ""}>
<div class="dk-top"><p class="dk-day">${WDL[e.date.getUTCDay()]}</p><p class="dk-date">${e.date.getUTCDate()}. ${MON[e.date.getUTCMonth()]}</p><span class="dk-time">${ic("clock")}<span>${t}</span></span></div>
<div class="dk-body"><h2>${esc(m.name)}${neuPill(m)}</h2><p class="meta ln">${ic("pin")}<span><b>${esc(m.area)}</b> · ${addrNb(m.addr)}</span></p>
${m.note ? `<p class="note">${esc(m.note)}${e.note ? " " + esc(e.note.replace(/([^.!?…])$/, "$1.")) : ""}</p>` : ""}${m.tags.length ? `<div class="row">${m.tags.map(t => `<span class="tag">${tagIc(t)}${esc(t)}</span>`).join("")}</div>` : ""}
<p class="ln rhythm">${ic("repeat")}<span>${esc(m.rhythm)}</span></p><a class="route go" href="/flohmarkt/${m.slug}/">Zum Markt${ic("chev")}</a></div>
<span class="dk-stamp yes" aria-hidden="true">${ic("thumbsup")}Merken →</span><span class="dk-stamp no" aria-hidden="true">← Nein${ic("thumbsdown")}</span></article>`;
};
// Kartenstapel (Seite /entdecken/ und Startseite). mini = kompakte Fassung für die Startseite: ohne Beschreibung, ohne Tastatur.
const deckHTML = mini => `<section class="deck${mini ? " mini" : ""}" id="deck"${mini ? "" : " data-keys"}${DK_EVS.length ? "" : " hidden"}>
<p class="dk-count js-only" id="dkCount" aria-live="polite"></p>
<div class="dk-stack" id="dkStack">${DK_EVS.map(deckCard).join("")}</div>
<div class="dk-done" id="dkDone" hidden><p class="dk-done-h" id="dkDoneH">Geschafft!</p><p id="dkDoneP"></p><div class="share-row"><a class="btn" href="/merkliste/">${ic("heart")}Zur Merkliste</a><button type="button" class="btn" id="dkAgain">${ic("undo")}Nochmal von vorn</button><a class="route" href="/termine/">Alle Termine${ic("chev")}</a></div></div>
<div class="dk-btns js-only" id="dkBtns"><span class="dk-bw"><button type="button" class="dk-b no" id="dkNo" aria-label="Nein, nicht merken">${ic("thumbsdown")}</button><span class="dk-bl" aria-hidden="true">← Nein</span></span><span class="dk-bw"><button type="button" class="dk-b undo" id="dkUndo" aria-label="Rückgängig" disabled>${ic("undo")}</button><span class="dk-bl" aria-hidden="true">Zurück</span></span><span class="dk-bw"><button type="button" class="dk-b yes" id="dkYes" aria-label="Merken">${ic("thumbsup")}</button><span class="dk-bl" aria-hidden="true">Merken →</span></span></div>
${mini ? "" : '<p class="dk-hint js-only">Am Computer gehen auch die Pfeiltasten ← und →.</p>'}
</section>
<div class="empty" id="dkEmpty"${DK_EVS.length ? " hidden" : ""}>In den nächsten vier Wochen steht gerade kein Flohmarkt im Kalender. ${more("/termine/", "Alle Termine")}</div>`;

/* ---------------------------------------------------------------- SEO-Bausteine
   Seiten nach Art des Markts, Monatsseiten, Feiertage und Hilfen für Titel und Beschreibungen.
   Alles wird aus den Daten berechnet, damit Titel, Beschreibungen und Listen immer stimmen. */
const YEAR = TODAY.getUTCFullYear();
// Jahr(e) einer Terminliste für Titel: „2026“ oder „2026/27“
const yearSpan = evs => { const ys = [...new Set(evs.map(e => e.date.getUTCFullYear()))].sort(); return !ys.length ? String(YEAR) : ys.length === 1 ? String(ys[0]) : `${ys[0]}/${String(ys[ys.length - 1]).slice(2)}`; };
const dDate = d => `${WD[d.getUTCDay()]}., ${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`;
// Datum in Ziffern, so wie viele es bei Google eintippen („flohmarkt 10.10.26“): „Sa., 10.10.2026“
const numD = d => `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`, wdNum = d => `${WD[d.getUTCDay()]}., ${numD(d)}`;
const nextOf = evs => evs.find(e => !e.cancelled);
// Kurze, bekannte Namen zuerst (für knappe Beschreibungen)
const topNames = (evs, n = 2) => listNames([...new Set(evs.map(e => e.m))].sort((a, b) => (b.tags.includes("Groß & bekannt") - a.tags.includes("Groß & bekannt")) || a.short.length - b.short.length).map(m => m.short), n);
const darunter = evs => new Set(evs.map(e => e.m)).size === 1 ? `: ${topNames(evs, 1)}` : `, darunter ${topNames(evs)}`;
const listMore = (arr, n) => arr.length > n ? arr.slice(0, n).join(", ") + " und weitere" : listNames(arr, n);
const listNames = (arr, n = 3) => { const a = [...new Set(arr)].slice(0, n); return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " und " + a[a.length - 1]; };
// Erste Beschreibung, die in die ideale Länge passt (Google zeigt etwa 120 bis 155 Zeichen)
const pickDesc = (...c) => { c = c.filter(Boolean).map(x => x.replace(/\s+/g, " ").trim()); return c.find(x => x.length >= 115 && x.length <= 158) || c.find(x => x.length <= 158) || c[0]; };
// Beschreibungen aus dem Sheet mit festem Datum veralten, die ersetzen wir durch berechnete
// Veraltet wirkt ein Sheet-Text nur mit konkretem Datum („31. Oktober“, „Oktober 2026“, „im Oktober“, „Ende Oktober“, „31.10.“).
// Eine Saisonangabe wie „März bis Oktober“ bleibt stehen.
const STALE = new RegExp(`\\b\\d{1,2}\\.\\s*(${MON.join("|")})\\b|\\b(${MON.join("|")})\\s+20\\d\\d\\b|\\b(im|Anfang|Mitte|Ende)\\s+(${MON.join("|")})\\b|\\b\\d{1,2}\\.\\d{1,2}\\.`, "i");
const fresh = t => t && !STALE.test(t) ? t : "";
// Vergangene Daten in Texten aus dem Blatt Märkte finden („11. Oktober“, „4.10.“, „6. Dezember 2026“). Ohne Jahr gilt das Datum,
// das am ehesten gemeint ist: bis 150 Tage voraus zählt als kommend, sonst als letztes Jahr. Der Bau meldet solche Stellen im Bericht.
const noPast = t => t && !pastDates(t).length ? t : ""; // Text nur, wenn er kein vergangenes Datum nennt
const pastDates = t => {
  if (!t) return [];
  const out = [], re = new RegExp(`\\b(\\d{1,2})\\.\\s*(?:(${MON.join("|")})|(\\d{1,2})\\.)(?:\\s*(20\\d\\d|\\d{2})\\b)?`, "gi");
  for (const x of String(t).matchAll(re)) {
    const day = +x[1], mon = x[2] ? MON.findIndex(n => n.toLowerCase() === x[2].toLowerCase()) : +x[3] - 1;
    if (mon < 0 || mon > 11 || day < 1 || day > 31) continue;
    // Ohne Jahr direkt am Datum: ein Jahr kurz davor im Text gilt mit („Für 2027 nennt der Veranstalter den 25. April“)
    const near = !x[4] && [...String(t).slice(Math.max(0, x.index - 120), x.index).matchAll(/\b(20\d\d)\b/g)].map(m => +m[1]).filter(v => v >= YEAR - 1 && v <= YEAR + 2).pop();
    let y = x[4] ? +x[4] + (x[4].length === 2 ? 2000 : 0) : near || YEAR, d = new Date(Date.UTC(y, mon, day));
    if (!x[4] && !near) { if (d > addDays(TODAY, 150)) d = new Date(Date.UTC(y - 1, mon, day)); else if (d < addDays(TODAY, -215)) d = new Date(Date.UTC(y + 1, mon, day)); }
    if (d < TODAY) out.push(x[0].trim());
  }
  return [...new Set(out)];
};

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
  { s: "hallenflohmarkt-hamburg", tag: "Überdacht", icon: "umbrella", chip: "Hallen & überdacht", pl: "Hallenflohmärkte und überdachte Flohmärkte", plW: "Hallenflohmärkte und überdachten Flohmärkte",
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
  { s: "groesste-flohmaerkte-hamburg", tag: "Groß & bekannt", icon: "star", chip: "Große Märkte", pl: "große und bekannte Flohmärkte", plW: "großen und bekannten Flohmärkte",
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
  { s: "flohmarkt-hamburg-umgebung", tag: "Umland", icon: "tree", chip: "Umland bis 30 km", pl: "Flohmärkte im Hamburger Umland", ort: false, plKurz: "Flohmärkte", ansStart: "Im Hamburger Umland bis 30 Kilometer",
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
const catCta = c => { const nx = nextOf(c.evs); return `<a class="cta-box" href="/${c.s}/">${ic(c.icon)}<span><b>${c.ort === false ? "" : "In Hamburg: "}${esc(cap(c.pl))}</b>${c.ms.length} Märkte mit allen Terminen${nx ? `, der nächste am ${dDate(nx.date)}` : ""}.</span>${ic("chev")}</a>`; };
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
const nearBox = (what = "Termine") => PLZ_ROWS.length ? `<div class="near" id="near" hidden><button type="button" class="near-h" id="nearTog" aria-expanded="false" aria-controls="nearIn">${ic("pin")}${what} in deiner Nähe${ic("chev", "i near-chev")}</button><div class="near-in" id="nearIn" hidden><form class="near-form" id="nearForm" novalidate>
<label class="near-plz"><span>Postleitzahl</span><input id="nearPlz" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="z. B. 22765" autocomplete="postal-code" enterkeyhint="search"></label>
<label class="near-km"><span>Umkreis</span><select id="nearKm"><option value="3">3 km</option><option value="5">5 km</option><option value="10" selected>10 km</option><option value="20">20 km</option><option value="30">30 km</option></select></label>
<button type="submit" class="btn near-go" id="nearGo">Anzeigen</button>
<button type="button" class="chip near-geo" id="nearGeo">${ic("route")}Mein Standort</button><button type="button" class="chip" id="nearClear" hidden>Zurücksetzen</button></form>
<p class="near-msg" id="nearMsg" aria-live="polite">Postleitzahl eingeben und auf „Anzeigen“ tippen. Entfernungen sind ungefähr, gerechnet ab der Mitte der Postleitzahl. Deine Eingabe bleibt auf deinem Gerät.</p></div></div>` : "";
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
   Kommt ein Tag neu dazu, der noch nicht in der Tabelle steht, oder verschwindet ein Tag, der noch im Kalender steht,
   dann steht das im Bericht: „bitte prüfen“. Es wird nichts automatisch übernommen.
   Gespeichert werden nur Adresse und die gefundenen Datumsangaben mit ihrer Anzahl (keine Texte, keine Personen),
   und zwar in /assets/waechter.json der Website selbst. Der nächste Bau liest die Datei von dort wieder ein.
   robots.txt der Veranstalter wird beachtet. Läuft nur im echten Bau (SHEET_ID) oder mit WAECHTER=an; aus mit WAECHTER=aus.

   Damit der Bericht ruhig bleibt, zählt nicht mit:
   - was auf den meisten Seiten desselben Veranstalters gleich steht (Liste „nächste Märkte“ in der Randspalte),
   - auf Sammelseiten für mehrere Märkte alles, was erkennbar zu anderen Orten gehört,
   - auf der Startseite eines Veranstaltungsorts alles ohne Marktwort in der Nähe (Konzerte, Gottesdienste),
   - Randbereiche der Seite (Seitenleiste, Navigation, Fußzeile) mit anderen Veranstaltungen des Hauses,
   - vergangene Tage und das heutige Tagesdatum,
   - Tage, die schon in der Tabelle stehen oder von einer Serie abgedeckt sind. */
const WATCH = { v: 2, stand: "", seiten: {} }, WATCH_ROWS = [];
// Datumsangabe von einer Veranstalterseite („14.11.“, „14.11.2026“, „14. nov 2026“) in ein Datum wandeln; ohne Jahr: das nächste Mal ab heute
const WMON = { jan: 1, feb: 2, "mär": 3, mae: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 };
const tokParts = t => { let m = /^(\d{2})\.(\d{2})\.(\d{4})?$/.exec(t); if (m) return [+m[1], +m[2], m[3] ? +m[3] : 0]; m = /^(\d{2})\. (\S{3})(?: (\d{4}))?$/.exec(t); return m && WMON[m[2]] ? [+m[1], WMON[m[2]], m[3] ? +m[3] : 0] : null; };
const tokDate = t => {
  const p = tokParts(t); if (!p) return null; const [d, mo, y] = p;
  const mk = yy => { const x = new Date(Date.UTC(yy, mo - 1, d)); return x.getUTCMonth() === mo - 1 ? x : null; };
  if (y) return mk(y);
  const a = mk(TODAY.getUTCFullYear()); return a && a >= TODAY ? a : mk(TODAY.getUTCFullYear() + 1);
};
const mostOf = a => { const c = {}; let best = ""; for (const x of a) if (x) { c[x] = (c[x] || 0) + 1; if (!best || c[x] > c[best]) best = x; } return best; };
const deDate = d => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
// alle Zeilen des Blatts Termine je Markt (auch vergangene und abgesagte), still gelesen: Fehler darin sind oben schon gemeldet
const ROW_DAYS = {};
{ const n = warnings.length, tm = v => { const m = /^(\d{1,2})[:.](\d{2})/.exec(String(v || "").trim()); return m && +m[1] < 24 ? m[1].padStart(2, "0") + ":" + m[2] : ""; };
  for (const r of data.Termine) { const d = r["Markt"] && r["Datum"] ? parseDate(r["Datum"], "") : null; if (d) (ROW_DAYS[r["Markt"]] = ROW_DAYS[r["Markt"]] || []).push({ d, k: key(d), start: tm(r["Beginn"]), end: tm(r["Ende"]) }); }
  for (const [b, t] of warnings.splice(n)) warnSeen.delete(b + "|" + t); }
// alle Tage, die für einen Markt schon in der Tabelle stehen (Einzeltermine jeder Zukunft, Serien im Vorschau-Zeitraum)
const knownDays = m => new Set([...m.events.map(e => e.k), ...(ROW_DAYS[m.slug] || []).map(r => r.k)]);
{
  const mode = (process.env.WAECHTER || "").toLowerCase(), UA = `FlohlotseBot/1.0 (+${SITE}/veranstalter/#waechter)`;
  const get = async (u, ms = 10000) => { const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { "User-Agent": UA, "Accept": "text/html,text/plain" }, redirect: "follow" }); if (!r.ok) throw new Error("HTTP " + r.status); return (await r.text()).slice(0, 1500000); };
  const MONS = "januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sep|sept|okt|nov|dez";
  // Sichtbaren Text aus HTML holen. Bewusst ohne verschachtelte Muster: Auch eine kaputte Seite mit tausenden offenen „<“ darf den Bau nicht bremsen.
  // Mit rand = true fallen Randbereiche weg: <aside>, <nav>, <footer> und Blöcke, deren class/id „sidebar“ oder „widget-area“ enthält.
  // Dort stehen oft andere Veranstaltungen des Hauses (z. B. „17.10. Line Dance“ neben der Flohmarktseite eines Sportvereins).
  const RAND = /^<(aside|nav|footer)\b|^<([a-z][a-z0-9]*)\b[^>]*\b(?:class|id)\s*=\s*["'][^"']*(?:sidebar|widget-area)/;
  const textOf = (html, rand = false) => {
    const low = html.toLowerCase(); let out = "", i = 0, gt = -2;   // gt: Stelle des nächsten „>“ (gemerkt, damit nicht immer wieder gesucht wird)
    const cut = (from, to) => { out += html.slice(i, from) + " "; i = to; };
    // Ende eines Elements finden (gleichnamige Elemente darin werden mitgezählt); ohne passendes Ende: -1, dann bleibt alles stehen
    const endOf = (a, name) => { let depth = 0, p = a; const o = "<" + name, c = "</" + name;
      for (let k = 0; k < 5000; k++) { const x = low.indexOf(o, p), y = low.indexOf(c, p); if (y < 0) return -1;
        if (x >= 0 && x < y) { if (/[\s>/]/.test(low[x + o.length] || "")) depth++; p = x + o.length; continue; }
        depth--; const g = low.indexOf(">", y); if (g < 0) return -1; if (depth <= 0) return g + 1; p = g + 1; }
      return -1; };
    for (;;) {
      const a = low.indexOf("<", i); if (a < 0) break;
      if (low.startsWith("<!--", a)) { const e = low.indexOf("-->", a + 4); cut(a, e < 0 ? html.length : e + 3); continue; }
      const m = /^<(script|style|noscript|svg|template)\b/.exec(low.slice(a, a + 12));
      if (m) { const e = low.indexOf("</" + m[1], a + 1), g = e < 0 ? -1 : low.indexOf(">", e); cut(a, g < 0 ? html.length : g + 1); continue; }
      if (!/[a-z/!?]/.test(low[a + 1] || "")) { out += html.slice(i, a + 1); i = a + 1; continue; } // „<“ ohne Buchstaben dahinter ist kein Tag, sondern Text („a < b“)
      if (gt !== -1 && gt <= a) gt = low.indexOf(">", a + 1);
      if (gt < 0) break;                                                           // kein „>“ mehr: der Rest ist Text
      const n = low.indexOf("<", a + 1);
      if (n >= 0 && n < gt) { out += html.slice(i, a + 1); i = a + 1; continue; }  // „<“ vor dem nächsten „>“: das Zeichen ist Text
      if (rand && low[a + 1] !== "/") { const r = RAND.exec(low.slice(a, gt + 1)); if (r) { const e = endOf(a, r[1] || r[2]); if (e > 0) { cut(a, e); continue; } } }
      cut(a, gt + 1);
    }
    return (out + html.slice(i)).replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  };
  // Datumsangaben herausziehen: „14.11.“, „14.11.2026“, „14.11.26“, „14. November“, auch Doppeltermine wie „24./25.10.“.
  // Je Fundstelle bleibt kurz der Text davor und danach im Arbeitsspeicher (nicht in der Datei), um Sammelseiten den Märkten zuzuordnen.
  const Y0 = TODAY.getUTCFullYear(), p2 = n => String(n).padStart(2, "0"), SEP = "(?:\\/|\\+|&|-|–|und|u\\.|bis)";
  const datesOf = html => {
    const voll = textOf(html), ohneRand = textOf(html, true);
    const hat = t => /\b\d{1,2}\.\s?(?:\d{1,2}\.|[a-zäö]{3})/i.test(t);
    // Randbereiche weglassen, außer die Seite hätte dann gar kein Datum mehr (dann lieber alles lesen, als einen echten Termin zu übersehen)
    const txt = hat(ohneRand) || !hat(voll) ? ohneRand : voll;
    let occ = [];
    // Fristen sind keine Markttage: „Anmeldeschluss ist der 29.10.“, „Stornierung … nur bis zum 29.10. möglich“ (ohne Satzende dazwischen)
    const FRIST = /(?:anmeldeschluss|anmeldefrist|meldeschluss|einsendeschluss|bewerbungsschluss|stornier\S*|storno\S*|abbuchung|zuletzt aktualisiert|zuletzt geändert)[^0-9.!?]{0,90}$/i;
    const push = (t, m) => { if (FRIST.test(txt.slice(Math.max(0, m.index - 100), m.index))) return; occ.push({ t, i: m.index, j: m.index + m[0].length }); };
    // Jahr: vierstellig (auch nach Leerzeichen) oder zweistellig direkt angehängt und plausibel. „25.10. 10–16 Uhr“ ist keine Jahreszahl.
    for (const m of txt.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.(?:\s?((?:19|20)\d{2})\b|(\d{2})\b(?![.:]\d))?/g)) { const d = +m[1], mo = +m[2], y2 = m[4] ? 2000 + +m[4] : 0;
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) push(`${p2(d)}.${p2(mo)}.${m[3] || (y2 >= Y0 - 5 && y2 <= Y0 + 3 ? y2 : "")}`, m); }
    for (const m of txt.matchAll(new RegExp(`\\b(\\d{1,2})\\.\\s?(${MONS})\\b\\.?(?:\\s?(\\d{4}))?`, "gi"))) { const d = +m[1]; if (d >= 1 && d <= 31) push(`${p2(d)}. ${m[2].toLowerCase().slice(0, 3)}${m[3] ? " " + m[3] : ""}`, m); }
    // erster Tag eines Doppeltermins („24./25.10.2026“, „24. und 25. Oktober“): Monat und Jahr stehen erst beim zweiten Tag
    for (const m of txt.matchAll(new RegExp(`\\b(\\d{1,2})\\.\\s?${SEP}\\s?(?=\\d{1,2}\\.\\s?(\\d{1,2})\\.(?:\\s?((?:19|20)\\d{2})\\b)?)`, "g"))) { const d = +m[1], mo = +m[2]; if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) push(`${p2(d)}.${p2(mo)}.${m[3] || ""}`, m); }
    for (const m of txt.matchAll(new RegExp(`\\b(\\d{1,2})\\.\\s?${SEP}\\s?(?=\\d{1,2}\\.\\s?(${MONS})\\b\\.?(?:\\s?(\\d{4}))?)`, "gi"))) { const d = +m[1]; if (d >= 1 && d <= 31) push(`${p2(d)}. ${m[2].toLowerCase().slice(0, 3)}${m[3] ? " " + m[3] : ""}`, m); }
    occ.sort((a, b) => a.i - b.i);
    const all = {}; for (const o of occ) all[o.t] = (all[o.t] || 0) + 1;
    // Behalten wird, was nicht älter als 400 Tage ist, nach Datum sortiert und höchstens 600 Angaben (die Grenze verschiebt sich so nicht, wenn vorn etwas dazukommt)
    const seit = addDays(TODAY, -400), when = t => { const d = tokDate(t); return d ? d.getTime() : 0; };
    const dates = Object.keys(all).filter(t => { const d = tokDate(t); return !d || d >= seit; }).sort((a, b) => when(a) - when(b) || (a < b ? -1 : 1)).slice(0, 600), keep = new Set(dates), n = Object.fromEntries(dates.map(t => [t, all[t]]));
    // Text zwischen dieser und der vorigen bzw. nächsten Datumsangabe (höchstens 80 bzw. 100 Zeichen)
    occ = occ.map((o, k) => ({ t: o.t, b: txt.slice(Math.max(k ? occ[k - 1].j : 0, o.i - 80), o.i).toLowerCase(), a: txt.slice(o.j, Math.min(k + 1 < occ.length ? occ[k + 1].i : txt.length, o.j + 100)).toLowerCase() })).filter(o => keep.has(o.t));
    return { dates, n, occ, len: txt.length };
  };
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

  /* Sammelseite für mehrere Märkte (z. B. eine Terminliste für viele Orte): Welche Datumsangabe gehört zu welchem unserer Märkte?
     Gesucht wird der Ortsname direkt vor oder nach dem Datum. Ob die Seite den Ort vor oder hinter das Datum schreibt, zeigt sich
     an den Tagen, die wir schon kennen: Die Seite, auf der die bekannten Tage beim richtigen Markt landen, gewinnt.
     Klappt das bei weniger als 80 % der bekannten Tage (ein Ausreißer ist erlaubt), wird nichts zugeordnet (Ergebnis null) und die
     Seite wie bisher behandelt. Hat es in der letzten Nacht geklappt (sticky), genügt die Hälfte: So kippt die Zuordnung nicht,
     nur weil ein bekannter Tag von der Seite verschwindet – genau das soll ja gemeldet werden. */
  // Ketten-Namen (famila, toom, Hagebau, ADLER …) erkennen keinen Markt: Sie stehen auf Sammelseiten auch bei fremden Orten (z. B. „HAGEBAU-Flohmarkt Itzehoe“ neben „Hagebau Rellingen“).
  const STOPW = new Set("und der die das den dem des am an im in auf bei von vom zum zur mit für rund ums ehemals flohmarkt flohmärkte flohmaerkte markt märkte marktplatz hamburg hamburger parkplatz parkdeck außenfläche außengelände gelände center centrum halle saal platz straße strasse kind kinder famila ikea rewe edeka kaufland metro marktkauf globus höffner real toom obi hagebau hagebaumarkt baumarkt bauhaus hornbach hellweg dehner adler aldi lidl penny netto citti".split(" "));
  const CONNW = new Set("uhr und sowie bis von ab am um sa so mo di mi do fr samstag sonntag montag dienstag mittwoch donnerstag freitag sonnabend".split(" "));
  const isConn = s => s.length <= 40 && s.split(/[^a-zäöüß0-9]+/).every(w => !w || CONNW.has(w) || /^\d{1,4}$/.test(w));
  const translit = w => w.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const wordsOf = m => [...new Set(`${m.area} ${m.short} ${m.place}`.toLowerCase().split(/[^a-zäöüß0-9]+/).filter(w => w.length >= 3 && !STOPW.has(w) && !/^\d+$/.test(w)))];
  // Text vor (B) und nach (A) jeder Fundstelle; Aufzählungen („04.10., 01.11. und 03.01.“) erben den Text der ersten bzw. letzten Angabe
  const segsOf = g => { if (g.segs) return g.segs; const occ = g.occ, B = [], A = [];
    occ.forEach((o, k) => { B[k] = k && isConn(o.b) ? B[k - 1] : o.b; });
    for (let k = occ.length - 1; k >= 0; k--) A[k] = k + 1 < occ.length && isConn(occ[k].a) ? A[k + 1] : occ[k].a;
    return (g.segs = [B, A]); };
  /* Startseite eines Veranstaltungsorts (Kirche, Kulturhaus, Halle): Dort stehen auch Konzerte, Gottesdienste und das Tagesdatum.
     Steht bei mindestens einer Datumsangabe ein Marktwort („Flohmarkt“, „Trödel“, „Börse“ …), zählen nur Angaben mit solchem Wort. */
  const MARKTW = /floh|tr(?:ö|oe)del|markt|b(?:ö|oe)rse|basar|second/;
  const marketDates = g => { const [B, A] = segsOf(g), s = new Set(); g.occ.forEach((o, k) => { if (MARKTW.test(B[k]) || MARKTW.test(A[k])) s.add(o.t); }); return s; };
  const attribute = (g, ms, u, sticky) => {
    let hostU = new URL(u).host.toLowerCase(); try { hostU = domainToUnicode(hostU) || hostU; } catch { /* Adresse bleibt, wie sie ist */ }
    const res = ms.map(m => { const oth = new Set(ms.filter(o => o !== m).flatMap(wordsOf)); return wordsOf(m).filter(w => !oth.has(w) && !hostU.includes(w) && !hostU.includes(translit(w))).map(w => new RegExp("(^|[^a-zäöüß0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); });
    if (res.some(r => !r.length)) return null; // ein Markt ohne eigenes Erkennungswort: lieber nichts zuordnen
    const occ = g.occ, [B, A] = segsOf(g);
    const side = segs => { const by = {}; occ.forEach((o, k) => { const s = (by[o.t] = by[o.t] || new Set()); res.forEach((rs, mi) => { if (rs.some(r => r.test(segs[k]))) s.add(mi); }); }); return by; };
    const sb = side(B), sa = side(A), known = ms.map(knownDays);
    const kt = g.dates.filter(t => { const d = tokDate(t); return d && known.some(s => s.has(key(d))); });
    const score = by => kt.filter(t => { const k = key(tokDate(t)); return [...(by[t] || [])].some(mi => known[mi].has(k)); }).length;
    const scB = score(sb), scA = score(sa), n = kt.length;
    let mode = 0; // 1 = Ort steht hinter dem Datum, 2 = davor, 3 = beides
    if (sticky && (n === 0 || (sticky & 1 ? scA : 0) + (sticky & 2 ? scB : 0) >= Math.max(1, Math.ceil(n * 0.5)))) mode = sticky;
    else if (Math.max(scA, scB) >= Math.max(2, Math.min(Math.ceil(n * 0.8), n - 1))) mode = scA > scB ? 1 : scB > scA ? 2 : 3;
    if (!mode) return null;
    const pick = [...(mode & 1 ? [sa] : []), ...(mode & 2 ? [sb] : [])], out = {};
    for (const t of g.dates) { const s = new Set(pick.flatMap(by => [...(by[t] || [])])); if (s.size) out[t] = [...s].sort((x, y) => x - y); }
    return { by: out, mode }; // by: Datumsangabe → Nummern der Märkte dieser Seite
  };

  const urls = new Map(), urlMs = new Map(); for (const m of MARKETS) if (m.web) { if (!urls.has(m.web)) { urls.set(m.web, []); urlMs.set(m.web, []); } urls.get(m.web).push(m.name); urlMs.get(m.web).push(m); }
  if (mode !== "aus" && (process.env.SHEET_ID || mode === "an") && urls.size) {
    // Merkzettel der letzten Nacht. Gibt es ihn noch nicht (erster Lauf), wird nur gemerkt und nichts gemeldet. Bei einer Störung dreimal versuchen.
    let old = {};
    for (let i = 0; i < 3; i++) {
      try { const j = JSON.parse(await get(SITE + "/assets/waechter.json", 8000)); if (j && j.seiten && typeof j.seiten === "object") old = j.seiten; break; }
      catch (e) { if (/HTTP 404/.test(String(e && e.message))) break; if (i === 2) warn("Termin-Wächter", "Der Merkzettel der letzten Nacht war nicht lesbar. Der Termin-Wächter hat sich deshalb heute nur den Stand gemerkt und meldet Änderungen erst wieder ab morgen.", true); else await new Promise(r => setTimeout(r, 2000)); }
    }
    // Der Wächter liest fremde Seiten. Stolpert er dabei, darf das den Bau nicht aufhalten: Dann bleibt der Stand der letzten Nacht, und der Bericht nennt den Fehler.
    try {
    // Startseite eines Veranstalters, dessen andere Märkte bei uns mit eigener Unterseite stehen (z. B. www.marktundkultur.de/ neben …/?p=50):
    // Dort stehen die Termine aller seiner Märkte. Diese Seite prüft der Wächter nicht, sonst landen fremde Termine beim falschen Markt.
    const hostN = u => new URL(u).host.replace(/^www\./, ""), rootU = u => { const l = new URL(u); return /^\/?$/.test(l.pathname) && !l.search; };
    const overview = new Set([...urls.keys()].filter(u => rootU(u) && [...urls.keys()].some(v => v !== u && hostN(v) === hostN(u) && !rootU(v))));
    for (const u of overview) warn("Termin-Wächter", `${listNamesPlain(urls.get(u))}: Als Veranstalter-Website steht nur die Startseite ${u}. Dort stehen auch die Termine anderer Märkte des Veranstalters, deshalb prüft der Termin-Wächter diese Seite nicht. Soll er den Markt mitprüfen, die Seite des Markts eintragen.`, true);
    const todo = [...urls.keys()].filter(u => !overview.has(u)), today = key(TODAY), got = {};
    // Schritt 1: alle Seiten abrufen (höchstens vier gleichzeitig)
    const work = async () => { for (let u; (u = todo.shift());) {
      try { got[u] = (await allowed(u)) ? datesOf(await get(u)) : { gesperrt: true }; } catch { got[u] = { fehler: true }; }
    } };
    await Promise.all([work(), work(), work(), work()]);
    // Schritt 2: Datumsangaben, die auf den meisten Seiten desselben Veranstalters stehen (rollende Übersicht „nächste Märkte“,
    // Kopf- oder Fußzeile), sagen nichts über den einzelnen Markt. Gemerkt wird, wie oft sie dort üblicherweise stehen:
    // Steht ein Tag auf einer Seite öfter als üblich, ist er dort zusätzlich als eigener Termin eingetragen und zählt doch.
    const hostOf = u => new URL(u).host.replace(/^www\./, ""), base = {};
    { const byHost = {}; for (const u of urls.keys()) if (got[u] && got[u].dates) (byHost[hostOf(u)] = byHost[hostOf(u)] || []).push(u);
      for (const [h, us] of Object.entries(byHost)) { base[h] = {}; if (us.length < 5) continue; // bei wenigen Seiten wäre das Risiko zu groß, echte Termine zu übersehen
        const cnt = {}; for (const u of us) for (const t of got[u].dates) (cnt[t] = cnt[t] || []).push(got[u].n[t]);
        for (const [t, a] of Object.entries(cnt)) if (a.length >= Math.max(4, Math.ceil(us.length * 0.75))) base[h][t] = +mostOf(a.sort((x, y) => x - y).map(String)); } }
    // Ein Tag gilt als abgelaufen, wenn er vor heute liegt (ohne Jahreszahl: in den letzten 60 Tagen). Abgelaufene Tage verschwinden von selbst und sind keine Meldung wert.
    const expired = t => { const p = tokParts(t); if (!p) return false; const [d, mo, y] = p, mk = yy => new Date(Date.UTC(yy, mo - 1, d)); if (y) return mk(y) < TODAY;
      return [TODAY.getUTCFullYear(), TODAY.getUTCFullYear() - 1].some(yy => { const x = mk(yy); return x < TODAY && (TODAY - x) / 864e5 <= 60; }); };
    // Das heutige Datum steht auf vielen Seiten einfach als Tagesdatum: Es ist kein neuer Termin.
    const isToday = t => { const d = tokDate(t); return !!d && key(d) === today; };
    const young = s => (TODAY - new Date(s + "T00:00:00Z")) / 864e5 <= 7;
    const asMap = (v, seit) => !v ? {} : Array.isArray(v) ? Object.fromEntries(v.map(t => [t, seit || today])) : v;
    const seenRow = new Set();
    // Schritt 3: je Seite mit dem Stand der letzten Nacht vergleichen
    let kaputt = 0;
    for (const u of urls.keys()) { try {
      const g = got[u], prev = old[u] && typeof old[u] === "object" ? old[u] : null, names = listNamesPlain(urls.get(u)), ms = urlMs.get(u);
      if (!g) continue;
      if (g.gesperrt) { WATCH.seiten[u] = { gesperrt: true }; if (!prev || !prev.gesperrt) warn("Termin-Wächter", `${names}: Die Website des Veranstalters möchte nicht automatisch abgerufen werden (robots.txt). Diese Seite bitte weiter von Hand prüfen: ${u}`); continue; }
      if (g.fehler) { const f = ((prev && prev.fehler) || 0) + 1; WATCH.seiten[u] = { ...(prev || {}), fehler: f }; if (f === 3) warn("Termin-Wächter", `${names}: Die Website des Veranstalters war drei Nächte in Folge nicht erreichbar. Adresse in der Spalte „Veranstalter-Website“ prüfen: ${u}`); continue; }
      // eigene Datumsangaben dieser Seite: ohne seitenweite Listen, auf Sammelseiten nur die unserer Märkte
      const bs = base[hostOf(u)] || {}, attR = ms.length > 1 ? attribute(g, ms, u, prev && prev.s) : null, att = attR && attR.by;
      const loc = new URL(u), md = !att && /^\/?$/.test(loc.pathname) && !loc.search ? marketDates(g) : null, mdOn = !!md && md.size > 0;
      const own = g.dates.filter(t => (!(t in bs) || g.n[t] > bs[t]) && (!att || att[t]) && (!mdOn || md.has(t))), ownSet = new Set(own);
      // verglichen wird der Tag, nicht die Schreibweise: Aus „15.11.2026“ darf „15. November 2026“ werden, ohne dass es eine Meldung gibt
      const dayOf = t => { const d = tokDate(t); return d ? key(d) : t; }, ownDays = new Set(own.map(dayOf));
      // Stand der letzten Nacht; bis Oktober 2026 war das eine einfache Liste ohne Anzahl (höchstens 150 Einträge)
      const legacy = !!prev && Array.isArray(prev.d);
      const prevN = prev && prev.d ? (legacy ? Object.fromEntries(prev.d.map(t => [t, 1])) : prev.d) : null;
      const prevOwn = !prevN ? [] : legacy ? prev.d.filter(t => !(t in g.n) || ownSet.has(t)) : (Array.isArray(prev.o) ? prev.o : Object.keys(prevN)), prevOwnDays = new Set(prevOwn.map(dayOf));
      // Zeigt die Seite plötzlich gar kein Datum mehr (Wartungsseite, Umbau, Störung), wird abgewartet, bevor Termine als verschwunden gelten:
      // eine Nacht, und zwei Nächte, wenn dort vorher mehrere Termine standen oder die Seite dabei stark geschrumpft ist
      if (!g.dates.length && prevN && Object.keys(prevN).length && (prev.leer || 0) < (Object.keys(prevN).length >= 3 || (prev.l > 0 && g.len < prev.l * 0.4) ? 2 : 1)) { WATCH.seiten[u] = { ...prev, leer: (prev.leer || 0) + 1 }; continue; }
      const cut = legacy && prev.d.length >= 150 ? prev.d[prev.d.length - 1] : "";
      const pNeu = asMap(prev && prev.neu, prev && prev.seit), pWeg = asMap(prev && prev.weg, prev && prev.seit), neu = {}, weg = {};
      if (prevN) {
        for (const t of own) { if (expired(t) || isToday(t)) continue;
          const fresh = !(t in prevN) ? !(cut && t > cut) && !prevOwnDays.has(dayOf(t)) : (!legacy && !prevOwn.includes(t) && g.n[t] > prevN[t]);
          if (fresh) neu[t] = today; else if (pNeu[t] && young(pNeu[t])) neu[t] = pNeu[t]; } // eine Änderung bleibt 7 Tage stehen, damit sie nicht untergeht
        for (const t of prevOwn) if (!expired(t) && !ownDays.has(dayOf(t)) && (!(t in g.n) || (!legacy && !ownSet.has(t) && g.n[t] < prevN[t]))) weg[t] = today;
        for (const [t, s] of Object.entries(pWeg)) if (!(t in weg) && young(s) && !expired(t) && !ownDays.has(dayOf(t))) weg[t] = s;
      }
      WATCH.seiten[u] = { d: g.n, l: g.len, ...(own.length !== g.dates.length ? { o: own } : {}), ...(attR ? { s: attR.mode } : {}), ...(Object.keys(neu).length ? { neu } : {}), ...(Object.keys(weg).length ? { weg } : {}) };
      if (!Object.keys(neu).length && !Object.keys(weg).length) continue;
      // Was davon ist zu tun? Neu: nur Tage, die für den Markt noch fehlen. Verschwunden: nur Tage, die noch im Kalender stehen.
      const kd = ms.map(knownDays), cov = (mi, d) => kd[mi].has(key(d)) || (d > END && (ms[mi].rules || []).some(r => ruleHits(r, d)));
      const openFor = t => { const d = tokDate(t); if (!d) return null; return att ? att[t].filter(mi => !cov(mi, d)) : ms.some((_, mi) => cov(mi, d)) ? [] : ms.map((_, mi) => mi); };
      const live = d => ms.some(m => [...m.events, ...(m.later || [])].some(x => x.k === key(d) && !x.cancelled));
      const show = t => { const d = tokDate(t); return d ? deDate(d) : t.replace(/\.$/, ""); };
      const neuL = Object.keys(neu).filter(t => { const o = openFor(t); return !o || o.length; });
      const wegL = Object.keys(weg).filter(t => { const d = tokDate(t); return d && d > TODAY && live(d); });
      // fertige Zeilen für das Blatt Termine: neue, künftige Tage am üblichen Wochentag des Markts (oder an einem Feiertag)
      // (üblicher Wochentag: aus den bekannten Terminen ohne Feiertage und aus den Serien; ohne solche Angaben gilt jeder Wochentag)
      const dows = ms.map(m => new Set([...[...m.events, ...(m.later || []), ...(ROW_DAYS[m.slug] || [])].filter(e => !HOLI[e.k]).map(e => (e.date || e.d).getUTCDay()), ...(m.rules || []).map(r => r.wd)]));
      for (const t of neuL) { const d = tokDate(t); if (!d || d <= TODAY || d > addDays(TODAY, 400)) continue; const k = key(d);
        const cand = openFor(t).filter(mi => !dows[mi].size || dows[mi].has(d.getUTCDay()) || HOLI[k]); if (!cand.length) continue;
        const who = cand.length === 1 ? ms[cand[0]].slug : "BITTE WÄHLEN: " + cand.map(mi => ms[mi].slug).join(" oder ");
        if (seenRow.has(who + k)) continue; seenRow.add(who + k);
        const cm = cand.map(mi => ms[mi]), evs = cm.flatMap(m => m.events.filter(x => !x.cancelled)), rows = cm.flatMap(m => ROW_DAYS[m.slug] || []);
        WATCH_ROWS.push({ k, row: [who, deDate(d), mostOf([...evs.map(x => x.start), ...rows.map(r => r.start)]), mostOf([...evs.map(x => x.end), ...rows.map(r => r.end)]), "Findet statt", ""], src: u }); }
      if (!neuL.length && !wegL.length) continue;
      const at = t => { const d = tokDate(t); return d ? d.getTime() : 0; }, fmtL = l => { const a = [...new Set([...l].sort((x, y) => at(x) - at(y)).map(show))]; return a.slice(0, 12).join(", ") + (a.length > 12 ? " …" : ""); };
      // auf Sammelseiten nur die Märkte nennen, um die es geht
      const rel = att ? [...new Set([...neuL.flatMap(t => openFor(t) || []), ...wegL.flatMap(t => { const k = key(tokDate(t)); return ms.map((m, mi) => [...m.events, ...(m.later || [])].some(x => x.k === k && !x.cancelled) ? mi : -1).filter(mi => mi >= 0); })])].sort((x, y) => x - y) : [];
      warn("Termin-Wächter", `${rel.length ? listNamesPlain(rel.map(mi => ms[mi].name)) : names}: ${neuL.length ? `Neu auf der Website des Veranstalters und noch nicht in der Tabelle: ${fmtL(neuL)}. ` : ""}${wegL.length ? `Achtung: ${fmtL(wegL)} ${new Set(wegL.map(show)).size === 1 ? "steht" : "stehen"} noch im Kalender, ${new Set(wegL.map(show)).size === 1 ? "ist" : "sind"} auf der Website des Veranstalters aber nicht mehr zu finden. Prüfen, ob der Termin ausfällt. ` : ""}Bitte prüfen: ${u}`);
    } catch (e) { kaputt++; WATCH.seiten[u] = got[u] && got[u].n ? { d: got[u].n, l: got[u].len } : {}; } } // diese eine Seite neu merken, die anderen laufen weiter
    if (kaputt) warn("Termin-Wächter", `Bei ${kaputt === 1 ? "einer Veranstalterseite" : kaputt + " Veranstalterseiten"} konnte der Termin-Wächter den Stand nicht vergleichen und hat ihn neu gemerkt. Das ist einmalig in Ordnung.`, true);
    WATCH.stand = today;
    } catch (e) {
      WATCH.seiten = old; WATCH_ROWS.length = 0;
      for (let i = warnings.length - 1; i >= 0; i--) if (warnings[i][0] === "Termin-Wächter") { warnSeen.delete(warnings[i][0] + "|" + warnings[i][1]); warnings.splice(i, 1); }
      warn("Termin-Wächter", `Der Termin-Wächter ist in dieser Nacht auf einen Fehler gestoßen und wurde übersprungen (${String(e && e.message || e).slice(0, 160)}). Die Website wurde trotzdem gebaut, der Stand der letzten Nacht bleibt erhalten. Tritt das mehrere Nächte in Folge auf, bitte melden.`);
    }
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
// Merken: Herz-Knopf. Die Merkliste liegt nur im Browser (Local Storage), erst nach dem ersten Tippen. Ohne JavaScript bleibt der Knopf versteckt.
const favBtn = (m, cls = "fav") => `<button type="button" class="${cls}" data-fav="${m.slug}" data-name="${esc(m.short || m.name)}" aria-pressed="false" aria-label="${esc(m.name)} merken" hidden>${ic("heart", "i ho")}${ic("heartfill", "i hf")}${cls === "fav" ? "" : '<span class="fav-l">Merken</span>'}</button>`;
// Kalender: „Alle Termine abonnieren“ (aktualisiert sich von selbst) und „Nur den nächsten Termin“
const HOST = new URL(SITE).host;
const calOk = m => [...m.events, ...(m.later || [])].some(e => !e.cancelled && e.k >= key(TODAY));
const calDD = (m, first) => { if (!calOk(m)) return ""; const n = [...m.events, ...(m.later || [])].find(e => !e.cancelled && e.k >= key(TODAY)), web = `webcal://${HOST}/kalender/${m.slug}.ics`;
  return `<details class="cal-dd"><summary class="route">${ic("cal")}In meinen Kalender${ic("chev", "i cal-chev")}</summary><div class="cal-pop">
<a href="${web}" data-gcal="https://calendar.google.com/calendar/render?cid=${encodeURIComponent(web)}">${ic("repeat")}<span><b>Alle Termine abonnieren</b><small>Neue Termine kommen von selbst dazu, Änderungen auch.</small></span></a>
<a href="/kalender/${m.slug}-naechster.ics" download>${ic("clock")}<span><b>Nur den nächsten Termin</b><small>${esc(WDL[n.date.getUTCDay()])}, ${fmtDate(n.date).replace(/^\S+ /, "")}${n.start ? ", " + esc(timeText(n)) : ""}</small></span></a>
<a class="cal-file" href="/kalender/${m.slug}.ics" download>Alle Termine als Datei herunterladen (.ics)</a></div></details>`; };
const icsEsc = t => String(t || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const icsFold = l => { const out = []; let cur = "", len = 0; for (const ch of l) { const b = Buffer.byteLength(ch); if (len + b > 74) { out.push(cur); cur = " "; len = 1; } cur += ch; len += b; } out.push(cur); return out.join("\r\n"); };
const ICS_TZ = ["BEGIN:VTIMEZONE", "TZID:Europe/Berlin", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT", "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"];
function icsOf(m, evs, name) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""), url = `${SITE}/flohmarkt/${m.slug}/`;
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${NAME}//Flohmarktkalender//DE`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEsc(name)}`, "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:P1D", "X-PUBLISHED-TTL:P1D", ...ICS_TZ];
  for (const e of evs) {
    const d = e.k.replace(/-/g, ""), hm = t => t.replace(":", "") + "00";
    L.push("BEGIN:VEVENT", `UID:${m.slug}-${e.k}@${HOST}`, `DTSTAMP:${stamp}`);
    if (e.start) { L.push(`DTSTART;TZID=Europe/Berlin:${d}T${hm(tFirst(e.start))}`); L.push(`DTEND;TZID=Europe/Berlin:${d}T${hm(e.end ? tLast(e.end) : String(Math.min(23, +tFirst(e.start).slice(0, 2) + 4)).padStart(2, "0") + tFirst(e.start).slice(2))}`); }
    else { const n = key(addDays(e.date, 1)).replace(/-/g, ""); L.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n}`); }
    L.push(`SUMMARY:${icsEsc((e.cancelled ? "Abgesagt: " : "") + m.name)}`, `LOCATION:${icsEsc(m.addr || m.area)}`,
      `DESCRIPTION:${icsEsc(`${e.cancelled ? "Dieser Termin fällt laut Veranstalter aus. " : ""}${e.start && /\//.test(e.start + (e.end || "")) ? "Uhrzeit noch nicht ganz sicher. " : ""}${e.note ? e.note.replace(/([^.!?])$/, "$1.") + " " : ""}Angaben laut Veranstalter, ohne Gewähr. Alle Infos: ${url}`)}`, `URL:${url}`, `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  L.push("END:VCALENDAR"); return L.map(icsFold).join("\r\n") + "\r\n";
}
const shareBtn = (m, e, cls = "share") => `<button type="button" class="${cls}" data-share="${esc(shareText(m, e))}" aria-label="${esc(m.name)} teilen" hidden>${ic("share")}${cls === "share" ? "" : "Teilen"}</button>`;

/* ---------------------------------------------------------------- Startseite */
{
  const { sat, sun, sunOnly } = weekendDays();
  const weN = EVENTS.filter(e => !e.cancelled && (e.k === key(sat) || e.k === key(sun))).length;
  const weLabel = sunOnly ? `Termine heute, Sonntag ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()].slice(0, 3)}.` : `Termine am Wochenende ${sat.getUTCDate()}.–${sun.getUTCDate()}. ${MON[sun.getUTCMonth()].slice(0, 3)}.`;
  // Startseite: von heute bis zum kommenden Sonntag (sonntags bis zum nächsten Sonntag). Heute schon beendete Märkte blendet das Skript aus.
  const toSun = TODAY.getUTCDay() === 0 ? 7 : 7 - TODAY.getUTCDay(), next = upcoming(toSun + 1);
  // Sticker abends am Sonntag: Sind alle heutigen Märkte vorbei, zeigt das Skript den nächsten Markttag
  const tdE = EVENTS.filter(e => !e.cancelled && e.k === key(TODAY)), nk = [...new Set(EVENTS.filter(e => !e.cancelled && e.k > key(TODAY)).map(e => e.k))].sort()[0];
  let stAlt = "";
  if (sunOnly && tdE.length && tdE.every(e => e.end) && nk) {
    const nd = new Date(nk + "T00:00:00Z"), nn = EVENTS.filter(e => !e.cancelled && e.k === nk).length, mo = MONTHS.find(x => x.y === nd.getUTCFullYear() && x.mo === nd.getUTCMonth());
    const href = nk === key(addDays(TODAY, 1)) ? "/morgen/" : mo ? `/${mo.s}/#${dayId(nd)}` : "/termine/";
    stAlt = ` data-day="${key(TODAY)}" data-end="${tdE.map(e => tLast(e.end)).sort().pop()}" data-n="${nn}" data-l="${nn === 1 ? "Markt" : "Märkte"} am ${WDL[nd.getUTCDay()]}, ${nd.getUTCDate()}. ${MON[nd.getUTCMonth()].slice(0, 3)}." data-h="${href}"`;
  }
  const all14 = upcoming(14).length;
  // Startseite: höchstens sechs Karten bei „Die nächsten Flohmärkte“. Alle bis Sonntag stehen im Code, die übrigen tragen „cap“ (ausgeblendet).
  // Das Skript zählt neu, wenn heute schon beendete Märkte wegfallen, damit immer sechs zu sehen sind.
  const HOME_N = 6, homeList = () => { let i = 0; return groupList(next, 3).replace(/<article class="ev/g, m => i++ < HOME_N ? m : '<article class="ev cap'); };
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
  // Kasten „Aktuell“: Wetter, Tipp des Tages und Neues im Kalender als Reiter. Mit JavaScript blättert er alle paar Sekunden weiter,
  // ohne JavaScript stehen die Abschnitte untereinander.
  const NEWS_TABS = [];
  { const evs = upcoming(4), days = [...new Set(evs.filter(e => !e.cancelled).map(e => e.k))].sort();
    const whenOf = k => k === key(TODAY) ? "heute" : k === key(addDays(TODAY, 1)) ? "morgen" : "am " + WDL[new Date(k + "T00:00:00Z").getUTCDay()];
    const pageOf = k => k === key(TODAY) ? "/heute/" : k === key(addDays(TODAY, 1)) ? "/morgen/" : "/termine/";
    let wx = null;
    for (const k of days) { const list = evs.filter(e => e.k === k && !e.cancelled), w = wxDay(list); if (!w || w.lvl !== "wet") continue;
      const cov = list.filter(e => e.m.tags.includes("Überdacht")); if (!cov.length) continue;
      wx = { lab: "Wetter", icon: "umbrella", first: true, title: `${cap(whenOf(k))} wird es wohl nass.`, body: `${cov.length === 1 ? "Dieser Markt ist" : `Diese ${cov.length} Märkte sind`} überdacht: ${cov.slice(0, 5).map(e => `<a href="/flohmarkt/${e.m.slug}/">${esc(e.m.short)}</a>`).join(", ")}${cov.length > 5 ? " und weitere" : ""}.`, link: CAT_BY_S["hallenflohmarkt-hamburg"] ? ["/hallenflohmarkt-hamburg/", "Alle überdachten Märkte"] : null }; break; }
    if (!wx && days.length) { const k = days[0], list = evs.filter(e => e.k === k && !e.cancelled), w = wxDay(list);
      if (w) wx = { lab: "Wetter", icon: "frog", title: `Der Wetterfrosch sagt für ${whenOf(k)} ${w.noun} voraus.`, body: `${cap(whenOf(k))} ${list.length === 1 ? "hat ein Flohmarkt" : "haben " + list.length + " Flohmärkte"} geöffnet.`, link: [pageOf(k), "Zu den Terminen"] }; }
    if (wx && wx.first) NEWS_TABS.push(wx);
    // November bis März: Hinweis auf überdachte Märkte (wenn nicht schon der Regen-Hinweis dasteht)
    const winter = [10, 11, 0, 1, 2].includes(TODAY.getUTCMonth());
    const cov14 = [...new Set(upcoming(14, e => !e.cancelled && e.m.tags.includes("Überdacht")).map(e => e.m))];
    if (winter && !(wx && wx.first) && cov14.length && CAT_BY_S["hallenflohmarkt-hamburg"]) NEWS_TABS.push({ lab: "Drinnen", icon: "umbrella", title: "Im Winter wird drinnen getrödelt.", body: `${cov14.length === 1 ? "Ein überdachter Markt hat" : cov14.length + " überdachte Märkte haben"} in den nächsten zwei Wochen geöffnet, zum Beispiel ${cov14.slice(0, 3).map(m => `<a href="/flohmarkt/${m.slug}/">${esc(m.short)}</a>`).join(", ")}.`, link: ["/hallenflohmarkt-hamburg/", "Alle überdachten Märkte"] });
    if (tip) NEWS_TABS.push({ lab: "Tagestipp", icon: "star", title: `${tip[0]}: ${tip[1]}`, body: "Jede Nacht neu aus dem Kalender.", link: [tip[2], "Ansehen"] });
    const n60 = EVENTS.filter(e => !e.cancelled && (e.date - TODAY) / 864e5 < 60).length;
    NEWS_TABS.push(NEU_MS.length
      ? { lab: "Neu", icon: "update", title: `Neu im Kalender: ${NEU_MS.length === 1 ? "ein Markt" : NEU_MS.length + " Märkte"}`, body: `${NEU_MS.slice(0, 5).map(m => `<a href="/flohmarkt/${m.slug}/">${esc(m.short)}</a>`).join(", ")}${NEU_MS.length > 5 ? ` und ${NEU_MS.length - 5} weitere` : ""}. Der Kalender wächst ständig, schau gern wieder rein.`, link: null }
      : { lab: "Neu", icon: "update", title: "Der Kalender wächst ständig.", body: `Schon ${MARKETS.length} Märkte und ${n60} Termine in den nächsten 60 Tagen. Neue Märkte und Termine kommen laufend dazu, schau gern wieder rein.`, link: ["/flohmaerkte/", "Alle Märkte"] });
    if (wx && !wx.first) NEWS_TABS.push(wx); }
  const newsBox = !NEWS_TABS.length ? "" : `<section class="sec akt-sec" aria-labelledby="aktH"><div class="sec-head"><h2 id="aktH">Aktuell</h2></div><div class="akt" id="news">
<div class="akt-head js-only"><div class="akt-tabs" role="tablist" aria-label="Aktuell">${NEWS_TABS.map((t, i) => `<button type="button" role="tab" class="akt-tab" id="nt${i}" aria-controls="np${i}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ""}>${ic(t.icon)}<span>${t.lab}</span></button>`).join("")}</div>${NEWS_TABS.length > 1 ? `<button type="button" class="akt-pause" id="newsPause" aria-pressed="false" aria-label="Automatisches Weiterblättern anhalten">${ic("pause", "i np-pause")}${ic("play", "i np-play")}</button>` : ""}</div>
${NEWS_TABS.length > 1 ? '<div class="akt-bar js-only" aria-hidden="true"><i id="newsBar"></i></div>' : ""}
<div class="akt-panels" id="newsPanels">${NEWS_TABS.map((t, i) => `<div class="akt-p" role="tabpanel" id="np${i}" aria-labelledby="nt${i}">${ic(t.icon)}<div><b>${esc(t.title)}</b><p>${t.body}</p>${t.link ? `<a class="more-link" href="${t.link[0]}">${t.link[1]}${ic("chev")}</a>` : ""}</div></div>`).join("")}</div>
</div></section>`;
  // Slider: ein großes Symbolfoto, dazu bis zu zwei große Märkte der nächsten Tage als „Wochen-Highlight“.
  const hlEvs = []; for (const e of upcoming(8, e => !e.cancelled && e.m.tags.includes("Groß & bekannt"))) if (hlEvs.length < 2 && !hlEvs.some(x => x.m === e.m)) hlEvs.push(e);
  const sImg = pickImg("start"), sSmall = pickImg("start-klein"), sMini = pickImg("start-mini");
  const slides = [
    sImg ? `<figure class="hl-slide hl-photo"><img src="${imgUrl((sSmall || sImg).f)}" srcset="${[sMini && `${imgUrl(sMini.f)} 640w`, sSmall && `${imgUrl(sSmall.f)} 760w`, `${imgUrl(sImg.f)} 1520w`].filter(Boolean).join(", ")}" sizes="(max-width: 640px) 86vw, (max-width: 800px) 100vw, 760px" width="760" height="507" alt="${esc(altOf(sImg))}" fetchpriority="high" decoding="async"><figcaption>${capOf(sImg)}</figcaption></figure>` : "",
    ...hlEvs.map(e => `<a class="hl-slide hl-card" href="/flohmarkt/${e.m.slug}/" data-day="${e.k}"><span class="kicker">${ic("star")}Wochen-Highlight</span><b>${esc(e.m.short)}</b><span class="hl-when">${esc(fmtDate(e.date))}${e.start ? " · " + esc(timeText(e)) : ""}</span><span class="hl-where">${ic("pin")}${esc(e.m.area || e.m.place)}</span><span class="promo-go">Zum Markt${ic("chev")}</span></a>`)].filter(Boolean);
  const slider = slides.length ? `<section class="hl" aria-label="Highlights"><div class="hl-track" id="hlTrack">${slides.join("")}</div>${slides.length > 1 ? `<div class="hl-dots js-only" id="hlDots">${slides.map((_, i) => `<button type="button" aria-label="Bild ${i + 1} von ${slides.length}"${i ? "" : ' aria-current="true"'}></button>`).join("")}</div>` : ""}</section>` : "";
  // Laufband über der Startseite mit dem Instagram-Hinweis. Bei „Bewegung reduzieren“ steht es still.
  // Zweiter Weg auf der Startseite, gleich nach dem Wochen-Highlight: Schilder, Kauf-Check und Ratgeber als drei Kacheln.
  const helpers = () => `<section class="sec helpers" id="helfer" aria-labelledby="helferH"><span class="kicker">Auch außerhalb Hamburgs</span><h2 id="helferH">Gut vorbereitet auf jeden Flohmarkt</h2><p class="hp-intro">Fürs Verkaufen und fürs Kaufen. Kostenlos und ohne Anmeldung.</p>
<div class="hp-grid">${TOOLS().map(([k, h, i, b, x]) => `<a class="hp-tile hp-${k}" href="${h}"><span class="hp-ic">${ic(i)}</span><span class="hp-t"><b>${b}</b><span>${esc(x)}</span></span>${ic("chev")}</a>`).join("")}</div></section>`;
  // Große Bühne „Für jeden Flohmarkt“ mit echten Inhalten (Schilder, Kauf-Check zum Antippen, Ratgeber-Fragen).
  // Seit 17.10. nicht mehr auf der Startseite (dort stehen die drei Kacheln oben), seit 18.10. auf der Seite /start/ für alle außerhalb Hamburgs.
  // Kauf-Check-Artikel und Ratgeber-Frage wechseln jede Woche, bei Regen in den nächsten Tagen kommt die Regen-Frage nach vorn.
  // head: false lässt den eigenen Kopf weg (die Seite hat schon eine Überschrift). toolsStage.picks: die drei gezeigten Ratgeber-Fragen.
  const toolsNum = () => `<p class="tools-num">${KC_ON ? `<span><b>${KC.length}</b>Kauf-Checks</span>` : ""}<span><b>${KB.length}</b>Ratgeber-Artikel</span><span><b>%%SIGN_N%%</b>Schilder-Vorlagen</span></p>`;
  const toolsStage = ({ head = true } = {}) => {
    const wk = Math.floor((TODAY.getTime() / 864e5 + 3) / 7), hh = a => /hamburg/i.test(`${a.h} ${a.t}`);
    const kcOk = i => i && i.n.length <= 24 && i.e.filter(x => x.l && !x.tip).length >= 3;
    const kcPool = ["levis-jeans", "iphone", "lego-minifiguren", "adidas-samba", "airpods", "meissen", "barbour", "carhartt", "apple-watch", "gameboy-spiele", "fussballtrikots", "analogkameras"].map(s => KC.find(i => i.s === s)).filter(kcOk);
    const kcI = KC_ON ? (kcPool.length ? kcPool[wk % kcPool.length] : KC.find(kcOk)) : null;
    const kbPool = ["wechselgeld-flohmarkt", "handeln-auf-dem-flohmarkt", "beste-uhrzeit-flohmarkt", "preise-festlegen-flohmarkt", "was-verkauft-sich-gut-flohmarkt", "was-mitnehmen-flohmarkt", "bezahlen-auf-dem-flohmarkt", "standgebuehr-flohmarkt", "flohmarkt-knigge"].map(s => KBY[s]).filter(a => a && !hh(a));
    const evs4 = upcoming(4), wet = [...new Set(evs4.filter(e => !e.cancelled).map(e => e.k))].some(k => { const w = wxDay(evs4.filter(e => e.k === k && !e.cancelled)); return w && w.lvl === "wet"; });
    const rot = kbPool.length ? [...kbPool.slice(wk % kbPool.length), ...kbPool.slice(0, wk % kbPool.length)] : KB.filter(a => !hh(a));
    const kbPick = [...(wet && KBY["flohmarkt-bei-regen"] ? [KBY["flohmarkt-bei-regen"]] : []), ...rot].filter((a, i, l) => l.indexOf(a) === i).slice(0, 3);
    const first = kbPick[0], short = first ? plain(first.a).split(/(?<=[.!?])\s/)[0] : ""; toolsStage.picks = kbPick;
    const hx = head ? "h3" : "h2"; // ohne eigenen Kopf sind die drei Titel die Zwischenüberschriften der Seite
    // Jede Karte passt am Handy auf einen Bildschirm: Dachzeile, Überschrift, ein Satz, Bild, ein Knopf (seit 18.10. ohne Vorteils-Pillen und Nebenlinks).
    // Farbcode wie auf der Startseite: Schilder gelb, Kauf-Check dunkel, Ratgeber hell; dazu das Symbol des Werkzeugs in der Dachzeile.
    const sv = s => `%%SIGNIMG:${s}%%`; // Vorschaubild der Vorlage, wird nach dem Abschnitt „Schilder“ eingesetzt (signImg)
    return `<section class="sec st-sec"${head ? ' aria-labelledby="toolsH"' : ' aria-label="Für jeden Flohmarkt"'}>${head ? `<div class="tools-head"><span class="kicker">Auch außerhalb Hamburgs</span><h2 id="toolsH">Für jeden Flohmarkt</h2><p>Drei Werkzeuge, die überall helfen. Kostenlos und ohne Anmeldung.</p>
${toolsNum()}</div>` : ""}
<div class="stage st-yellow" id="schilder"><div class="st-txt"><span class="kicker">${ic("printer")}Schilder-Designer</span><${hx}>Dein Stand, gut beschildert.</${hx}><p>Preisschilder, „Alles 1 €“ oder Bar &amp; PayPal mit QR-Code. Gratis drucken.</p></div>
<div class="st-vis"><a class="st-signs" href="/flohmarkt-schilder/" tabindex="-1" aria-hidden="true"><img src="${sv("bar-und-paypal")}" width="297" height="210" alt="" loading="lazy" decoding="async"><img src="${sv("alles-1-euro")}" width="297" height="210" alt="" loading="lazy" decoding="async"></a></div>
<div class="st-go"><a class="btn" href="/flohmarkt-schilder/">Schild gestalten${ic("chev")}</a></div></div>
${kcI ? `<div class="stage st-dark" id="kauf-check"><div class="st-txt"><span class="kicker">${ic("search")}Kauf-Check</span><${hx}>Echt oder Fälschung?</${hx}><p>Prüfpunkte für ${KC.length} Artikel, von Levi's bis LEGO. Am Stand antippen.</p></div>
<div class="st-vis"><fieldset class="st-check" data-kc><legend><small>Beispiel: ${esc(kcI.n)}</small>Was fällt dir auf?</legend>${kcI.e.filter(x => x.l && !x.tip).slice(0, 3).map(x => `<label><input type="checkbox"><i aria-hidden="true"></i>${esc(x.l)}</label>`).join("")}<small class="st-res" aria-live="polite">Tipp an, was dir auffällt</small></fieldset></div>
<div class="st-go"><a class="btn" href="${KC_P}">Artikel prüfen${ic("chev")}</a></div></div>` : ""}
${first ? `<div class="stage st-light" id="ratgeber"><div class="st-txt"><span class="kicker">${ic("book")}Ratgeber</span><${hx}>Antworten, bevor du fragst.</${hx}><p>${KB.length} Artikel, jeweils mit der kurzen Antwort vorweg.</p></div>
<div class="st-vis st-qs">${kbPick.slice(0, 2).map((a, n) => `<a href="/ratgeber/${a.s}/"${n ? "" : ' class="open"'}>${n ? "" : "<i>Kurz gesagt</i>"}<b>${esc(a.h)}</b>${n ? "" : `<span>${esc(short)}</span>`}</a>`).join("")}</div>
<div class="st-go"><a class="btn" href="/ratgeber/">Zum Ratgeber${ic("chev")}</a></div></div>` : ""}
</section>`;
  };
  // Antwort im ersten Bildschirm: Heute | Morgen | Wochenende mit den nächsten Märkten. Das Skript blendet heute schon beendete aus und wählt den passenden Reiter.
  const answerBox = () => {
    const tk = key(TODAY), mk = key(addDays(TODAY, 1)), wd = TODAY.getUTCDay();
    const evOf = ks => EVENTS.filter(e => !e.cancelled && ks.includes(e.k)).sort((a, b) => a.k.localeCompare(b.k) || (a.start || "99").localeCompare(b.start || "99"));
    const tabs = [["heute", "Heute", [tk], "/heute/"], ["morgen", "Morgen", [mk], "/morgen/"],
      ...(wd === 0 ? [] : [["wochenende", wd === 6 ? "Wochenende" : "Wochenende", [key(sat), key(sun)], "/wochenende/"]])].map(t => [...t, evOf(t[2])]).filter(t => t[4].length);
    if (!tabs.length) return "";
    const WDS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const li = (e, multi) => `<li data-day="${e.k}"${e.end ? ` data-e="${tLast(e.end)}"` : ""}><a href="/flohmarkt/${e.m.slug}/"><span class="ab-t">${multi ? `<small>${WDS[e.date.getUTCDay()]}</small>` : ""}${e.start ? tFirst(e.start).replace(/^0/, "") : "–"}</span><span class="ab-n"><b>${esc(e.m.short)}</b><small>${esc(e.m.area)}${e.end ? ` · bis ${hmText(tLast(e.end))} Uhr` : ""}</small></span>${ic("chev")}</a></li>`;
    return `<div class="ab" id="ab"><div class="ab-tabs" role="tablist" aria-label="Termine">${tabs.map(([id, l, , , ev], i) => `<button type="button" role="tab" id="abt-${id}" aria-controls="abp-${id}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ""}>${l}<span class="ab-c">${ev.length}</span></button>`).join("")}</div>
${tabs.map(([id, l, ks, href, ev], i) => `<div class="ab-p" role="tabpanel" id="abp-${id}" aria-labelledby="abt-${id}"${i ? " hidden" : ""}><ul>${ev.map(e => li(e, ks.length > 1)).join("")}</ul><a class="ab-all" href="${href}">Alle ${ev.length} Termine ${l === "Wochenende" ? "am Wochenende" : l.toLowerCase()}${ic("chev")}</a></div>`).join("")}</div>`;
  };
  // Neuigkeiten oben: eine Zeile, die alle paar Sekunden wechselt. Jede Meldung hat ihren eigenen Knopf.
  const tk = (h, t, cta, ext) => [h, t, cta, ext];
  const tickItems = INSTA ? [tk(INSTA, `${esc(NAME)} jetzt bei Insta`, "Folgen", true), ...(KC_ON ? [tk(KC_P, "Echt oder Fake? Kauf-Check", "Prüfen")] : []), tk("/flohmarkt-schilder/", "Schilder für deinen Stand", "Gestalten")] : [];
  const ticker = tickItems.length ? `<div class="ticker" role="region" aria-label="Neuigkeiten">${tickItems.map(([h, t, cta, ext], i) => `<a class="tk-item${i ? "" : " on"}" href="${h}"${ext ? ' rel="noopener me"' : ""}${i ? ' tabindex="-1" aria-hidden="true"' : ""}><i aria-hidden="true">+++</i><span>${t}</span><b class="tk-cta">${cta}${ic("chev")}</b></a>`).join("")}</div>` : "";
  const body = ticker + `<section class="hero"><div>
<span class="kicker hello">Willkommen bei ${esc(NAME)}</span>
<h1>Flohmarkt Hamburg: alle Termine, aufgeräumt.</h1>
<p class="hero-p">Alle Flohmärkte in Hamburg und Umgebung: wann, wo und wie lange. Ohne Werbebanner, ohne alte Termine.</p>
${sxForm(true)}
${answerBox()}
<div class="quick">${PLZ_ROWS.length ? `<a class="chip" href="/termine/#near">${ic("pin")}In meiner Nähe</a>` : ""}${HAS_MAP ? `<a class="chip" href="/flohmaerkte/#karte">${ic("map")}Karte</a>` : ""}<a class="chip" href="/entdecken/">${ic("heart")}Wischen &amp; merken</a></div>
</div><a class="big-sticker" id="bigSt" href="/wochenende/"${stAlt}><b>${weN}</b><span>${weLabel}</span></a></section>
${slider}
${helpers()}
${newsBox}
${DK_EVS.length ? `<section class="sec home-deck" id="dkSec"><div class="sec-head"><h2>Wischen &amp; merken</h2>${more("/merkliste/", "Merkliste")}</div><p class="dk-intro">Die Flohmärkte der nächsten vier Wochen: Daumen hoch merkt den Markt, Daumen runter zeigt den nächsten.</p>${deckHTML(true)}</section>` : ""}
<section class="sec home-next"><div class="sec-head"><h2>Die nächsten Flohmärkte</h2>${more("/termine/", "Alle")}</div>
${homeList() || '<div class="empty">Gerade stehen keine Termine im Kalender.</div>'}
${all14 > HOME_N ? `<a class="more" href="/termine/">Alle ${all14} Termine der nächsten 14 Tage</a>` : ""}</section>
<div class="sec band band-browse"><section class="sec hs-bez"><div class="sec-head"><h2>Flohmärkte nach Bezirk und Region</h2>${more("/flohmaerkte/", "Alle", "Alle Märkte")}</div>${regionChips()}</section>
${CATS_ON.length ? `<section class="sec hs-art"><div class="sec-head"><h2>Flohmärkte nach Art</h2></div>${catChips()}</section>` : ""}
${MONTHS.length ? `<section class="sec hs-mon"><div class="sec-head"><h2>Termine nach Monat</h2>${more("/termine/", "Alle")}</div>${monthChips()}</section>` : ""}</div>
${NEWS.length ? `<section class="sec hs-news"><div class="sec-head"><h2>Neuigkeiten</h2></div>${grid(NEWS.map(n => `<a class="card" href="${esc(safeHref(n["Link"], "Neuigkeiten: " + n["Titel"]) || "/")}"><span class="kicker">${esc(n["Kicker"])}</span><h3>${esc(n["Titel"])}</h3><p>${esc(n["Text"])}</p></a>`))}</section>` : ""}
<div class="sec band band-seo"><section class="sec kb-body home-seo"><h2>Flohmarkt in Hamburg: das Wichtigste</h2>${homeText.map(x => `<p>${rich(x)}</p>`).join("")}</section>
${faqBlock(homeFaq, "Häufige Fragen zu Flohmärkten in Hamburg")}</div>
${INSTA ? `<section class="sec hs-insta"><a class="follow" href="${INSTA}" rel="noopener me"><span class="follow-at" aria-hidden="true">@</span><span class="follow-txt"><span class="kicker">Neu auf Instagram</span><b>Jeden Donnerstag: dein Flohmarkt-Wochenende</b><span>Alle Märkte fürs Wochenende in drei Bildern. Zum Speichern und Weiterschicken.</span></span><span class="btn">${esc(INSTA_AT)} folgen${ic("chev")}</span></a></section>` : ""}
<section class="sec hs-org" id="veranstalter"><div class="org"><h2>Du veranstaltest einen Flohmarkt?</h2><p>Trag deinen Termin kostenlos ein. Wir prüfen jeden Eintrag, bevor er erscheint.</p><a class="btn" href="/veranstalter/">Termin eintragen${ic("chev")}</a></div></section>`;
  layout({ p: "/", title: `Flohmarkt Hamburg: Alle Flohmärkte & Termine ${YEAR} | ${NAME}`,
    desc: pickDesc(`Alle ${MARKETS.length} Flohmärkte in Hamburg und Umgebung mit Terminen, Uhrzeiten und Adressen.${weN ? ` ${sunOnly ? "Heute" : "Am Wochenende"}: ${weN} Märkte.` : ""} Täglich aktualisiert, ohne Werbung.`, "Alle Flohmärkte in Hamburg und Umgebung, aufgeräumt: Termine, Zeiten, Adressen und ein Ratgeber mit Antworten auf die wichtigsten Flohmarkt-Fragen."),
    body, nav: "", ld: G([{ "@type": "WebSite", "@id": SITE + "/#website", name: NAME, url: SITE + "/", inLanguage: "de", publisher: { "@id": SITE + "/#org" } }, { "@type": "Organization", "@id": SITE + "/#org", name: NAME, url: SITE + "/", logo: SITE + (HAS_ICONS ? "/assets/icon-512.png" : "/assets/icon.svg"), ...(INSTA ? { sameAs: [INSTA] } : {}) }, faqLD(homeFaq)]) });
  /* Seite für alle außerhalb Hamburgs: /flohmarkt-tipps/ (Kurzadresse für die Instagram-Bio: flohlotse.de/start, leitet hierher).
     Die drei Werkzeuge als Bühne mit ihren Vorteilen, darunter häufige Fragen und ein Abzweig für alle aus Hamburg.
     Für Google gedacht für allgemeine Suchen wie „Flohmarkt Tipps“; die Hamburg-Suchen bleiben bei den Hamburg-Seiten, „Flohmarkt Ratgeber“ beim Ratgeber. */
  {
    const stageHTML = toolsStage({ head: false }), shown = new Set((toolsStage.picks || []).map(a => a.s));
    const qPool = ["was-mitnehmen-flohmarkt", "preise-festlegen-flohmarkt", "handeln-auf-dem-flohmarkt", "wechselgeld-flohmarkt", "beste-uhrzeit-flohmarkt", "was-verkauft-sich-gut-flohmarkt", "bezahlen-auf-dem-flohmarkt", "flohmarkt-knigge", "flohmarkt-bei-regen", "standgebuehr-flohmarkt"]
      .map(s => KBY[s]).filter(a => a && !shown.has(a.s) && !/hamburg/i.test(`${a.h} ${a.t}`)).slice(0, 6);
    const jump = [["schilder", "printer", "Schilder", "%%SIGN_N%% Vorlagen", "sign"], ...(KC_ON ? [["kauf-check", "search", "Kauf-Check", `${KC.length} Artikel`, "kc"]] : []), ["ratgeber", "book", "Ratgeber", `${KB.length} Antworten`, "kb"]];
    // Abzweig für Hamburg: sonntags „heute“, sonst das Wochenende
    const hhN = sunOnly ? EVENTS.filter(e => !e.cancelled && e.k === key(sun)).length : weN;
    const hhGo = hhN ? (sunOnly ? [`${hhN} ${hhN === 1 ? "Markt" : "Märkte"} heute`, "/heute/"] : [`${hhN} ${hhN === 1 ? "Markt" : "Märkte"} am Wochenende`, "/wochenende/"]) : ["Flohmärkte am Wochenende", "/wochenende/"];
    const body = `<section class="lp-hero"><span class="kicker">Flohlotse · überall nützlich</span>
<h1>Für jeden Flohmarkt: Tipps, Schilder${KC_ON ? " und Kauf-Check" : ""}.</h1>
<p class="lp-lead">Gut vorbereitet, egal wo: Schilder drucken, Fälschungen erkennen, besser handeln. Kostenlos, ohne Anmeldung und ohne Werbung.</p>
<nav class="lp-jump" aria-label="Direkt zu">${jump.map(([id, i, t, n, k]) => `<a class="lp-j-${k}" href="#${id}"><span class="lp-ic">${ic(i)}</span><b>${t}</b><small>${n}</small></a>`).join("")}</nav>
<span class="big-sticker lp-sticker" aria-hidden="true"><b>0 €</b><span>ohne Anmeldung</span></span></section>
${stageHTML}
${qPool.length ? `<section class="sec lp-qs"><div class="sec-head"><h2>Häufige Fragen auf dem Flohmarkt</h2>${more("/ratgeber/", "Alle", "Alle Ratgeber-Artikel")}</div><div class="qlist">${qPool.map(a => `<a href="/ratgeber/${a.s}/"><span>${brColon(esc(a.h))}</span>${ic("chev")}</a>`).join("")}</div></section>` : ""}
<section class="sec lp-hh"><div class="org"><span class="kicker">Aus Hamburg oder Umgebung?</span><h2>Alle Flohmärkte, aufgeräumt.</h2><p>${MARKETS.length} Märkte in Hamburg und im Umland mit Terminen, Uhrzeiten und Adressen. Jede Nacht aktualisiert.</p><div class="lp-hh-go"><a class="btn" href="${hhGo[1]}">${hhGo[0]}${ic("chev")}</a><a class="lp-hh-all" href="/termine/">Alle Termine${ic("chev")}</a></div></div></section>`;
    const tools = [["Schilder-Designer", "/flohmarkt-schilder/"], ...(KC_ON ? [["Kauf-Check", KC_P]] : []), ["Flohmarkt-Ratgeber", "/ratgeber/"]];
    layout({ p: TIPS_P, title: `Flohmarkt-Tipps: Schilder, Fälschungen erkennen, Checklisten | ${NAME}`,
      desc: `Kostenlose Flohmarkt-Tipps für überall: Preisschilder zum Ausdrucken, Kauf-Check gegen Fälschungen und Checklisten fürs Kaufen und Verkaufen.`,
      body, nav: "", ld: G([{ "@type": "WebPage", "@id": SITE + TIPS_P, url: SITE + TIPS_P, name: "Flohmarkt-Tipps für jeden Flohmarkt", inLanguage: "de", isPartOf: { "@id": SITE + "/#website" } },
        { "@type": "ItemList", itemListElement: tools.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, url: SITE + u })) }]) });
  }
}

/* ---------------------------------------------------------------- Alle Termine */
{
  const evs = upcoming(60);
  const body = crumbs([[NAME, "/"], ["Termine"]]) + `<section class="hub-head"><h1>Flohmarkt-Termine in Hamburg und Umgebung</h1><p>Alle Termine der nächsten 60 Tage in Hamburg und im Umland bis 30 Kilometer, nach Tagen sortiert.</p>
<div class="chips js-only" id="filter" role="group" aria-label="Art des Markts"><button class="chip" type="button" data-t="" aria-pressed="true">Alle Arten</button>${[...TIME_TAGS, ...TAGS_ALL].map(t => `<button class="chip" type="button" data-t="${esc(t)}" aria-pressed="false">${tagIc(t)}${esc(t)}</button>`).join("")}</div>
<div class="tools">${nearBox()}${HAS_MAP ? `<div class="view-tog js-only" id="viewTog" role="group" aria-label="Ansicht"><button type="button" class="chip" data-v="liste" aria-pressed="true">${ic("list")}Liste</button><button type="button" class="chip" data-v="karte" aria-pressed="false">${ic("map")}Karte</button></div>` : ""}</div></section>
${dayStrip(evs)}<div id="liste">${groupList(evs, 2, true)}</div><div class="empty" id="leer" hidden>Keine Märkte dieser Art in den nächsten 60 Tagen.</div>
${HAS_MAP ? `<section class="map-sec" id="karte" hidden><div class="map-box" id="mapBox"><div class="map-consent"><p><b>Karte laden?</b> Die Karte zeigt alle Märkte mit Terminen in den nächsten 60 Tagen, mit Kartenbildern von OpenStreetMap. Erst beim Laden wird deine IP-Adresse an die OpenStreetMap Foundation übertragen. Mehr dazu in den <a href="/datenschutz/">Datenschutzhinweisen</a>.</p><button class="btn" id="mapLoad" type="button">${ic("map")}Karte laden</button></div></div></section>
<script type="application/json" id="mapData">${JSON.stringify([...new Set(evs.filter(e => !e.cancelled).map(e => e.m))].filter(m => m.ll).map(m => { const n = nextEv(m); return [m.name, m.slug, m.area, m.ll[0], m.ll[1], n ? fmtShortY(n) + (n.start ? ", " + timeText(n) : "") : "", m.rhythm]; })).replace(/</g, "\\u003c")}</script>` : ""}
${MONTHS.length ? `<section class="related"><div class="sec-head"><h2>Termine nach Monat</h2></div>${monthChips()}</section>` : ""}
<section class="related"><div class="sec-head"><h2>Nach Art des Markts</h2></div>${catChips()}</section>
<section class="related"><div class="sec-head"><h2>Nach Bezirk und Zeitraum</h2></div>${regionChips("/termine/")}</section>`;
  layout({ p: "/termine/", title: `Flohmarkt Hamburg Termine ${yearSpan(evs)}: die nächsten 60 Tage | ${NAME}`,
    desc: pickDesc(`Alle ${evs.filter(e => !e.cancelled).length} Flohmarkttermine in Hamburg und Umgebung für die nächsten 60 Tage: ${new Set(evs.map(e => e.m)).size} Märkte mit Uhrzeit, Adresse und Veranstalter.`, "Alle Flohmarkt-Termine in Hamburg und im Umland bis 30 Kilometer für die nächsten 60 Tage, mit Uhrzeiten, Adressen und Veranstaltern."), body, nav: "termine", ld: G([crumbLD([[NAME, "/"], ["Termine"]])].concat(evs.slice(0, 60).map(eventLD))) });
}

/* ---------------------------------------------------------------- Wischen & merken, Merkliste
   Die Merkliste liegt nur im Browser (Local Storage) und wird erst angelegt, wenn jemand auf ein Herz tippt.
   Beide Seiten sind persönlich bzw. tagesaktuell und deshalb nicht für Google bestimmt (noindex, nicht in der Sitemap). */
{
  const body = crumbs([[NAME, "/"], ["Wischen & merken"]]) + `<section class="hub-head dk-head"><h1>Wischen und merken: Flohmärkte der nächsten vier Wochen</h1><p>Daumen hoch oder nach rechts wischen: Der Markt kommt auf deine Merkliste. Daumen runter oder nach links: weiter zum nächsten.</p></section>
${deckHTML(false)}`;
  layout({ p: "/entdecken/", title: `Wischen und merken: Flohmärkte der nächsten Wochen | ${NAME}`, desc: "Die Flohmärkte der nächsten vier Wochen in Hamburg und Umgebung zum Durchwischen: nach rechts merken, nach links weiter.", body, noindex: true, nav: "entdecken" });
}
{
  const body = crumbs([[NAME, "/"], ["Merkliste"]]) + `<section class="hub-head"><h1>Deine Merkliste</h1><p>Hier stehen die Märkte, die du mit dem Herz gemerkt hast, mit ihren nächsten Terminen.</p></section>
<noscript><div class="empty">Die Merkliste braucht JavaScript. Bitte schalte es in deinem Browser ein.</div></noscript>
<div class="tour-wrap js-only" id="tour" hidden></div><div class="merk js-only" id="merk" data-src="/assets/maerkte.json?v=${key(TODAY)}"><p class="meta">Merkliste wird geladen …</p></div>
<p class="merk-msg" id="merkMsg" role="status" aria-live="polite"></p>
<section class="sec merk-tools" id="merkTools" hidden><h2>Merkliste sichern</h2><p>Mit dem Link kommt deine Merkliste auch auf ein anderes Gerät: einfach dir selbst schicken und dort öffnen.</p><div class="share-row"><button type="button" class="btn" id="merkLink">${ic("share")}<span>Als Link sichern</span></button><button type="button" class="btn" id="merkClear">${ic("x")}<span>Merkliste leeren</span></button></div></section>
<section class="sec kb-body"><h2>Wo ist meine Merkliste gespeichert?</h2><p>Nur auf diesem Gerät, in deinem Browser. Sie wird nicht an uns übertragen, und es gibt kein Konto. Auf einem anderen Handy oder in einem anderen Browser ist sie deshalb leer.</p><p>Löschst du die Browserdaten, ist auch die Merkliste weg. Safari auf iPhone und iPad löscht solche Daten außerdem, wenn du die Seite längere Zeit nicht öffnest. Sicher gehst du mit „Als Link sichern“, oder du legst ${esc(NAME)} auf deinen Home-Bildschirm.</p></section>`;
  layout({ p: "/merkliste/", title: `Merkliste | ${NAME}`, desc: "Deine gemerkten Flohmärkte mit den nächsten Terminen. Die Merkliste bleibt auf deinem Gerät.", body, noindex: true, nav: "merk" });
}
// Daten für Merkliste und Suche: je Markt
// 0 Name, 1 Stadtteil, 2 Rhythmus, 3 die nächsten vier Termine (Merkliste), 4 alle bekannten künftigen Termine [Tag, Uhrzeit oder „fällt aus“, Hinweis],
// 5 Veranstalter, 6 Bezirk oder Region, 7 Kurzname, 8 Ort (Platz), 9 Adresse, 10 Arten. Dazu mo: Monatsseiten für die Sprungmarken.
const MERK_JSON = JSON.stringify({ stand: key(TODAY), bis: key(END), m: Object.fromEntries(MARKETS.map(m => { const seen = new Set();
  const all = [...m.events, ...(m.later || [])].filter(e => e.k >= key(TODAY) && !seen.has(e.k) && seen.add(e.k)).sort((a, b) => a.k.localeCompare(b.k)).map(e => { const x = [e.k, e.cancelled ? "fällt aus" : e.start ? timeText(e) : ""]; if (e.note) x.push(e.note); return x; });
  // Für die Tour (Merkliste): [11] Koordinaten, [12] Öffnungszeit je Tag (bei Spannen wie „14:00/15:00“ die vorsichtige Zeit), [13] 1 = großer Markt (Parkplatzsuche), 2 = Umland
  const tz = {}; for (const e of [...m.events, ...(m.later || [])]) if (!e.cancelled && e.start && e.k >= key(TODAY)) tz[e.k] = [tLast(e.start), e.end ? tFirst(e.end) : ""];
  return [m.slug, [m.name, m.area, m.rhythm, all.slice(0, 4).map(x => x.slice(0, 2)), all, m.org || "", RBY[m.bez] ? RBY[m.bez].name : "", m.short !== m.name ? m.short : "", m.place !== m.name ? m.place : "", m.addr || "", m.tags, m.ll ? [+m.ll[0].toFixed(5), +m.ll[1].toFixed(5)] : 0, tz, (m.tags.includes("Groß & bekannt") ? 1 : 0) + ((RBY[m.bez] || {}).umland ? 2 : 0)]]; })),
  mo: Object.fromEntries(MONTHS.map(x => [`${x.y}-${pad(x.mo + 1)}`, `/${x.s}/`])) });

/* ---------------------------------------------------------------- Suche
   Nach Name, Stadtteil, Veranstalter oder Datum. Läuft im Browser mit den Daten aus /assets/maerkte.json, es wird nichts übertragen.
   Ohne JavaScript bleibt die Liste aller Märkte von A bis Z. Die Seite ist ein Werkzeug und nicht für Google bestimmt. */
{
  const az = [...MARKETS].sort((a, b) => a.name.localeCompare(b.name, "de"));
  const azList = az.map(m => { const n = nextEv(m); return `<a href="/flohmarkt/${m.slug}/"><span>${esc(m.name)}<small class="meta">${esc(m.area)}${n ? ` · nächster Termin ${fmtShortY(n)}` : " · zurzeit kein Termin bekannt"}</small></span>${ic("chev")}</a>`; }).join("");
  const body = crumbs([[NAME, "/"], ["Suchen"]]) + `<section class="hub-head sx-head"><h1>Flohmarkt suchen</h1><p>Nach Name, Stadtteil oder Datum, zum Beispiel „Goldbek“, „Altona“ oder „24.10.“</p>
${sxForm()}
<div class="chips sx-days js-only" id="sxDays" aria-label="Tag wählen"><button type="button" class="chip" data-d="0">${ic("sun")}Heute</button><button type="button" class="chip" data-d="1">${ic("cal")}Morgen</button><button type="button" class="chip" data-d="sa">${ic("cal")}Samstag</button><button type="button" class="chip" data-d="so">${ic("cal")}Sonntag</button><label class="chip sx-pick">${ic("cal")}<span>Datum wählen</span><input type="date" id="sxDate" min="${key(TODAY)}" max="${key(addDays(TODAY, 400))}" aria-label="Datum wählen"></label></div></section>
<p class="sx-msg" id="sxMsg" role="status" aria-live="polite"></p>
<div class="sx-out js-only" id="sxOut" data-src="/assets/maerkte.json?v=${key(TODAY)}" data-tools="/assets/werkzeuge.json?v=${key(TODAY)}"></div>
<section class="sec sx-az" id="sxAz"><div class="sec-head"><h2>Alle Märkte A–Z</h2>${more("/flohmaerkte/", "Nach Bezirk")}</div><div class="qlist sx-azl">${azList}</div></section>
<section class="sec sx-tip" id="sxTip"><div class="sec-head"><h2>Nach Zeitraum stöbern</h2></div><div class="chips">${[["/heute/", "Heute", "sun"], ["/morgen/", "Morgen", "cal"], ["/wochenende/", "Wochenende", "cal"], [WEEK_P, "Unter der Woche", "cal"], ["/termine/", "Alle Termine", "list"]].map(([h, l, i]) => `<a class="chip" href="${h}">${ic(i)}${l}</a>`).join("")}</div>${monthChips()}</section>`;
  layout({ p: "/suche/", title: `Flohmarkt suchen | ${NAME}`, desc: `Flohmarkt in Hamburg suchen: nach Name, Stadtteil oder Datum. ${MARKETS.length} Märkte mit allen bekannten Terminen.`, body, noindex: true, nav: "suche" });
}

/* ---------------------------------------------------------------- Alle Märkte */
{
  const body = crumbs([[NAME, "/"], ["Alle Märkte"]]) + `<section class="hub-head"><h1>Alle Flohmärkte in Hamburg und Umgebung</h1><p>${MARKETS.length} Märkte in Hamburg und im Umland bis 30 Kilometer, sortiert nach Bezirk und Region.</p>${catChips()}${nearBox("Märkte")}</section>
${HAS_MAP ? `<section class="map-sec js-only" id="karte"><div class="sec-head"><h2>Alle Märkte auf der Karte</h2></div><div class="map-box" id="mapBox"><div class="map-consent"><p><b>Karte laden?</b> Die Karte zeigt alle Märkte mit Kartenbildern von OpenStreetMap. Erst beim Laden wird deine IP-Adresse an die OpenStreetMap Foundation übertragen. Mehr dazu in den <a href="/datenschutz/">Datenschutzhinweisen</a>.</p><button class="btn" id="mapLoad" type="button">${ic("map")}Karte laden</button></div></div>
<script type="application/json" id="mapData">${JSON.stringify(MARKETS.filter(m => m.ll).map(m => { const n = nextEv(m); return [m.name, m.slug, m.area, m.ll[0], m.ll[1], n ? fmtShortY(n) + (n.start ? ", " + timeText(n) : "") : "", m.rhythm]; })).replace(/</g, "\\u003c")}</script>
<p class="small meta">Die Punkte zeigen die ungefähre Lage. Die genaue Adresse steht auf der Seite des Markts.</p></section>` : ""}
${REGIONS.map(r => { const ms = MARKETS.filter(m => m.bez === r.k); return ms.length ? `<section class="cluster"><div class="sec-head"><h2>${esc(r.name)}</h2>${more(`/flohmarkt-hamburg/${r.k}/`, r.umland ? "Zur Region" : "Zum Bezirk", "Seite " + r.name)}</div><div class="qlist">${ms.map(m => `<a href="/flohmarkt/${m.slug}/"${llAttr(m)}><span>${esc(m.name)}<small class="meta">${esc(m.area)} · ${esc(m.rhythm)}</small></span>${ic("chev")}</a>`).join("")}</div></section>` : ""; }).join("")}`;
  layout({ p: "/flohmaerkte/", title: `Flohmärkte in Hamburg und Umgebung: alle ${MARKETS.length} Märkte | ${NAME}`, desc: `Alle ${MARKETS.length} Flohmärkte in Hamburg und im Umland bis 30 Kilometer auf einen Blick, sortiert nach Bezirk und Region, mit Rhythmus und Terminen.`, body, nav: "maerkte", ld: G([crumbLD([[NAME, "/"], ["Alle Märkte"]]), { "@type": "ItemList", itemListElement: MARKETS.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name, url: `${SITE}/flohmarkt/${m.slug}/` })) }]) });
}

// Texte im Blatt Märkte mit vergangenem Datum melden (sichtbare Texte veralten sonst unbemerkt). Die SEO-Beschreibung mit Datum
// nutzt der Bau ohnehin nicht, dort steht automatisch der nächste Termin aus dem Blatt Termine.
for (const m of MARKETS) {
  const cols = [["Einleitung", m.intro], ["Kurzbeschreibung", m.note], ["Hinweis", m.hint], ["Tipps", m.tips.join(" ")], ["Rhythmus im Satz", m.when], ["Anmeldung Hinweis", m.signupHint], ["SEO-Beschreibung", m.d]]
    .map(([c, t]) => [c, pastDates(t)]).filter(([, d]) => d.length);
  if (cols.length) warn("Märkte", `„${m.name}“: vergangenes Datum in ${cols.map(([c, d]) => `${c} (${d.slice(0, 3).join(", ")})`).join(", ")}. Bitte im Blatt Märkte anpassen, am besten ohne festes Datum, die Termine kommen aus dem Blatt Termine.`, true);
}
/* ---------------------------------------------------------------- Marktseiten */
// Entfernung zwischen zwei Märkten in km (Luftlinie). Die Lage stammt aus „Koordinaten“ oder der Postleitzahl, ist also ungefähr.
const kmOf = (a, b) => { const t = x => x * Math.PI / 180, h = Math.sin(t(b[0] - a[0]) / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(t(b[1] - a[1]) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const street = m => String(m.addr || "").split(",")[0].trim().toLowerCase();
// „In der Nähe“ auf jeder Marktseite: die nächstgelegenen Märkte mit Termin, dazu Märkte am selben Ort. Jede Seite bekommt so ihre eigene Auswahl
// statt derselben langen Liste aller Märkte im Bezirk (Google wertet viele gleiche Blöcke als fast doppelte Seiten).
function nearOf(m, n = 6) {
  if (!m.ll) return [];
  const all = MARKETS.filter(x => x !== m && x.ll).map(x => ({ x, km: kmOf(m.ll, x.ll), same: street(x) === street(m) && kmOf(m.ll, x.ll) < 1 })).sort((a, b) => (b.same - a.same) || a.km - b.km);
  const same = all.filter(o => o.same).slice(0, 3);
  const dated = all.filter(o => !o.same && nextEv(o.x) && o.km <= 25).slice(0, Math.max(0, n - same.length));
  return [...same, ...dated];
}
const nearCard = ({ x, km, same }) => { const nv = nextEv(x); return `<a class="card" href="/flohmarkt/${x.slug}/"><span class="kicker">${same ? "Am selben Ort" : km < 1 ? "Unter 1 km entfernt" : `Ca. ${Math.round(km)} km entfernt`} · ${esc(x.area)}${neuPill(x)}</span><h3>${esc(x.name)}</h3><p class="ln">${ic("repeat")}<span>${esc(x.rhythm)}</span></p>${nv ? `<p class="ln" data-day="${nv.k}">${ic("cal")}<span>Nächster Termin ${fmtShortY(nv)}</span></p>` : ""}</a>`; };
for (const m of MARKETS) {
  const r = RBY[m.bez] || { name: m.bez, im: "", umland: false, k: m.bez };
  const nx = m.events.slice(0, 8), first = m.events.find(e => !e.cancelled);
  const route = "https://www.google.com/maps/dir/?api=1&amp;travelmode=transit&amp;destination=" + encodeURIComponent(m.name + ", " + m.addr);
  const others = MARKETS.filter(x => x.bez === m.bez && x !== m);
  const singleDates = !m.when && m.events.filter(e => !e.cancelled).length === 1;
  const when = whenOf(m);
  const far = !first && m.later ? m.later[0] : null;
  // Liste „Nächste Termine“: zuerst die Termine im Vorschau-Zeitraum, dann spätere, die schon in der Tabelle stehen
  const nxAll = [...nx, ...(m.later || []).slice(0, Math.max(0, 8 - nx.length))];
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
    ...(first ? [[`Wann findet ${nom} das nächste Mal statt?`, `Der nächste Termin ist am ${tNext}.${m.events.filter(e => !e.cancelled).length > 1 ? " Alle weiteren Termine stehen oben unter „Nächste Termine“." : ""}`]] : far ? [[`Wann findet ${nom} wieder statt?`, `Der nächste bekannte Termin ist am ${fmtDateY(far.date)}${far.start ? ", " + timeText(far) : ""}.${m.later.length > 1 ? " Weitere Termine stehen oben unter „Nächste Termine“." : ""}`]] : [[`Wann findet ${nom} wieder statt?`, "Derzeit ist kein Termin angekündigt. Sobald der Veranstalter neue Termine veröffentlicht, stehen sie hier."]]),
    ...(first && first.start && !mixed ? [[`Wie lange hat ${nom} geöffnet?`, `${first.end ? `Von ${hmText(first.start)} bis ${hmText(first.end)} Uhr` : `Ab ${hmText(first.start)} Uhr`}, so steht es beim nächsten Termin. Wer früh kommt, hat die größte Auswahl.`]] : []),
    [`Wo findet ${nom} statt?`, `${m.place !== m.name && !m.addr.toLowerCase().startsWith(m.place.toLowerCase()) ? m.place + ", " : ""}${m.addr}${m.oepnv ? `. Nächste Haltestelle: ${m.oepnv}` : ""}.`],
    ...(m.entry ? [[`Kostet ${nom} Eintritt?`, priceOf(m.entry) === 0 ? "Nein, der Eintritt ist frei." : priceOf(m.entry) !== null ? `Ja, der Eintritt kostet ${entryText(m)}.` : `${cap(m.entry)}.`.replace(/\.\.$/, ".")]] : []),
    ...(m.tags.includes("Überdacht") ? [[`Findet ${nom} auch bei Regen statt?`, `Der Markt ist ganz oder teilweise überdacht. Kurzfristige Absagen sind trotzdem möglich, schau am besten vorher beim Veranstalter nach.`]] : []),
    ...(m.park ? [[`Wo kann ich ${bei} parken?`, m.park]] : []),
    ...(m.food ? [[`Gibt es ${bei} etwas zu essen und zu trinken?`, m.food]] : []),
    [`Wie bekomme ich einen Stand ${bei}?`, `Standplätze vergibt der Veranstalter${m.org ? " " + m.org : ""}.${m.fee ? ` Standgebühr laut Veranstalter: ${m.fee.replace(/\.$/, "")}.` : ""}${m.signupHint ? " " + m.signupHint.replace(/([^.!?])$/, "$1.") : ""} ${m.signup ? `Zur Anmeldung: [Anmeldeseite des Veranstalters](${m.signup}).` : `Frag am besten dort nach, wie die Anmeldung läuft${m.web ? `: [Website des Veranstalters](${m.web})` : ""}.`} Tipps für deinen Stand stehen im Ratgeber ${KBY["flohmarktstand-anmelden"] ? "[Flohmarktstand anmelden](/ratgeber/flohmarktstand-anmelden/)" : "Verkaufen"}.`]
  ];
  const Ym = far ? String(far.date.getUTCFullYear()) : yearSpan(m.events.filter(e => !e.cancelled).slice(0, 1).length ? [first] : []);
  const baseT = m.t || `${m.name}: Termine & Öffnungszeiten`;
  const mTitle = (!first && !far) || /20\d\d/.test(baseT) || (baseT + " " + Ym).length > 60 ? baseT : /\bTermine?\b/.test(baseT) ? baseT.replace(/\bTermine?\b/, x => `${x} ${Ym}`) : `${baseT} ${Ym}`;
  const mDesc = first ? pickDesc(
      fresh(m.d) && `Nächster Termin: ${dDate(first.date)}${first.start ? ", " + timeText(first) : ""}. ${m.d}`,
      `${m.name}${m.name.includes(m.area) ? "" : ` (${m.area})`}: nächster Termin ${dDate(first.date)}${first.start ? ", " + timeText(first) : ""}. ${noPast(m.note)} Adresse und Anfahrt.`,
      `${m.name}${m.name.includes(m.area) ? "" : ` in ${m.area}`}: nächster Termin ${dDate(first.date)}${first.start ? ", " + timeText(first) : ""}. Alle Termine ${Ym}, Adresse, Anfahrt und Tipps für deinen Besuch.`,
      `${m.name}: nächster Termin ${dDate(first.date)}. Alle Termine ${Ym}, Uhrzeiten, Adresse und Anfahrt.`)
    : far ? pickDesc(
      `${m.name}${m.name.includes(m.area) ? "" : ` (${m.area})`}: nächster Termin ${dDate(far.date)} ${far.date.getUTCFullYear()}${far.start ? ", " + timeText(far) : ""}. ${noPast(m.note)} Adresse und Anfahrt.`,
      `${m.name}: nächster Termin ${dDate(far.date)} ${far.date.getUTCFullYear()}${far.start ? ", " + timeText(far) : ""}. Adresse, Anfahrt und Tipps für deinen Besuch.`,
      `${m.short}: nächster Termin ${dDate(far.date)} ${far.date.getUTCFullYear()}. Adresse und Anfahrt.`)
    : pickDesc(fresh(m.d), `${m.name} in ${m.area}: ${noPast(m.note)} Neue Termine folgen, sobald der Veranstalter sie veröffentlicht. Adresse und Anfahrt.`, `${m.name}: ${noPast(m.note)} Adresse, Anfahrt und neue Termine, sobald der Veranstalter sie veröffentlicht.`, `${m.name}: Adresse, Anfahrt und alle Termine, sobald der Veranstalter sie veröffentlicht. Täglich aktualisiert.`, `${m.short}: Adresse, Anfahrt und neue Termine, sobald der Veranstalter sie veröffentlicht.`);
  const body = crumbs([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name, `/flohmarkt-hamburg/${r.k}/`], [m.short]]) + `<article class="kb">
<h1>${esc(m.name)}: Öffnungszeiten und Termine</h1>
<div class="byline">${NEU[m.slug] ? '<span class="neu">Neu im Kalender</span>' : ""}<span>${ic("pin")}${esc(m.area)}</span><span>${ic("map")}${esc(regionLabel(r))}</span><span>${ic("update")}Stand: ${STAND}</span></div>
${favBtn(m, "btn fav-big")}
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${answer}</p></div>
<dl class="facts"><div><dt>${ic("cal")}Wann</dt><dd>${esc(cap(when) || (far ? m.later.slice(0, 4).map(x => fmtDateY(x.date)).join(" · ") : "Derzeit kein Termin"))}</dd></div><div><dt>${ic("clock")}Uhrzeit</dt><dd>${!first ? (far && far.start ? timeText(far) : "–") : mixed ? "je nach Termin, siehe unten" : timeText(first)}</dd></div>
<div><dt>${ic("pin")}Adresse</dt><dd>${addrNb(m.addr)}<br><a class="route" href="${route}" rel="noopener">${ic("route")}Route planen</a></dd></div>
${m.oepnv ? `<div><dt>${ic("tram")}Nächste Haltestelle</dt><dd>${esc(m.oepnv)}</dd></div>` : ""}${m.entry ? `<div><dt>${ic("tag")}Eintritt</dt><dd>${esc(entryText(m))}</dd></div>` : ""}${m.park ? `<div><dt>${ic("car")}Parken</dt><dd>${esc(m.park)}</dd></div>` : ""}${m.food ? `<div><dt>${ic("cup")}Essen &amp; Trinken</dt><dd>${esc(m.food)}</dd></div>` : ""}${m.org || m.web ? `<div><dt>${ic("user")}Veranstalter</dt><dd>${esc(m.org)}${m.web ? `${m.org ? "<br>" : ""}<a href="${esc(m.web)}" rel="noopener">Website des Veranstalters</a>` : ""}</dd></div>` : ""}${m.tags.length ? `<div><dt>${ic("tag")}Art des Markts</dt><dd class="tags-dd">${m.tags.map(t => CAT_BY_TAG[t] ? `<a class="tag" href="/${CAT_BY_TAG[t].s}/">${tagIc(t)}${esc(t)}</a>` : `<span class="tag">${tagIc(t)}${esc(t)}</span>`).join(" ")}</dd></div>` : ""}</dl>
<div class="share-row">${shareBtn(m, first, "btn share-big")}<a class="route" href="${route}" rel="noopener">${ic("route")}Route planen</a></div>${calDD(m, first)}${first ? wxSay(wxEv(first), "für " + (first.k === key(TODAY) ? "heute" : first.k === key(addDays(TODAY, 1)) ? "morgen" : WDL[first.date.getUTCDay()])) : ""}
${m.intro ? `<section class="block kb-body"><h2>Über den Markt</h2><p>${rich(m.intro)}</p></section>` : ""}
<section class="block"><h2>Nächste Termine</h2>${nxAll.length ? `<ul class="dates">${nxAll.map(e => `<li${e.cancelled ? ' class="off"' : ""} data-day="${e.k}"><span class="dt">${e.far ? fmtDateY(e.date) : fmtDate(e.date)}</span><span class="tm">${e.cancelled ? "fällt aus" : timeText(e)}</span>${e.note ? `<span class="meta">${esc(e.note)}</span>` : ""}</li>`).join("")}</ul>` : '<p class="meta">Die nächsten Termine sind noch nicht angekündigt.</p>'}${MS_ADDR || FORM ? `<div class="mk-report"><p><b>Termin fehlt oder stimmt nicht?</b> Sag uns kurz Bescheid.</p>${msLink("mk-report-btn", ic("mail") + "Melden", "", "/veranstalter/#korrektur")}</div>` : ""}</section>
${m.tips.length ? `<section class="block kb-body"><h2>Gut zu wissen</h2><ul class="tips">${m.tips.map(t => `<li>${rich(t)}</li>`).join("")}</ul></section>` : ""}
${m.fee || m.signup || m.signupHint || m.sellers ? `<section class="block sell"><h2>Selbst verkaufen</h2><dl class="facts">${m.fee ? `<div><dt>${ic("tag")}Standgebühr</dt><dd>${nbU(m.fee)}</dd></div>` : ""}${m.sellers ? `<div><dt>${ic("user")}Verkäufer</dt><dd>${esc(m.sellers)}</dd></div>` : ""}${m.signupHint ? `<div><dt>${ic("list")}Anmeldung</dt><dd>${nbU(m.signupHint)}</dd></div>` : ""}</dl>${m.signup ? `<p class="sell-go"><a class="route" href="${esc(m.signup)}" rel="noopener">Zur Anmeldung beim Veranstalter${ic("chev")}</a></p>` : ""}<p class="meta small">Stand der Angaben: Veranstalter, ohne Gewähr. Preise und Regeln können sich ändern. <a href="${FEE_P}">Alle Standgebühren im Vergleich</a></p>${signBox()}</section>` : ""}
${m.hint ? `<p class="hint">${rich(m.hint)}</p>` : ""}
${KC.some(i => i.m.includes(m.slug)) ? "" : kcForMarket(m)}
${faqBlock(mFaq, `Häufige Fragen zu ${esc(m.short)}`)}
<p class="hint">Angaben nach öffentlichen Informationen des Veranstalters${m.web ? ` (<a href="${esc(m.web)}" rel="noopener">Website</a>)` : ""}, ohne Gewähr. Märkte können kurzfristig ausfallen. Du veranstaltest diesen Markt? <a href="/veranstalter/#korrektur">Eintrag ändern oder entfernen lassen</a>.</p>
${(() => { const its = KC.filter(i => i.m.includes(m.slug)); return its.length ? `<section class="related"><div class="sec-head"><h2>Kauf-Check für diesen Markt</h2>${more(KC_P, "Alle Checks")}</div><div class="qlist">${its.map(i => `<a href="${kcUrl(i)}"><span>${esc(i.n)}: echt und in Ordnung?</span>${ic("chev")}</a>`).join("")}</div></section>` : ""; })()}
<section class="related"><div class="sec-head"><h2>Tipps für deinen Besuch</h2>${more("/ratgeber/", "Ratgeber")}</div>${grid(kbFor(m).map(kbCard))}</section>
${(() => { const nb = nearOf(m), allLink = more(`/flohmarkt-hamburg/${r.k}/`, `Alle ${r.umland ? "in der Region" : "im Bezirk"}`, "Alle Märkte " + r.im);
  if (nb.length) return `<section class="related"><div class="sec-head"><h2>${first || far ? "Flohmärkte in der Nähe" : "Bald geöffnet in der Nähe"}</h2>${allLink}</div>${grid(nb.map(nearCard))}</section>`;
  // ohne bekannte Lage: wie bisher Märkte aus dem Bezirk, höchstens sechs, die mit dem nächsten Termin zuerst
  const byNext = others.slice().sort((a, b) => (nextEv(a) ? nextEv(a).k : "9999").localeCompare(nextEv(b) ? nextEv(b).k : "9999")).slice(0, 6);
  return `<section class="related"><div class="sec-head"><h2>Weitere Flohmärkte ${esc(r.im)}</h2>${allLink}</div>${byNext.length ? grid(byNext.map(mCard)) : '<p class="meta">Weitere Märkte folgen.</p>'}</section>`; })()}</article>`;
  if (!m.t) warn("SEO", `${m.name}: SEO-Titel fehlt.`);
  layout({ p: `/flohmarkt/${m.slug}/`, title: `${mTitle} | ${NAME}`, desc: mDesc, body, nav: "maerkte", ld: G([crumbLD([[NAME, "/"], [r.umland ? "Umland" : "Flohmärkte Hamburg", "/flohmaerkte/"], [r.name, `/flohmarkt-hamburg/${r.k}/`], [m.name]]), faqLD(mFaq)].concat(nxAll.map(eventLD))) });
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
${r.intro || missing.length ? `<section class="block kb-body"><p>${rich((r.intro || "") + (missing.length ? `${r.intro ? " " : ""}Außerdem ${r.im}: ${listMore(missing.map(m => `[${m.name}](/flohmarkt/${m.slug}/)`), 12)}.` : ""))}</p></section>` : ""}
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
  // „Heute“ und „morgen“ an einem Werktag: Verweis auf die Märkte von Montag bis Freitag
  const wkLink = k => { const d = k === "heute" ? TODAY : k === "morgen" ? addDays(TODAY, 1) : null; return d && d.getUTCDay() >= 1 && d.getUTCDay() <= 5 ? `<a class="more" href="${WEEK_P}">Flohmärkte unter der Woche: alle Termine von Montag bis Freitag</a>` : ""; };
  const Z = {
    heute: () => {
      let evs = byDay.get(key(TODAY)) || [], ans;
      if (live(key(TODAY)).length) ans = `Heute, ${fmtDate(TODAY)}, ${live(key(TODAY)).length === 1 ? "hat ein Flohmarkt" : "haben " + live(key(TODAY)).length + " Flohmärkte"} in Hamburg und im Umland geöffnet: ${names(live(key(TODAY)))}.`;
      else { const nk = [...byDay.keys()].sort().find(k => k > key(TODAY) && live(k).length); evs = nk ? byDay.get(nk) : []; ans = `Heute, ${fmtDate(TODAY)}, findet laut Kalender kein Flohmarkt in Hamburg und im Umland statt.${nk ? ` Der nächste Markttag ist ${fmtDate(evs[0].date)}: ${names(live(nk))}.` : ""}`; }
      const lt = live(key(TODAY));
      return { h: "Flohmarkt Hamburg heute", sub: fmtDate(TODAY), t: "Flohmarkt Hamburg heute: Welche Märkte haben geöffnet?", evs, ans,
        d: pickDesc(lt.length === 1 ? `Heute, ${wdNum(TODAY)}, hat in Hamburg ein Flohmarkt geöffnet: ${lt[0].m.name}${lt[0].start ? ", " + timeText(lt[0]) : ""}. Adresse, Anfahrt und die nächsten Termine.` : lt.length ? `Heute, ${wdNum(TODAY)}: ${lt.length} Flohmärkte in Hamburg und Umgebung geöffnet${darunter(lt)}. Mit Uhrzeit und Adresse.` : "",
          "Welche Flohmärkte haben heute in Hamburg geöffnet? Tagesaktuelle Übersicht mit Uhrzeiten und Adressen, und falls heute nichts ist, der nächste Termin."),
        next: ["/morgen/", "Und morgen? Alle Flohmärkte von morgen"] };
    },
    wochenende: () => {
      const { sat, sun, sunOnly } = weekendDays(), a = sunOnly ? [] : live(key(sat)), b = live(key(sun));
      const evs = (sunOnly ? [] : (byDay.get(key(sat)) || [])).concat(byDay.get(key(sun)) || []), n = a.length + b.length, c = x => x === 0 ? "keiner" : x === 1 ? "einer" : String(x);
      // Sonntags ist das laufende Wochenende fast vorbei: Darunter steht schon das nächste (so passt die Seite auch für die Planung unter der Woche)
      const nSat = addDays(sun, 6), nSun = addDays(sun, 7), nEvs = sunOnly ? (byDay.get(key(nSat)) || []).concat(byDay.get(key(nSun)) || []) : [], nN = nEvs.filter(e => !e.cancelled).length;
      const spanN = (x, y) => `${x.getUTCDate()}./${y.getUTCDate()}.${y.getUTCMonth() + 1}.${y.getUTCFullYear()}`;
      const span = (x, y) => x.getUTCMonth() === y.getUTCMonth() ? `${x.getUTCDate()}./${y.getUTCDate()}. ${MON[y.getUTCMonth()]}` : `${x.getUTCDate()}.${x.getUTCMonth() + 1}./${y.getUTCDate()}.${y.getUTCMonth() + 1}.`;
      const ans = sunOnly
        ? `Heute, am Sonntag, ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}, ${b.length === 0 ? "findet laut Kalender kein Flohmarkt" : b.length === 1 ? "findet ein Flohmarkt" : "finden " + b.length + " Flohmärkte"} in Hamburg und im Umland statt.${b.length ? " " + names(b) + "." : ""}${nN ? ` Am nächsten Wochenende, ${span(nSat, nSun)}, ${nN === 1 ? "steht ein Flohmarkt" : "stehen " + nN + " Flohmärkte"} im Kalender.` : ""}`
        : `Am Wochenende ${sat.getUTCDate()}. und ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]} ${n === 1 ? "findet ein Flohmarkt" : "finden " + n + " Flohmärkte"} in Hamburg und im Umland statt, ${c(a.length)} am Samstag und ${c(b.length)} am Sonntag.`;
      return { h: "Flohmarkt Hamburg am Wochenende", sub: sunOnly ? `Sonntag, ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}` : `${sat.getUTCDate()}. und ${sun.getUTCDate()}. ${MON[sun.getUTCMonth()]}`,
        t: sunOnly ? `Flohmarkt Hamburg Wochenende: heute & ${span(nSat, nSun)}` : `Flohmarkt Hamburg Wochenende ${span(sat, sun)}: alle Termine`, evs, ans,
        d: pickDesc(n ? (sunOnly ? `Heute, am Sonntag: ${b.length} Flohmärkte in Hamburg und Umgebung${darunter(b)}.${nN ? ` Am ${spanN(nSat, nSun)}: ${nN} Termine.` : ""} Mit Uhrzeit und Adresse.` : `Am Wochenende ${spanN(sat, sun)}: ${n} Flohmärkte in Hamburg und Umgebung, ${a.length} am Samstag und ${b.length} am Sonntag. Alle Termine mit Uhrzeit.`) : "",
          nN ? `Flohmärkte in Hamburg am Wochenende: heute und am ${spanN(nSat, nSun)} mit ${nN} Terminen. Alle Märkte mit Uhrzeit, Adresse und Anfahrt.` : "",
          "Alle Flohmärkte in Hamburg am kommenden Wochenende, Samstag und Sonntag, mit Uhrzeiten, Adressen und Links zu jedem Markt. Täglich aktualisiert."),
        extra: nEvs.length ? { h: `Nächstes Wochenende: ${nSat.getUTCDate()}. und ${nSun.getUTCDate()}. ${MON[nSun.getUTCMonth()]}`, evs: nEvs } : null };
    },
    sonntag: () => {
      const s0 = addDays(TODAY, (7 - TODAY.getUTCDay()) % 7), ks = [0, 7, 14, 21].map(n => key(addDays(s0, n))), first = live(ks[0]);
      return { h: "Flohmarkt Hamburg am Sonntag", sub: "ab " + fmtDate(s0), t: `Flohmarkt Hamburg Sonntag: Termine ab ${s0.getUTCDate()}. ${MON[s0.getUTCMonth()]}`, evs: ks.flatMap(k => byDay.get(k) || []),
        d: pickDesc(first.length ? `Flohmarkt in Hamburg am Sonntag: Am ${wdNum(s0)} öffnen ${first.length === 1 ? "ein Markt" : first.length + " Märkte"}${darunter(first)}. Alle Sonntagstermine mit Uhrzeit.` : "",
          "Flohmarkt in Hamburg am Sonntag: die nächsten Sonntagstermine mit Uhrzeiten und Adressen, in der Stadt und im Umland bis 30 Kilometer."),
        ans: (first.length ? `Am ${fmtDate(s0)} ${first.length === 1 ? "findet ein Flohmarkt" : "finden " + first.length + " Flohmärkte"} in Hamburg und im Umland statt: ${names(first)}.` : "Am kommenden Sonntag steht kein Flohmarkt im Kalender.") + " In der Stadt sind es sonntags vor allem Nachbarschaftsmärkte, im Umland kommen viele Märkte auf Bau- und Supermarktparkplätzen dazu." };
    },
    samstag: () => {
      const s0 = addDays(TODAY, (6 - TODAY.getUTCDay() + 7) % 7), ks = [0, 7, 14, 21].map(n => key(addDays(s0, n))), first = live(ks[0]);
      return { h: "Flohmarkt Hamburg am Samstag", sub: "ab " + fmtDate(s0), t: `Flohmarkt Hamburg Samstag: Termine ab ${s0.getUTCDate()}. ${MON[s0.getUTCMonth()]}`, evs: ks.flatMap(k => byDay.get(k) || []),
        d: pickDesc(first.length ? `Flohmarkt in Hamburg am Samstag: Am ${wdNum(s0)} öffnen ${first.length === 1 ? "ein Markt" : first.length + " Märkte"}${darunter(first)}. Alle Samstagstermine mit Uhrzeit.` : "",
          "Flohmarkt in Hamburg am Samstag: die nächsten Samstagstermine mit Uhrzeiten und Adressen, in der Stadt und im Umland bis 30 Kilometer."),
        ans: (first.length ? `Am ${fmtDate(s0)} ${first.length === 1 ? "findet ein Flohmarkt" : "finden " + first.length + " Flohmärkte"} in Hamburg und im Umland statt: ${names(first)}.` : "Am kommenden Samstag steht kein Flohmarkt im Kalender.") + " Der Samstag ist in Hamburg der wichtigste Flohmarkttag, viele Märkte beginnen schon früh am Morgen." };
    },
    morgen: () => {
      const d = addDays(TODAY, 1), k = key(d), lv = live(k);
      let evs = byDay.get(k) || [], ans;
      if (lv.length) ans = `Morgen, ${fmtDate(d)}, ${lv.length === 1 ? "hat ein Flohmarkt" : "haben " + lv.length + " Flohmärkte"} in Hamburg und im Umland geöffnet: ${names(lv)}.`;
      else { const nk = [...byDay.keys()].sort().find(x => x > k && live(x).length); evs = nk ? byDay.get(nk) : []; ans = `Morgen, ${fmtDate(d)}, findet laut Kalender kein Flohmarkt in Hamburg und im Umland statt.${nk ? ` Der nächste Markttag ist ${fmtDate(evs[0].date)}: ${names(live(nk))}.` : ""}`; }
      return { h: "Flohmarkt Hamburg morgen", sub: fmtDate(d), t: "Flohmarkt Hamburg morgen: Welche Märkte öffnen?", evs, ans,
        d: pickDesc(lv.length === 1 ? `Morgen, ${wdNum(d)}, hat in Hamburg ein Flohmarkt geöffnet: ${lv[0].m.name}${lv[0].start ? ", " + timeText(lv[0]) : ""}. Adresse, Anfahrt und die nächsten Termine.` : lv.length ? `Morgen, ${wdNum(d)}: ${lv.length} Flohmärkte in Hamburg und Umgebung${darunter(lv)}. Mit Uhrzeit und Adresse.` : "",
          "Welche Flohmärkte haben morgen in Hamburg geöffnet? Übersicht mit Uhrzeiten und Adressen, und falls morgen nichts ist, der nächste Termin."),
        next: ["/heute/", "Zurück zu heute: alle Flohmärkte von heute"] };
    }
  };
  for (const [k, fn] of Object.entries(Z)) {
    const z = fn();
    const body = crumbs([[NAME, "/"], ["Termine", "/termine/"], [z.h.replace("Flohmarkt Hamburg ", "")]]) + `<article class="kb"><h1>${z.h}</h1><div class="byline"><span>${ic("cal")}${esc(z.sub)}</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(z.ans)}</p></div>${rainBox(z.evs)}${nearBox()}<section class="block">${groupList(z.evs) || '<p class="meta">Keine Termine im Kalender.</p>'}</section>${z.extra ? `<section class="block"><h2>${esc(z.extra.h)}</h2>${groupList(z.extra.evs, 3)}</section>` : ""}${z.next ? `<a class="more" href="${z.next[0]}">${z.next[1]}</a>` : ""}${wkLink(k)}
<section class="related"><div class="sec-head"><h2>Weitere Zeiträume und Bezirke</h2></div>${regionChips(`/${k}/`)}</section>
<section class="related"><div class="sec-head"><h2>Vor dem Besuch lesen</h2></div>${grid(["beste-uhrzeit-flohmarkt", "was-mitnehmen-flohmarkt", "flohmarkt-knigge"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
    layout({ p: `/${k}/`, title: `${z.t} | ${NAME}`, desc: z.d, body, nav: "termine", ld: G([crumbLD([[NAME, "/"], ["Termine", "/termine/"], [z.h]])].concat(z.evs.concat(z.extra ? z.extra.evs : []).map(eventLD))) });
  }
}

/* ---------------------------------------------------------------- Seiten nach Art des Markts */
const CAT_FORM = { "antikmarkt-hamburg": "", "frauenflohmarkt-hamburg": "links", "nachbarschaftsflohmarkt-hamburg": "rund", "groesste-flohmaerkte-hamburg": "rund links" };
for (const c of CATS_ON) {
  const p = `/${c.s}/`, ms = [...c.ms].sort((a, b) => ((a.events.find(e => !e.cancelled) || {}).k || "9").localeCompare((b.events.find(e => !e.cancelled) || {}).k || "9"));
  const ev60 = upcoming(60, e => c.ms.includes(e.m)), nx = nextOf(c.evs), Y = yearSpan(ev60.filter(e => !e.cancelled).length ? ev60.filter(e => !e.cancelled) : c.evs);
  const cr = [[NAME, "/"], ["Alle Märkte", "/flohmaerkte/"], [c.chip]];
  const withEv = ms.filter(m => m.events.some(e => !e.cancelled));
  const ans = `${c.ansStart || "In Hamburg und Umgebung"} ${c.ms.length === 1 ? "steht ein Markt" : `stehen ${c.ms.length} ${c.plKurz || c.pl}`} im ${NAME}-Kalender${withEv.length < c.ms.length ? `, ${withEv.length} davon mit angekündigten Terminen` : ""}.${nx ? ` Der nächste Termin: ${nx.m.name} am ${fmtDate(nx.date)}${nx.start ? ", " + timeText(nx) : ""}.` : " Neue Termine folgen, sobald die Veranstalter sie veröffentlichen."}`;
  const faq = [...(nx ? [[`Wann ist der nächste Termin?`, `${nx.m.name} am ${fmtDate(nx.date)}${nx.start ? ", " + timeText(nx) : ""}. Alle weiteren Termine stehen oben in der Liste.`]] : []),
    [`Welche ${c.plW || c.pl} gibt es${c.ort === false ? "" : " in Hamburg"}?`, `${listMore(ms.map(m => `[${m.name}](/flohmarkt/${m.slug}/)`), 6)}.`], ...c.f];
  // Marktnamen ins Snippet: Wer sucht, erkennt seinen Markt. Zuerst Namen mit dem Stichwort der Seite (Nacht…, Kinder…), dann bekannte Märkte, sonst nach nächstem Termin.
  const stem = c.s.split("-")[0].slice(0, 5), nmS = m => 2 * m.short.toLowerCase().includes(stem) + m.tags.includes("Groß & bekannt");
  const nmA = [...new Set([...withEv].sort((a, b) => nmS(b) - nmS(a)).map(m => m.short))];
  const nmT = n => nmA.length > n ? `${nmA.slice(0, n).join(", ")} und ${nmA.length - n === 1 ? "ein weiterer" : `${nmA.length - n} weitere`}` : listNames(nmA, n);
  const nmD = nmA.length < 2 ? [] : [3, 2].flatMap(n => [`${cap(c.pl)}${c.ort === false ? "" : " in Hamburg"}: ${nmT(n)}.${nx ? ` Nächster Termin ${dDate(nx.date)}.` : ""} Alle Termine ${Y} mit Uhrzeit und Adresse.`,
    `${cap(c.pl)}${c.ort === false ? "" : " in Hamburg"}: ${nmT(n)}. Alle Termine ${Y} mit Uhrzeit und Adresse.`]).filter(x => x.replace(/\s+/g, " ").length <= 158);
  const desc = pickDesc(
    ...nmD,
    `${cap(c.pl)}${c.ort === false ? "" : " in Hamburg und Umgebung"}: ${c.ms.length} Märkte${nx ? `, nächster Termin ${dDate(nx.date)}` : ""}. Alle Termine ${Y} mit Uhrzeit, Adresse und Anfahrt.`,
    `${cap(c.pl)}${c.ort === false ? "" : " in Hamburg und Umgebung"}: ${c.ms.length} Märkte mit allen Terminen ${Y}, Uhrzeiten und Adressen. Täglich aktualisiert.`,
    `Alle ${c.plW || c.pl}${c.ort === false ? "" : " in Hamburg"}: ${c.ms.length} Märkte mit Terminen ${Y}, Uhrzeiten und Adressen.`);
  const body = crumbs(cr) + `<article class="kb"><h1>${esc(c.h1)}</h1>
<div class="byline"><span>${ic("pin")}${c.ms.length} Märkte</span><span>${ic("cal")}${c.evs.filter(e => !e.cancelled).length} Termine</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(ans)}</p></div>${nearBox()}
<section class="related"><div class="sec-head"><h2>Nächste Termine</h2><small>nächste 60 Tage</small></div>${groupList(ev60, 3) || '<p class="meta">In den nächsten 60 Tagen keine Termine. Die Märkte unten melden neue Termine meist rechtzeitig vorher.</p>'}</section>
<section class="related"><div class="sec-head"><h2>Alle Märkte im Überblick</h2></div>${grid(ms.map(mCard))}</section>
<div class="kb-body">${sideImg(`seite-${c.s}`, CAT_FORM[c.s] ?? ["", "rund", "links", "rund links"][CATS_ON.indexOf(c) % 4])}<p class="intro">${esc(c.lead)}</p>${c.b().map(([h, x]) => `<h2>${esc(h)}</h2><p>${rich(x)}</p>`).join("")}</div>
${faqBlock(faq)}
${Object.keys(KC_AREAS).filter(x => KC_AREAS[x].cat === c.s).map(x => kcCta(x)).join("")}
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
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(ans)}</p></div>${nearBox()}${dayStrip(mo.evs)}
<section class="block">${groupList(mo.evs, 2, true)}</section>
<section class="related"><div class="sec-head"><h2>Andere Monate</h2></div>${monthChips(mo.s) || '<p class="meta">Weitere Monate folgen.</p>'}</section>
<section class="related"><div class="sec-head"><h2>Nach Art des Markts</h2></div>${catChips()}</section>
<section class="related"><div class="sec-head"><h2>Vor dem Besuch lesen</h2></div>${grid(["beste-uhrzeit-flohmarkt", "was-mitnehmen-flohmarkt", "flohmarkt-bei-regen"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p, title: `Flohmarkt Hamburg ${label}: alle Termine | ${NAME}`, desc, body, nav: "termine", ld: G([crumbLD(cr)].concat(mo.evs.slice(0, 100).map(eventLD))) });
}

/* ---------------------------------------------------------------- Schilder (Schildgenerator)
   Eine Übersichtsseite plus eine Seite je Vorlage. Das Schild entsteht im Browser (src/site.js),
   gedruckt wird über den normalen Druckdialog. Es wird nichts gespeichert oder verschickt.
   Texte der Vorlagen stehen hier, damit sie ohne Sheet funktionieren. */
// QR-Code unten auf jedem Schild: https://www.flohlotse.de/schilder (leitet auf den Schilder-Designer weiter)
const QR = { n: 29, d: "M0 0h7v1h-7zM9 0h1v1h-1zM12 0h1v1h-1zM15 0h2v1h-2zM18 0h3v1h-3zM22 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM11 1h2v1h-2zM22 1h1v1h-1zM28 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h2v1h-2zM11 2h1v1h-1zM14 2h1v1h-1zM16 2h1v1h-1zM18 2h3v1h-3zM22 2h1v1h-1zM24 2h3v1h-3zM28 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h2v1h-2zM16 3h2v1h-2zM19 3h1v1h-1zM22 3h1v1h-1zM24 3h3v1h-3zM28 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h3v1h-3zM12 4h4v1h-4zM18 4h2v1h-2zM22 4h1v1h-1zM24 4h3v1h-3zM28 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h3v1h-3zM12 5h5v1h-5zM20 5h1v1h-1zM22 5h1v1h-1zM28 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h7v1h-7zM8 7h1v1h-1zM13 7h1v1h-1zM15 7h1v1h-1zM20 7h1v1h-1zM0 8h1v1h-1zM2 8h5v1h-5zM9 8h1v1h-1zM14 8h2v1h-2zM17 8h2v1h-2zM22 8h5v1h-5zM2 9h2v1h-2zM7 9h1v1h-1zM10 9h3v1h-3zM15 9h10v1h-10zM28 9h1v1h-1zM0 10h1v1h-1zM2 10h1v1h-1zM6 10h2v1h-2zM9 10h1v1h-1zM11 10h1v1h-1zM17 10h1v1h-1zM20 10h1v1h-1zM1 11h1v1h-1zM5 11h1v1h-1zM9 11h3v1h-3zM14 11h1v1h-1zM16 11h1v1h-1zM19 11h1v1h-1zM21 11h3v1h-3zM25 11h1v1h-1zM27 11h1v1h-1zM2 12h1v1h-1zM4 12h1v1h-1zM6 12h1v1h-1zM8 12h2v1h-2zM17 12h1v1h-1zM20 12h1v1h-1zM25 12h2v1h-2zM0 13h1v1h-1zM3 13h3v1h-3zM7 13h3v1h-3zM11 13h5v1h-5zM19 13h4v1h-4zM24 13h1v1h-1zM28 13h1v1h-1zM1 14h1v1h-1zM5 14h2v1h-2zM8 14h3v1h-3zM12 14h4v1h-4zM17 14h2v1h-2zM22 14h2v1h-2zM25 14h2v1h-2zM4 15h1v1h-1zM11 15h1v1h-1zM13 15h1v1h-1zM20 15h2v1h-2zM23 15h2v1h-2zM27 15h1v1h-1zM1 16h2v1h-2zM4 16h3v1h-3zM10 16h1v1h-1zM14 16h4v1h-4zM20 16h1v1h-1zM23 16h1v1h-1zM25 16h2v1h-2zM0 17h2v1h-2zM3 17h3v1h-3zM7 17h1v1h-1zM9 17h2v1h-2zM16 17h1v1h-1zM18 17h7v1h-7zM26 17h1v1h-1zM28 17h1v1h-1zM0 18h1v1h-1zM6 18h1v1h-1zM10 18h1v1h-1zM12 18h1v1h-1zM15 18h4v1h-4zM20 18h1v1h-1zM22 18h2v1h-2zM26 18h1v1h-1zM0 19h1v1h-1zM2 19h3v1h-3zM8 19h3v1h-3zM14 19h3v1h-3zM19 19h2v1h-2zM22 19h3v1h-3zM27 19h1v1h-1zM0 20h1v1h-1zM4 20h3v1h-3zM9 20h1v1h-1zM11 20h2v1h-2zM15 20h1v1h-1zM17 20h1v1h-1zM19 20h6v1h-6zM26 20h3v1h-3zM8 21h3v1h-3zM12 21h3v1h-3zM16 21h3v1h-3zM20 21h1v1h-1zM24 21h5v1h-5zM0 22h7v1h-7zM13 22h3v1h-3zM18 22h3v1h-3zM22 22h1v1h-1zM24 22h3v1h-3zM0 23h1v1h-1zM6 23h1v1h-1zM8 23h1v1h-1zM10 23h1v1h-1zM13 23h1v1h-1zM15 23h2v1h-2zM18 23h3v1h-3zM24 23h1v1h-1zM0 24h1v1h-1zM2 24h3v1h-3zM6 24h1v1h-1zM8 24h2v1h-2zM11 24h2v1h-2zM14 24h2v1h-2zM17 24h1v1h-1zM20 24h5v1h-5zM26 24h2v1h-2zM0 25h1v1h-1zM2 25h3v1h-3zM6 25h1v1h-1zM8 25h6v1h-6zM16 25h3v1h-3zM23 25h1v1h-1zM25 25h4v1h-4zM0 26h1v1h-1zM2 26h3v1h-3zM6 26h1v1h-1zM8 26h6v1h-6zM15 26h1v1h-1zM18 26h10v1h-10zM0 27h1v1h-1zM6 27h1v1h-1zM9 27h3v1h-3zM13 27h4v1h-4zM20 27h4v1h-4zM25 27h1v1h-1zM27 27h1v1h-1zM0 28h7v1h-7zM8 28h2v1h-2zM11 28h3v1h-3zM17 28h1v1h-1zM19 28h1v1h-1zM21 28h1v1h-1zM23 28h4v1h-4z" }; // QR-Code zu https://www.flohlotse.de (fest, wird nicht bei jedem Bau neu berechnet)
const qrSVG = cls => `<svg class="${cls}" viewBox="-2 -2 ${QR.n + 4} ${QR.n + 4}" aria-hidden="true" focusable="false"><rect x="-2" y="-2" width="${QR.n + 4}" height="${QR.n + 4}" fill="#fff"/><path fill="#15211B" d="${QR.d}"/></svg>`;
const SIGN_BASE = "/flohmarkt-schilder/";
const kl = (s, t) => KBY[s] ? `<a href="/ratgeber/${s}/">${t}</a>` : t; // Ratgeber-Link, falls der Artikel existiert
const SIGNS = [
  { s: "preisschilder", kind: "tags", chip: "Preisschilder", short: "24 Preisschilder pro A4-Blatt, auch für Etiketten 70 × 37 mm.",
    h1: "Preisschilder für den Flohmarkt: Vorlage zum Ausdrucken", title: "Preisschilder Flohmarkt zum Ausdrucken: PDF-Vorlage",
    desc: "Preisschilder für den Flohmarkt kostenlos zum Ausdrucken oder als PDF: 24 Stück pro A4-Blatt, passend für Etiketten 70 × 37 mm. Leer oder mit festem Preis.",
    ans: "Hier druckst du 24 Preisschilder auf ein A4-Blatt. Lass das Preisfeld leer, wenn du mit Stift beschriften willst, oder tipp einen festen Preis ein. Die Felder messen 70 × 37 mm und passen auf gängige Etikettenbögen in diesem Format.",
    v: [{ l: "Zum Beschriften", price: "" }, { l: "50 Cent", price: "50 Cent" }, { l: "1 €", price: "1 €" }, { l: "2 €", price: "2 €" }, { l: "5 €", price: "5 €" }],
    b: () => [["Preise, die man von Weitem liest", `Schreib Preise groß und mit dickem Filzstift, dann sieht man sie auch von der anderen Tischseite. Ein Kreuz bei „VB“ zeigt, dass du über den Preis redest. Wie du sinnvolle Preise findest, steht im Ratgeber ${kl("preise-festlegen-flohmarkt", "Preise auf dem Flohmarkt festlegen")}.`],
      ["Kleben, klemmen oder einstecken", "Auf Etikettenbögen gedruckt klebst du die Schilder direkt auf. Auf normalem Papier schneidest du sie aus und befestigst sie mit Kreppband, das sich meist ohne Rückstände ablöst. An Kleidung hält ein Schild mit Sicherheitsnadel, in Büchern und Plattenhüllen legst du es lose ein."]],
    f: [["Welches Etikettenformat passt?", "Die Vorlage hat drei Spalten und acht Reihen zu je 70 × 37 mm, also 24 Etiketten pro A4-Bogen. Stell beim Drucken die Größe auf 100 % oder „Tatsächliche Größe“, nicht auf „An Seite anpassen“."],
      ["Kann ich verschiedene Preise auf ein Blatt drucken?", "Lass das Preisfeld leer und schreib die Preise mit Stift drauf. So bist du am flexibelsten und kannst am Nachmittag auch mal einen Preis durchstreichen."],
      ["Hinterlässt Klebeband Spuren?", "Kreppband lässt sich meist sauber abziehen. Auf empfindlichen Buchumschlägen und Schallplattenhüllen legst du das Schild trotzdem besser lose ein."]],
    kb: ["preise-festlegen-flohmarkt", "checkliste-flohmarktstand", "was-verkauft-sich-gut-flohmarkt"] },
  { s: "alles-1-euro", fmt: "quer", sym: "coins", chip: "Alles 1 €", short: "Das Schild für die Wühlkiste, auch als 50 Cent, 2 € oder 5 €.",
    h1: "Alles-1-Euro-Schild für den Flohmarkt: kostenlos drucken", title: "Alles 1 Euro Schild zum Ausdrucken: kostenlos",
    desc: "Schild „Alles 1 €“ für deine Flohmarkt-Kiste: kostenlos gestalten und drucken, auch für 50 Cent, 2 € oder 5 €. Als A4 oder acht kleine Schilder.",
    ans: "Ein „Alles 1 €“-Schild auf der Wühlkiste ist eines der wirkungsvollsten Schilder am Stand: Die Leute greifen zu, ohne erst nach dem Preis zu fragen. Wähl unten den Betrag, druck das Schild aus und klemm es gut sichtbar an die Kiste.",
    v: [{ l: "1 €", top: "Alles", main: "1 €", bot: "pro Teil" }, { l: "50 Cent", top: "Alles", main: "50 Cent", bot: "pro Teil" }, { l: "2 €", top: "Alles", main: "2 €", bot: "pro Teil" }, { l: "5 €", top: "Alles", main: "5 €", bot: "pro Teil" }],
    b: () => [["Warum Festpreis-Kisten funktionieren", "Bei Kleinkram wie Taschenbüchern, Tassen oder Kinderspielzeug lohnt sich Feilschen für beide Seiten kaum. Ein fester Preis nimmt die Hemmung, und du musst nicht jede Frage einzeln beantworten. Gerade am Nachmittag hilft so eine Kiste, Restposten loszuwerden."],
      ["Tipps für die Kiste", "Stell die Kiste vorn an den Tisch oder davor auf den Boden, damit man gut darin wühlen kann. Sortier zwischendurch nach, dann wirkt sie nicht leer gekauft. Mit dem Format „8 pro Blatt“ bekommst du kleine Schilder für mehrere Kisten auf einmal."]],
    f: [["Welcher Betrag passt für meine Kiste?", "Für Taschenbücher, Kleinkram und Kinderkleidung sind 50 Cent bis 1 € üblich, für Hardcover, Spiele oder bessere Kleidung eher 2 bis 5 €. Am Nachmittag kannst du den Preis senken und einfach ein neues Schild drucken."],
      ["Kann ich das Schild ohne Farbe drucken?", "Ja. Schalte den Sparmodus ein, dann druckt das Schild mit schwarzem Rahmen statt gelber Fläche. Das schont die Druckerpatrone."]],
    kb: ["preise-festlegen-flohmarkt", "was-verkauft-sich-gut-flohmarkt", "reste-nach-dem-flohmarkt"] },
  { s: "handeln-erwuenscht", fmt: "quer", sym: "handshake", chip: "Handeln erwünscht", short: "Lädt zum Verhandeln ein und bringt Leute ins Gespräch.",
    h1: "Handeln-erwünscht-Schild für den Flohmarkt zum Ausdrucken", title: "Handeln erwünscht: Schild für den Flohmarkt",
    desc: "Kostenloses Schild „Handeln erwünscht“ für deinen Flohmarktstand: lädt zum Verhandeln ein und bringt mehr Leute ins Gespräch. Gestalten und drucken.",
    ans: "Ein „Handeln erwünscht“-Schild senkt die Hemmschwelle: Viele Leute trauen sich sonst nicht, ein Angebot zu machen, und gehen weiter. Wähl einen Spruch, druck das Schild und stell es gut sichtbar auf den Tisch.",
    v: [{ l: "Handeln erwünscht", top: "", main: "Handeln erwünscht", bot: "Mach mir ein Angebot" }, { l: "Mach ein Angebot", sym: "face-grin-wink", top: "Gefällt dir was?", main: "Mach ein Angebot", bot: "Ich beiße nicht" }, { l: "Alle Preise VB", top: "", main: "Alle Preise VB", bot: "VB heißt: Wir reden drüber" }],
    b: () => [["Wann das Schild sinnvoll ist", "Besonders bei größeren Stücken wie Möbeln, Lampen oder Elektrogeräten wartet die Kundschaft oft auf ein Zeichen, dass der Preis nicht in Stein gemeißelt ist. Plan beim Auspreisen etwas Spielraum ein, dann kannst du entspannt nachgeben."],
      ["So verhandelst du freundlich", `Hör dir das Angebot an, nenn einen Gegenvorschlag und trefft euch in der Mitte. Wer mehrere Teile nimmt, bekommt einen Paketpreis. Mehr dazu im Ratgeber ${kl("handeln-auf-dem-flohmarkt", "Handeln auf dem Flohmarkt")}.`]],
    f: [["Verkaufe ich mit dem Schild unter Wert?", "Nicht unbedingt. Wenn du deine Preise mit etwas Spielraum ansetzt, kommst du beim Verhandeln trotzdem gut weg und verkaufst mehr."],
      ["Was heißt VB?", "VB steht für Verhandlungsbasis. Der Preis ist ein Vorschlag, über den man reden kann."]],
    kb: ["handeln-auf-dem-flohmarkt", "preise-festlegen-flohmarkt", "flohmarkt-knigge"] },
  { s: "bar-und-paypal", fmt: "quer", sym: "wallet", chip: "Bar & PayPal", short: "Zeigt sofort, wie man bei dir bezahlen kann.",
    h1: "Zahlungsschild für den Flohmarkt: Bar, PayPal oder per App", title: "PayPal-Schild Flohmarkt: mit QR-Code zum Ausdrucken",
    desc: "Schild „Bar & PayPal“ für deinen Flohmarktstand, auf Wunsch mit QR-Code zu deinem PayPal.me-Link. Kostenlos anpassen, drucken oder als PDF speichern.",
    ans: "Ein Zahlungsschild beantwortet die häufigste Frage am Stand, bevor sie gestellt wird. Trag ein, was du annimmst, zum Beispiel Bargeld und PayPal, und häng das Schild an deine Kasse.",
    v: [{ l: "Bar & PayPal", top: "Bei mir zahlst du", main: "Bar & PayPal", bot: "Kleingeld ist willkommen" }, { l: "Nur Bargeld", sym: "coins", top: "", main: "Nur Bargeld", bot: "Danke für passendes Kleingeld" }, { l: "Bar & per App", top: "Bei mir zahlst du", main: "Bar & per App", bot: "Frag einfach nach" }],
    b: () => [["Warum das Schild Zeit spart", "Nicht alle haben genug Bargeld dabei. Wer sieht, dass er per App zahlen kann, kauft eher, statt zum Geldautomaten zu laufen. Umgekehrt vermeidet ein „Nur Bargeld“ enttäuschte Gesichter an der Kasse."],
      ["Tipp für Zahlungen per App", `Übergib die Ware erst, wenn die Zahlung auf deinem Handy angekommen ist. Für PayPal trägst du oben deinen PayPal.me-Namen ein, dann steht ein QR-Code zum Bezahlen direkt auf dem Schild. Für andere Apps druckst du den Code aus der App aus und klebst ihn daneben. Mehr dazu im Ratgeber ${kl("bezahlen-auf-dem-flohmarkt", "Wie bezahlt man auf dem Flohmarkt?")}.`]],
    f: [["Kann ich meinen Zahlungs-QR-Code aufs Schild drucken?", "Für PayPal ja: Trag deinen PayPal.me-Namen ein, dann erscheint der QR-Code auf dem Schild. Er entsteht auf deinem Gerät, dein Name wird nicht übertragen oder gespeichert. Prüf vor dem Drucken einmal mit dem Handy, ob der Code auf deinen PayPal.me-Link führt. Für andere Bezahl-Apps druckst du den Code direkt aus der App aus."],
      ["Wie viel Wechselgeld brauche ich?", `Das hängt von deinen Preisen ab. Eine Übersicht mit Beispielen findest du im Ratgeber ${kl("wechselgeld-flohmarkt", "Wechselgeld für den Flohmarkt")}.`]],
    kb: ["bezahlen-auf-dem-flohmarkt", "wechselgeld-flohmarkt", "diebstahl-am-flohmarktstand"] },
  { s: "mengenrabatt", fmt: "quer", sym: "percent", chip: "3 für 5 €", short: "Mengenrabatt wie „3 für 5 €“ oder „Tüte voll 5 €“.",
    h1: "Mengenrabatt-Schild für den Flohmarkt: „3 für 5 €“ und mehr", title: "Mengenrabatt-Schild für den Flohmarkt drucken",
    desc: "Schild für Mengenrabatt am Flohmarktstand, etwa „3 für 5 €“ oder „Tüte voll 5 €“: kostenlos gestalten, ausdrucken und an die Kiste hängen.",
    ans: "Mit einem Mengenrabatt verkaufst du mehr Teile pro Kunde. Ein Schild wie „3 für 5 €“ macht das Angebot auf einen Blick klar. Betrag wählen, drucken, an die Kiste klemmen.",
    v: [{ l: "3 für 5 €", top: "Mengenrabatt", main: "3 für 5 €", bot: "Gilt für diese Kiste" }, { l: "Nimm 3, zahl 2", top: "Mengenrabatt", main: "Nimm 3, zahl 2", bot: "Das günstigste Teil ist gratis" }, { l: "Tüte voll 5 €", sym: "bag-shopping", top: "Ausverkauf", main: "Tüte voll: 5 €", bot: "Du packst, ich kassiere" }],
    b: () => [["Wofür sich Mengenrabatt eignet", "Bücher, DVDs, Kinderkleidung und Schallplatten werden gern im Stapel gekauft. Ein Mengenrabatt lädt dazu ein, noch ein Teil mehr mitzunehmen, und du musst am Ende weniger wieder einpacken."],
      ["Tüte voll für einen Preis", `Gegen Ende des Markttags ist „Tüte voll: 5 €“ ein bewährter Trick für Restposten. Leg ein paar Tüten bereit, dann geht es schneller. Was danach übrig bleibt, steht im Ratgeber ${kl("reste-nach-dem-flohmarkt", "Nach dem Flohmarkt: Wohin mit den Resten?")}.`]],
    f: [["Wie rechne ich einen fairen Mengenrabatt?", "Eine einfache Faustregel: Wer drei Teile nimmt, bekommt eines etwa zum halben Preis. So ist der Rabatt spürbar, ohne dass du draufzahlst."],
      ["Kann ich mehrere Rabattschilder auf ein Blatt drucken?", "Ja. Wähl das Format „8 pro Blatt“, dann bekommst du acht kleine Schilder für verschiedene Kisten."]],
    kb: ["preise-festlegen-flohmarkt", "reste-nach-dem-flohmarkt", "was-verkauft-sich-gut-flohmarkt"] },
  { s: "reserviert-verkauft", fmt: "quer", chip: "Reserviert", short: "„Reserviert“ oder „Verkauft“, mit Platz für Name und Uhrzeit.",
    h1: "Reserviert- und Verkauft-Schild für den Flohmarkt", title: "Reserviert-Schild & Verkauft-Schild zum Ausdrucken",
    desc: "Kostenlose Schilder „Reserviert“ und „Verkauft“ für den Flohmarkt: mit Platz für Name oder Abholzeit, als A4 oder acht kleine Schilder pro Blatt.",
    ans: "Wenn jemand ein großes Stück später abholen will, zeigt ein „Reserviert“-Schild allen anderen, dass es vergeben ist. Trag in die kleine Zeile den Namen oder die Abholzeit ein, dann gibt es keine Missverständnisse.",
    v: [{ l: "Reserviert", sym: "clock", top: "", main: "Reserviert", bot: "für ________ bis ____ Uhr" }, { l: "Verkauft", sym: "circle-check", top: "", main: "Verkauft", bot: "Danke! Schau dich gern weiter um" }, { l: "Nicht zu verkaufen", sym: "heart", top: "", main: "Nicht zu verkaufen", bot: "Gehört zur Deko" }],
    b: () => [["Reservieren ohne Ärger", "Vereinbart eine klare Abholzeit und sprecht ab, was passiert, wenn bis dahin niemand kommt. Bei teureren Stücken ist eine kleine Anzahlung eine gute Idee. Schreib die Uhrzeit ruhig mit aufs Schild."],
      ["Verkauft, aber noch da", `Große Möbel bleiben oft bis zum Marktende am Stand stehen. Ein „Verkauft“-Schild erspart dir die immer gleiche Frage. Wie Zurücklegen fair klappt, steht im Ratgeber ${kl("zuruecklegen-lassen-flohmarkt", "Zurücklegen lassen")}.`]],
    f: [["Soll ich bei Reservierungen eine Anzahlung nehmen?", "Bei teureren Stücken ist das sinnvoll. So ist die Reservierung für beide Seiten verbindlicher."],
      ["Kann ich den Namen direkt eintippen?", "Ja, schreib ihn in die kleine Zeile unten. Oder lass die Linien stehen und füll sie am Stand mit Stift aus."]],
    kb: ["zuruecklegen-lassen-flohmarkt", "diebstahl-am-flohmarktstand", "checkliste-flohmarktstand"] },
  { s: "zu-verschenken", fmt: "quer", sym: "gift", chip: "Zu verschenken", short: "Für Restkisten, Hausflur oder Gartenzaun.",
    h1: "Zu-verschenken-Schild: kostenlos gestalten und drucken", title: "Zu verschenken Schild zum Ausdrucken (PDF)",
    desc: "Schild „Zu verschenken“ kostenlos zum Ausdrucken oder als PDF: für Flohmarkt-Reste, Hausflur oder Gartenzaun. Als A4 oder acht kleine Schilder pro Blatt.",
    ans: "Am Ende des Markttags bleibt fast immer etwas übrig. Statt alles wieder einzupacken, stellst du eine Kiste mit „Zu verschenken“ an den Stand. Das Schild funktioniert genauso im Hausflur oder am Gartenzaun.",
    v: [{ l: "Zu verschenken", top: "Kostenlos", main: "Zu verschenken", bot: "Nimm mit, was dir gefällt" }, { l: "Gratis mitnehmen", top: "", main: "Gratis zum Mitnehmen", bot: "Viel Freude damit!" }, { l: "Bitte nur eins", sym: "heart", top: "Kostenlos", main: "Zu verschenken", bot: "Bitte nimm nur, was du brauchst" }],
    b: () => [["Reste sinnvoll loswerden", `Was nach dem Markt übrig ist, findet in einer Verschenkkiste oft noch dankbare Abnehmer. Was danach noch bleibt, kannst du spenden. Ideen dafür findest du im Ratgeber ${kl("reste-nach-dem-flohmarkt", "Nach dem Flohmarkt: Wohin mit den Resten?")}.`],
      ["Damit es ordentlich bleibt", "Stell die Kiste so, dass niemand stolpert, und schau ab und zu, ob alles noch ordentlich aussieht. Bei Regen schützt eine Klarsichthülle das Schild."]],
    f: [["Wann stelle ich die Verschenkkiste raus?", "Am besten in der letzten Stunde des Markts. Vorher nimmst du dir sonst selbst das Geschäft weg."],
      ["Was eignet sich zum Verschenken?", "Alles, was noch funktioniert und sauber ist: Bücher, Geschirr, Deko, Kinderkleidung. Kaputtes gehört nicht in die Kiste."]],
    kb: ["reste-nach-dem-flohmarkt", "second-hand-nachhaltig", "checkliste-flohmarktstand"] },
  // Seit 18.10.: fünf weitere Vorlagen (Hofflohmarkt, Alles muss raus, Bin gleich zurück, Bitte nicht anfassen, Kinderflohmarkt)
  { s: "hofflohmarkt", fmt: "quer", chip: "Hofflohmarkt", short: "Wegweiser mit Pfeil für Hof-, Garagen- und Hausflohmarkt.",
    h1: "Hofflohmarkt-Schild und Wegweiser zum Ausdrucken", title: "Hofflohmarkt-Schild & Wegweiser zum Ausdrucken",
    desc: "Kostenlose Schilder für deinen Hofflohmarkt: Wegweiser mit Pfeil, „Flohmarkt heute“ und Hinweis auf den Hinterhof. Gestalten, drucken oder als PDF speichern.",
    ans: "Bei einem Hofflohmarkt finden die Leute nur zu dir, wenn sie den Weg sehen. Ein Wegweiser an der Straßenecke und ein Schild am Hoftor holen auch Spaziergänger ab, die gar nicht nach einem Flohmarkt gesucht haben. Wähl eine Vorlage, trag Uhrzeit oder Richtung ein und druck gleich mehrere Exemplare.",
    v: [{ l: "Flohmarkt →", top: "Heute", main: "Flohmarkt →", bot: "Einfach reinkommen und stöbern" }, { l: "← Flohmarkt", top: "Heute", main: "← Flohmarkt", bot: "Nur noch ein paar Meter" }, { l: "Hofflohmarkt", sym: "house", top: "Heute bis 16 Uhr", main: "Hofflohmarkt", bot: "Im Hinterhof, das Tor ist offen" }],
    b: () => [["Wo die Schilder hingehören", "Häng ein Schild direkt an den Eingang und weitere an die nächsten Straßenecken, jeweils mit dem Pfeil in deine Richtung. Auf Augenhöhe sieht man sie auch vom Fahrrad aus. Häng sie nur dort auf, wo du darfst, zum Beispiel am eigenen Zaun oder mit Erlaubnis der Hausverwaltung, und nimm sie nach dem Flohmarkt wieder ab."],
      ["Wetterfest und gut lesbar", `Steck jedes Blatt in eine Klarsichthülle und kleb es mit Paketband auf ein Stück Pappe, dann hält es auch bei Wind. Wenige große Wörter liest man von Weitem besser als viele kleine. Wie du den Hofflohmarkt selbst planst, steht im Ratgeber ${kl("hofflohmarkt-organisieren", "Hofflohmarkt organisieren")}.`]],
    f: [["Wie viele Wegweiser brauche ich?", "Meist reichen drei bis fünf: einer am Eingang und je einer an den nächsten Ecken, an denen Leute vorbeikommen. Mit dem Format „8 pro Blatt“ bekommst du zusätzlich kleine Schilder für Briefkästen oder den Hausflur."],
      ["Gibt es das Schild für beide Richtungen?", "Ja. Nimm „Flohmarkt →“ für rechts und „← Flohmarkt“ für links. Geht es geradeaus, lässt du den Pfeil weg und schreibst „Hier entlang“ in die kleine Zeile."]],
    kb: ["hofflohmarkt-organisieren", "kita-flohmarkt-organisieren", "checkliste-flohmarktstand"] },
  { s: "alles-muss-raus", fmt: "quer", sym: "fire", chip: "Alles muss raus", short: "Für die letzte Stunde: Ausverkauf, halber Preis, reduziert.",
    h1: "Alles-muss-raus-Schild für den Flohmarkt zum Ausdrucken", title: "Alles muss raus: Schild zum Ausdrucken (kostenlos)",
    desc: "Schild „Alles muss raus“ für die letzte Stunde am Flohmarktstand, auch als „Alles halber Preis“ oder „Jetzt reduziert“. Kostenlos gestalten und drucken.",
    ans: "In der letzten Stunde zählt jedes Teil, das du nicht wieder einpacken musst. Ein „Alles muss raus“-Schild zeigt allen, dass jetzt die Preise fallen, und lockt auch Leute an, die schon auf dem Heimweg sind. Spruch wählen, drucken und gut sichtbar vorn an den Tisch hängen.",
    v: [{ l: "Alles muss raus", top: "Ausverkauf", main: "Alles muss raus", bot: "Jetzt gibt's die besten Preise" }, { l: "Halber Preis", shape: "stern", sym: "percent", top: "Letzte Stunde", main: "Alles halber Preis", bot: "Gilt für den ganzen Stand" }, { l: "Jetzt reduziert", top: "", main: "Jetzt reduziert", bot: "Frag nach dem neuen Preis" }],
    b: () => [["Der richtige Zeitpunkt", "Häng das Schild erst gegen Ende des Markttags auf, etwa in der letzten Stunde. Vorher verschenkst du Geld bei Stücken, die sich auch zum normalen Preis verkauft hätten. Wertvolle Einzelstücke kannst du vom Rabatt ausnehmen, schreib das dann in die kleine Zeile."],
      ["Kombinieren mit Kisten und Tüten", `Noch besser wirkt das Schild zusammen mit einem <a href="${SIGN_BASE}mengenrabatt/">Mengenrabatt wie „Tüte voll: 5 €“</a>. Was danach noch übrig ist, steht im Ratgeber ${kl("reste-nach-dem-flohmarkt", "Nach dem Flohmarkt: Wohin mit den Resten?")}.`]],
    f: [["Wie stark sollte ich reduzieren?", "Viele halbieren in der letzten Stunde einfach alle Preise. Bei Kleinkram lohnt sich auch ein Festpreis pro Kiste oder Tüte. Wichtig ist, dass der Rabatt auf einen Blick verständlich ist."],
      ["Gilt der Rabatt auch für teure Stücke?", "Das entscheidest du. Wenn nicht, schreib zum Beispiel „außer Möbel“ in die kleine Zeile oder stell die Stücke zur Seite."]],
    kb: ["reste-nach-dem-flohmarkt", "preise-festlegen-flohmarkt", "handeln-auf-dem-flohmarkt"] },
  { s: "bin-gleich-zurueck", fmt: "quer", sym: "clock", chip: "Bin gleich zurück", short: "Für kurze Pausen, damit Interessierte warten statt weitergehen.",
    h1: "Bin-gleich-zurück-Schild für den Flohmarktstand", title: "Bin gleich zurück: Schild zum Ausdrucken für den Stand",
    desc: "Schild „Bin gleich zurück“ für kurze Pausen am Flohmarktstand, auch als „In 5 Minuten wieder da“ oder mit Hinweis auf den Standnachbarn. Kostenlos drucken.",
    ans: "Auch am Flohmarktstand musst du mal weg, für Kaffee, Toilette oder einen kurzen Rundgang. Ein „Bin gleich zurück“-Schild sagt Interessierten, dass sich das Warten lohnt. Wähl einen Spruch und leg das Schild griffbereit in deine Kiste.",
    v: [{ l: "Bin gleich zurück", top: "", main: "Bin gleich zurück", bot: "Schau dich gern schon um" }, { l: "5 Minuten", sym: "mug-hot", top: "Kurze Pause", main: "In 5 Minuten wieder da", bot: "Danke fürs Warten" }, { l: "Frag nebenan", sym: "thumbs-up", top: "Bin gleich zurück", main: "Frag gern nebenan", bot: "Mein Standnachbar hilft dir weiter" }],
    b: () => [["Bevor du gehst", `Nimm Kasse, Handy und kleine wertvolle Stücke mit oder bitte deinen Standnachbarn, ein Auge auf den Stand zu haben. Geld lässt du nie unbeaufsichtigt liegen. Weitere Tipps stehen im Ratgeber ${kl("diebstahl-am-flohmarktstand", "Diebstahl am Flohmarktstand verhindern")}.`],
      ["Gute Nachbarschaft hilft", `Wer sich mit dem Nachbarstand abspricht, kann abwechselnd Pause machen. Die Vorlage „Frag nebenan“ zeigt der Kundschaft, wer in der Zwischenzeit Auskunft gibt. Mehr dazu im Ratgeber ${kl("standnachbarn-flohmarkt", "Gute Standnachbarschaft")}.`]],
    f: [["Kann mein Standnachbar für mich verkaufen?", "Sprecht das am besten vorher ab: ob er nur aufpasst oder auch kassiert, und zu welchen Preisen. Klare Absprachen vermeiden Missverständnisse."],
      ["Wie lange ist „gleich“?", "Halte die Pause kurz und schreib im Zweifel eine Uhrzeit in die kleine Zeile, zum Beispiel „Ab 12:30 Uhr wieder da“. Dann wissen Interessierte, ob sich das Warten lohnt."]],
    kb: ["diebstahl-am-flohmarktstand", "standnachbarn-flohmarkt", "checkliste-flohmarktstand"] },
  { s: "bitte-nicht-anfassen", fmt: "quer", sym: "hand", chip: "Bitte nicht anfassen", short: "Für Zerbrechliches und Vitrinen, freundlich formuliert.",
    h1: "Bitte-nicht-anfassen-Schild für den Flohmarkt", title: "Bitte nicht anfassen: Schild zum Ausdrucken",
    desc: "Freundliches Schild „Bitte nicht anfassen“ für Zerbrechliches, Schmuck und Vitrinen am Flohmarktstand, auch als „Vorsicht zerbrechlich“. Kostenlos drucken.",
    ans: "Auf dem Flohmarkt gehört Anfassen zum Stöbern dazu. Bei Porzellan, Glas, Schmuck oder Sammlerstücken ist ein Hinweis trotzdem sinnvoll. Mit einem freundlichen Satz in der kleinen Zeile wirkt das Schild einladend statt abweisend.",
    v: [{ l: "Bitte nicht anfassen", top: "", main: "Bitte nicht anfassen", bot: "Frag einfach, ich zeig es dir gern" }, { l: "Zerbrechlich", sym: "wine-glass", top: "Vorsicht", main: "Zerbrechlich", bot: "Bitte nur mit Hilfe ansehen" }, { l: "Bitte erst fragen", sym: "heart", top: "Gefällt dir was?", main: "Bitte erst fragen", bot: "Ich hol es dir gern raus" }],
    b: () => [["Wann das Schild sinnvoll ist", "Nutz es sparsam und nur für das, was wirklich empfindlich oder wertvoll ist, etwa eine Vitrine mit Schmuck oder ein Regal mit Porzellan. Steht es überall auf dem Stand, gehen viele lieber weiter."],
      ["So schützt du empfindliche Ware", `Stell Zerbrechliches in die Mitte des Tisches, nicht an die Kante. Kleine wertvolle Teile legst du in eine Schachtel oder Vitrine, die du selbst öffnest. Was Kundschaft beim Anfassen beachten sollte, steht im Ratgeber ${kl("anfassen-flohmarkt", "Anfassen und Stöbern")}.`]],
    f: [["Wirkt das Schild nicht unfreundlich?", "Nicht, wenn du einen netten Satz dazuschreibst, etwa „Frag einfach, ich zeig es dir gern“. So merken die Leute, dass sie willkommen sind."],
      ["Was mache ich, wenn trotzdem etwas kaputtgeht?", "Bleib ruhig und sprich es freundlich an, oft findet sich eine faire Lösung. Gut gekennzeichnete und sicher aufgestellte Ware beugt dem meist vor."]],
    kb: ["anfassen-flohmarkt", "antiquitaeten-erkennen-flohmarkt", "diebstahl-am-flohmarktstand"] },
  { s: "kinderflohmarkt", fmt: "quer", sym: "star", chip: "Kinderflohmarkt", short: "Für den Stand der Kinder: „Hier verkaufen Kinder“ und mehr.",
    h1: "Kinderflohmarkt-Schild zum Ausdrucken: „Hier verkaufen Kinder“", title: "Kinderflohmarkt-Schild zum Ausdrucken: kostenlos",
    desc: "Schilder für den Kinderflohmarkt: „Hier verkaufen Kinder“, Sparziel oder Spielzeug-Kiste. Kostenlos gestalten und drucken, gern zusammen mit deinem Kind.",
    ans: "Auf dem Kinderflohmarkt verkaufen die Kinder oft selbst. Ein eigenes Schild macht sie stolz und zeigt der Kundschaft, dass hier ein bisschen mehr Geduld gefragt ist. Gestaltet es zusammen: Spruch wählen, Text anpassen, drucken.",
    v: [{ l: "Hier verkaufen Kinder", top: "Kinderflohmarkt", main: "Hier verkaufen Kinder", bot: "Danke für eure Geduld beim Rechnen" }, { l: "Sparziel", sym: "piggy-bank", top: "Ich spare auf", main: "Ein neues Fahrrad", bot: "Danke für deinen Einkauf!" }, { l: "Spielzeug-Kiste", sym: "puzzle-piece", top: "Spielzeug-Kiste", main: "Alles 50 Cent", bot: "Such dir was Schönes aus" }],
    b: () => [["Kinder verkaufen lassen", `Lass dein Kind die Preise mit aussuchen und runde auf glatte Beträge wie 50 Cent, 1 € oder 2 €, dann klappt das Rechnen leichter. Ein kleines Kästchen mit Wechselgeld und ein Zettel mit den Preisen helfen zusätzlich. Mehr Tipps stehen im Ratgeber ${kl("kinderflohmarkt-verkaufen", "Auf dem Kinderflohmarkt verkaufen")}.`],
      ["Das Sparziel aufs Schild", "Ein Schild mit Sparziel wie „Ich spare auf ein neues Fahrrad“ kommt bei der Kundschaft gut an und motiviert dein Kind. Trag das Ziel in den großen Text ein, die Zeile darüber bleibt „Ich spare auf“."]],
    f: [["Ab welchem Alter können Kinder selbst verkaufen?", "Das hängt vom Kind ab. Viele Kinder im Grundschulalter haben Spaß daran, wenn ein Erwachsener dabei ist und beim Rechnen hilft."],
      ["Kann mein Kind das Schild selbst gestalten?", "Ja. Lass es den Text eintippen und vor dem Drucken die Vorschau anschauen. Im Sparmodus druckt das Schild ohne gelbe Fläche, dann kann dein Kind es selbst ausmalen."]],
    kb: ["kinderflohmarkt-verkaufen", "flohmarkt-mit-kindern", "kita-flohmarkt-organisieren"] },
  // Seit 18.10. abends: lustige Sprüche, Mädelsflohmarkt (in Pink) und Weihnachten
  { s: "lustige-sprueche", fmt: "quer", chip: "Lustige Sprüche", short: "Sprüche, die zum Schmunzeln bringen und Leute am Stand halten.",
    h1: "Lustige Flohmarkt-Schilder: Sprüche zum Ausdrucken", title: "Lustige Flohmarkt-Sprüche: Schilder zum Ausdrucken",
    desc: "Lustige Sprüche für deinen Flohmarktstand, etwa „Kann Spuren von Erinnerungen enthalten“ oder „Früher Fehlkauf, heute Schnäppchen“. Kostenlos drucken.",
    ans: "Ein Spruch, der zum Schmunzeln bringt, hält Leute einen Moment länger am Stand. Und wer stehen bleibt, schaut sich um und kommt mit dir ins Gespräch. Such dir einen Spruch aus, pass ihn an oder schreib deinen eigenen.",
    v: [{ l: "Spuren von Erinnerungen", sym: "triangle-exclamation", top: "Achtung", main: "Kann Spuren von Erinnerungen enthalten", bot: "Gebraucht, geliebt, gut erhalten" },
      { l: "Fehlkauf", shape: "blase", sym: "face-grin-wink", top: "", main: "Früher Fehlkauf, heute Schnäppchen", bot: "Mein Fehler, dein Glück" },
      { l: "Mein Keller", sym: "box-open", top: "Bitte mitnehmen", main: "Mein Keller will das nicht zurück", bot: "Jedes Teil zählt" },
      { l: "Ausmisten", sym: "dumbbell", top: "", main: "Ausmisten ist mein Sport", bot: "Hilf mir beim Training" },
      { l: "Jetzt bist du dran", sym: "heart", top: "Ich hab's geliebt", main: "Jetzt bist du dran", bot: "Gute Reise, liebes Teil" },
      { l: "Wühlen", sym: "gem", top: "Achtung", main: "Wühlen auf eigene Gefahr", bot: "Schätze möglich, Staub auch" },
      { l: "Moin", shape: "wolke", sym: "sun", top: "Moin!", main: "Schön, dass du da bist", bot: "Stöbern ausdrücklich erwünscht" }],
    b: () => [["Warum ein lustiges Schild hilft", "Auf einem vollen Markt laufen die meisten an den Ständen vorbei. Ein Spruch, über den man schmunzelt, ist ein guter Grund, kurz stehen zu bleiben. Häng das Schild auf Augenhöhe und stell deine schönsten Stücke direkt darunter."],
      ["Eigene Sprüche schreiben", `Kurz gewinnt: Drei bis fünf Wörter im großen Text liest man auch im Vorbeigehen. Die Pointe passt oft gut in die kleine Zeile unten. Freundlich bleibt es, wenn du über dich oder deine Sachen witzelst, nicht über die Kundschaft. Was sonst noch an den Stand gehört, steht in der ${kl("checkliste-flohmarktstand", "Checkliste für deinen Flohmarktstand")}.`]],
    f: [["Darf ich die Sprüche verwenden?", "Ja. Die Sprüche sind von uns, du kannst sie für deinen Stand frei nutzen und nach Lust und Laune ändern."],
      ["Wie lang darf ein Spruch sein?", "Der große Text hat Platz für 40 Zeichen, die Schrift passt sich automatisch an. Am besten wirken kurze Sprüche, die man aus ein paar Metern Entfernung lesen kann."]],
    kb: ["was-verkauft-sich-gut-flohmarkt", "flohmarkt-knigge", "checkliste-flohmarktstand"] },
  { s: "maedelsflohmarkt", fmt: "quer", tone: "pink", chip: "Mädelsflohmarkt", short: "In Pink, mit Krone und Sektglas: Mode, Taschen und Glitzer.",
    h1: "Schilder für den Mädelsflohmarkt: Mode, Taschen und Glitzer", title: "Mädelsflohmarkt-Schilder zum Ausdrucken: kostenlos",
    desc: "Glamouröse Schilder in Pink für Mädels- und Kleiderflohmarkt: „Königliche Preise“, „Anprobieren erwünscht“, „Neu mit Etikett“ und mehr. Kostenlos drucken.",
    ans: "Auf dem Mädelsflohmarkt dreht sich alles um Kleidung, Taschen, Schuhe und Schmuck. Mit den passenden Schildern findet man sich an deinem Stand sofort zurecht und traut sich eher, etwas anzuprobieren. Die Vorlagen sind pink voreingestellt, unter „Fläche“ gibt es auch Gelb, Mint und Schwarz, dazu eine eigene Schriftfarbe wie Gold oder Weiß, eine elegante Schrift und unter „Symbol“ Krone, Sektglas, Diamant und vieles mehr.",
    v: [{ l: "Königliche Preise", sym: "crown", top: "Mädelsflohmarkt", main: "Königliche Preise", bot: "Für alle Queens" },
      { l: "Prickelnde Preise", shape: "wolke", sym: "champagne-glasses", top: "Gönn dir", main: "Prickelnde Preise", bot: "Alles unter 10 €" },
      { l: "Anprobieren erwünscht", shape: "blase", sym: "shirt", top: "", main: "Anprobieren erwünscht", bot: "Der Spiegel steht gleich links" },
      { l: "Kleiderstange", sym: "tag", top: "Kleiderstange", main: "Alles 5 €", bot: "Such dir dein Lieblingsteil aus" },
      { l: "Neu mit Etikett", sym: "wand-magic-sparkles", top: "Nie getragen", main: "Neu mit Etikett", bot: "Zu schön für den Schrank" },
      { l: "Mir zu klein", shape: "blume", sym: "heart", top: "", main: "Mir zu klein, dir perfekt", bot: "Probier es einfach an" },
      { l: "Nix zum Anziehen?", sym: "bag-shopping", top: "Nix zum Anziehen?", main: "Hier schon", bot: "Mode, Taschen und Schuhe" },
      { l: "Glitzer-Ecke", sym: "gem", top: "Schmuck und Accessoires", main: "Glitzer-Ecke", bot: "Alles, was funkelt" },
      { l: "Gold-Edition", sym: "crown", tone: "schwarz", ink: "gold", font: "elegant", top: "Mädelsflohmarkt", main: "Königliche Preise", bot: "Für alle Queens" }],
    b: () => [["So wirkt dein Stand wie eine kleine Boutique", "Häng Kleidung auf eine Stange statt sie zu stapeln und sortier nach Größen. Taschen und Schuhe stehen am besten auf Augenhöhe, Schmuck kommt in eine eigene Ecke mit Schild. Ein Spiegel neben dem Stand verkauft mehr als jeder Rabatt, weil sich die Leute gleich vorstellen können, wie das Teil an ihnen aussieht."],
      ["Preise und Größen auf einen Blick", `Ein Festpreis für die ganze Stange spart Fragen und macht das Stöbern entspannt. Für einzelne Teile nimmst du die <a href="${SIGN_BASE}preisschilder/">Preisschilder</a>, auch die gibt es in Pink. Mit dem Format „8 pro Blatt“ druckst du kleine Größen-Schilder wie „Größe 36 bis 38“ für die Stange. Worauf Käuferinnen bei Vintage achten, steht im Ratgeber ${kl("vintage-kleidung-flohmarkt", "Vintage-Kleidung auf dem Flohmarkt kaufen")}.`]],
    f: [["Kann ich die Schilder auch in Gelb drucken?", "Ja. Unter „Fläche“ wählst du Gelb, Pink, Mint oder Schwarz. Im Sparmodus druckt das Schild ganz ohne Farbfläche, nur mit Rahmen."],
      ["Gibt es die Schrift auch in Gold?", "Ja. Unter „Schriftfarbe“ wählst du Gold, am schönsten auf schwarzer Fläche wie bei der Vorlage „Gold-Edition“. Ein normaler Drucker druckt Gold als warmen Goldton, nicht glänzend. Für echten Glanz druckst du im Sparmodus auf Gold- oder Glitzerpapier."],
      ["Wie viel verlange ich für Kleidung?", `Das hängt von Marke und Zustand ab. Viele setzen für Alltagskleidung einen Festpreis pro Stange und für Markenteile einzelne Preise. Tipps dazu stehen im Ratgeber ${kl("preise-festlegen-flohmarkt", "Preise auf dem Flohmarkt festlegen")}.`]],
    kb: ["vintage-kleidung-flohmarkt", "preise-festlegen-flohmarkt", "was-verkauft-sich-gut-flohmarkt"] },
  { s: "weihnachtsflohmarkt", fmt: "quer", chip: "Weihnachten", short: "Für Advents- und Weihnachtsflohmärkte: Wichtelgeschenke und mehr.",
    h1: "Weihnachtsflohmarkt-Schild: Wichtelgeschenke und Geschenkideen", title: "Weihnachtsflohmarkt-Schild & Wichtel-Schild drucken",
    desc: "Schilder für den Weihnachtsflohmarkt: „Geschenke unter 10 €“ zum Wichteln, „Geschenkideen: alles 5 €“ und mehr. Kostenlos gestalten und drucken.",
    ans: "Im November und Dezember suchen viele auf dem Flohmarkt nach Geschenken, vor allem fürs Wichteln. Ein Schild wie „Geschenke unter 10 €“ zeigt sofort, dass sie bei dir richtig sind. Stell die passenden Stücke zusammen auf einen Tisch oder in eine Kiste und häng das Schild darüber.",
    v: [{ l: "Wichtelgeschenke", sym: "gift", top: "Wichteln?", main: "Geschenke unter 10 €", bot: "Hier wirst du fündig" },
      { l: "Geschenkideen", sym: "snowflake", top: "Geschenkideen", main: "Alles 5 €", bot: "Einpacken musst du selbst" },
      { l: "Schon ausgepackt", sym: "heart", top: "Schon ausgepackt", main: "Trotzdem schön", bot: "Bereit für die zweite Bescherung" }],
    b: () => [["Eine Geschenke-Ecke am Stand", "Sammle alles, was sich gut verschenken lässt, an einer Stelle: Bücher, Spiele, Deko, Geschirr oder Schmuck. Ein fester Preis wie 5 € oder „unter 10 €“ passt genau zu den üblichen Wichtel-Budgets. Wer mag, legt ein paar Geschenktüten oder Bänder dazu."],
      ["Gebraucht schenken", `Was du als Geschenk anbietest, sollte sauber, vollständig und gut in Schuss sein, am besten mit Originalverpackung. Warum Gebrauchtes eine gute Wahl ist, steht im Ratgeber ${kl("second-hand-nachhaltig", "Second Hand und Flohmarkt")}.`]],
    f: [["Wann finden Weihnachtsflohmärkte statt?", "Meist im November und Dezember, oft in Hallen, Schulen oder Gemeindehäusern und an den Adventswochenenden. Für Hamburg stehen alle Termine im <a href=\"/termine/\">Kalender von Flohlotse</a>."],
      ["Welche Preise passen zum Wichteln?", "Viele Wichtelrunden einigen sich auf 5 oder 10 €. Ein Schild mit genau diesem Betrag hilft, schnell das Passende zu finden."]],
    kb: ["second-hand-nachhaltig", "preise-festlegen-flohmarkt", "was-verkauft-sich-gut-flohmarkt"] },
  // Seit 18.10. spätabends: Vintage, Guter Zweck, Kaffee & Kuchen, Getestet (Elektronik)
  { s: "vintage", fmt: "quer", sym: "record-vinyl", chip: "Vintage & Rarität", short: "Für Retro-Schätze, Sammlerstücke und echte Raritäten.",
    h1: "Vintage-Schild für den Flohmarkt: Retro, Rarität, Sammlerstück", title: "Vintage-Schild & Rarität-Schild zum Ausdrucken",
    desc: "Schilder für Vintage und Raritäten am Flohmarktstand: „Echtes Vintage“, „Retro-Ecke“, „Rarität“ oder „Liebhaberstück“. Kostenlos gestalten und drucken.",
    ans: "Alte Schätze verkaufen sich besser, wenn man ihnen ansieht, dass sie etwas Besonderes sind. Ein Vintage- oder Raritäten-Schild lenkt den Blick auf deine besten Stücke und erklärt auch mal einen höheren Preis. Spruch wählen, Symbol aussuchen, drucken.",
    v: [{ l: "Echtes Vintage", sym: "star", top: "Original", main: "Echtes Vintage", bot: "Älter als dein Smartphone" },
      { l: "Retro-Ecke", top: "Zeitreise gefällig?", main: "Retro-Ecke", bot: "Platten, Kameras und mehr" },
      { l: "Rarität", sym: "gem", top: "Für Sammler", main: "Rarität", bot: "Frag mich nach der Geschichte" },
      { l: "Liebhaberstück", sym: "heart", top: "", main: "Liebhaberstück", bot: "Preis auf Anfrage" },
      { l: "Omas Schätze", sym: "box-open", top: "Aus Omas Schrank", main: "Omas Schätze", bot: "Mit Geschichte, ohne Staub" }],
    b: () => [["Was als Vintage gilt", "Als Vintage bezeichnet man meist Kleidung und Gegenstände, die mindestens 20 Jahre alt sind. Antiquitäten sind in der Regel deutlich älter. Schreib aufs Schild nur, was stimmt: Wer „Original“ verspricht, sollte sich sicher sein."],
      ["Raritäten richtig zeigen", `Stell besondere Stücke etwas abseits vom Wühltisch auf, am besten auf ein Tuch oder in eine kleine Vitrine. Erzähl ruhig die Geschichte dazu, das macht neugierig. Wie man Antiquitäten erkennt, steht im Ratgeber ${kl("antiquitaeten-erkennen-flohmarkt", "Antiquitäten auf dem Flohmarkt erkennen")}.`]],
    f: [["Wie preise ich Raritäten aus?", "Schau vorher nach, was vergleichbare Stücke gebraucht kosten, zum Beispiel auf Verkaufsportalen. Setz den Preis mit etwas Spielraum an oder schreib „Preis auf Anfrage“, dann kommst du ins Gespräch."],
      ["Was heißt Liebhaberstück?", "So nennt man ein Stück, das vor allem für Sammler oder Fans einen besonderen Wert hat, etwa eine seltene Schallplatte oder eine alte Kamera."]],
    kb: ["antiquitaeten-erkennen-flohmarkt", "schallplatten-flohmarkt", "vintage-kleidung-flohmarkt"] },
  { s: "guter-zweck", fmt: "quer", sym: "hand-holding-heart", chip: "Guter Zweck", short: "Für Spenden, Klassenkasse und Flohmärkte mit gutem Zweck.",
    h1: "Schild „Für den guten Zweck“: Spenden am Flohmarktstand", title: "Spendenschild „Für den guten Zweck“ zum Ausdrucken",
    desc: "Schilder für Flohmärkte mit gutem Zweck: „Erlös für den guten Zweck“, „Zahl, was du willst“ oder „Für die Klassenkasse“. Kostenlos gestalten und drucken.",
    ans: "Wenn der Erlös an einen guten Zweck geht, geben viele gern etwas mehr. Ein Schild macht das sichtbar und erklärt, wofür das Geld gedacht ist. Trag in die kleine Zeile ein, wer das Geld bekommt, dann wirkt es gleich glaubwürdiger.",
    v: [{ l: "Guter Zweck", top: "", main: "Für den guten Zweck", bot: "Der Erlös geht an ________" },
      { l: "Zahl, was du willst", sym: "coins", top: "Kein fester Preis", main: "Zahl, was du willst", bot: "Jeder Euro hilft" },
      { l: "Klassenkasse", sym: "star", top: "Unser Flohmarkt", main: "Für die Klassenkasse", bot: "Danke für deine Unterstützung" },
      { l: "Spenden willkommen", sym: "piggy-bank", top: "", main: "Spenden willkommen", bot: "Hier rein, bitte" }],
    b: () => [["Glaubwürdig sammeln", "Schreib dazu, wem das Geld zugutekommt, zum Beispiel dem Förderverein der Kita oder einem Tierheim. Eine verschlossene Spendendose wirkt vertrauenswürdiger als eine offene Schale. Wer mag, legt einen Flyer der Einrichtung daneben."],
      ["Zahl, was du willst", `Ohne festen Preis zahlen viele einen fairen Betrag, und niemand muss lange verhandeln. Für teurere Stücke kannst du trotzdem einen Mindestpreis nennen. Wie ihr einen Flohmarkt für Kita oder Schule plant, steht im Ratgeber ${kl("kita-flohmarkt-organisieren", "Kita- oder Schulflohmarkt organisieren")}.`]],
    f: [["Was schreibe ich in die kleine Zeile?", "Am besten, wer das Geld bekommt, zum Beispiel „Der Erlös geht an den Förderverein“. Die Linie kannst du auch frei lassen und am Stand mit Stift ausfüllen."],
      ["Lohnt sich „Zahl, was du willst“?", "Bei Kleinkram und Kinderkleidung klappt das oft gut, weil niemand lange verhandeln muss. Bei wertvollen Stücken nennst du lieber einen festen Preis."]],
    kb: ["kita-flohmarkt-organisieren", "second-hand-nachhaltig", "reste-nach-dem-flohmarkt"] },
  { s: "kaffee-und-kuchen", fmt: "quer", sym: "mug-hot", chip: "Kaffee & Kuchen", short: "Für Kuchenbuffet, Waffeln und Getränke beim Flohmarkt.",
    h1: "Kaffee-und-Kuchen-Schild für Flohmarkt und Kuchenverkauf", title: "Kaffee & Kuchen: Schild für den Flohmarkt drucken",
    desc: "Schilder für den Kuchenverkauf auf dem Flohmarkt: „Kaffee & Kuchen“, „Waffeln 2 €“, „Stück 1,50 €“ und „Kalte Getränke“. Kostenlos gestalten und drucken.",
    ans: "Auf Hof-, Kita- und Schulflohmärkten gehört ein Kuchenbuffet oft dazu. Mit einem gut sichtbaren Schild finden die Leute den Stand sofort, und die Preise stehen gleich dran. Wähl eine Vorlage, trag deine Preise ein und druck sie aus.",
    v: [{ l: "Kaffee & Kuchen", top: "Pause gefällig?", main: "Kaffee & Kuchen", bot: "Alles selbst gebacken" },
      { l: "Waffeln", sym: "cookie", top: "Frisch aus dem Eisen", main: "Waffeln 2 €", bot: "Mit Puderzucker" },
      { l: "Kuchenstück", sym: "cake-candles", top: "Kuchenbuffet", main: "Stück 1,50 €", bot: "Solange der Vorrat reicht" },
      { l: "Kalte Getränke", sym: "lemon", top: "Durst?", main: "Kalte Getränke", bot: "Wasser, Saft und Limo" }],
    b: () => [["Was am Kuchenstand gut läuft", "Blechkuchen lässt sich leicht portionieren und transportieren, Muffins brauchen nicht einmal einen Teller. Ein Schild mit klaren Preisen pro Stück erspart dir das Rechnen, und mit passendem Wechselgeld geht es schneller."],
      ["Vorher beim Veranstalter fragen", `Ob auf dem Markt Essen und Getränke verkauft werden dürfen, klärst du am besten vorher mit dem Veranstalter. Wie ihr einen Hofflohmarkt mit allem Drum und Dran plant, steht im Ratgeber ${kl("hofflohmarkt-organisieren", "Hofflohmarkt organisieren")}.`]],
    f: [["Was kostet ein Stück Kuchen auf dem Flohmarkt?", "Das legt jeder Stand selbst fest. Viele nehmen runde Preise wie 1 oder 2 € pro Stück, dann fällt das Rechnen leichter."],
      ["Kann ich die Preise ändern?", "Ja, tipp einfach deinen Preis in den großen Text. Mit dem Format „8 pro Blatt“ bekommst du kleine Schilder für jede Kuchensorte."]],
    kb: ["hofflohmarkt-organisieren", "kita-flohmarkt-organisieren", "wechselgeld-flohmarkt"] },
  { s: "getestet", fmt: "quer", sym: "circle-check", chip: "Getestet", short: "Für Elektronik: getestet, ungetestet oder für Bastler.",
    h1: "Getestet-Schild für Elektronik auf dem Flohmarkt", title: "Getestet-Schild für Elektronik: zum Ausdrucken",
    desc: "Schilder für Elektronik am Flohmarktstand: „Getestet und funktioniert“, „Ungetestet“ oder „Für Bastler“. Ehrlich gekennzeichnet, kostenlos zum Ausdrucken.",
    ans: "Bei Elektronik ist die erste Frage fast immer: Geht das noch? Ein Schild beantwortet sie, bevor jemand fragt, und schafft Vertrauen. Kennzeichne ehrlich, was du getestet hast und was nicht.",
    v: [{ l: "Getestet", top: "Elektronik", main: "Getestet und funktioniert", bot: "Gern vor Ort ausprobieren" },
      { l: "Ungetestet", sym: "circle-question", top: "Elektronik", main: "Ungetestet", bot: "Darum günstiger" },
      { l: "Für Bastler", sym: "screwdriver-wrench", top: "Defekt", main: "Für Bastler", bot: "Für Ersatzteile oder zum Reparieren" }],
    b: () => [["Ehrlich kennzeichnen", "Schreib nur „getestet“ an Geräte, die du wirklich ausprobiert hast. Defekte Geräte kennzeichnest du deutlich als „Für Bastler“ und setzt den Preis entsprechend niedrig. So gibt es hinterher keine Diskussionen."],
      ["Ausprobieren am Stand", `Batterien für Fernbedienungen, Spiele oder Taschenlampen sind schnell eingelegt und überzeugen mehr als jedes Versprechen. Worauf Käufer bei Elektrogeräten achten, steht im Ratgeber ${kl("elektrogeraete-flohmarkt", "Elektrogeräte vom Flohmarkt")}.`]],
    f: [["Was schreibe ich bei teilweise defekten Geräten?", "Nenn den Fehler in der kleinen Zeile, zum Beispiel „Lautsprecher knistert“ oder „Akku hält nur kurz“. Je genauer, desto eher findet sich jemand, der genau das reparieren kann."],
      ["Brauche ich Strom zum Testen?", "Auf vielen Flohmärkten gibt es keine Steckdose. Batteriegeräte führst du mit frischen Batterien vor, für andere reicht ein kurzes Video vom Test zu Hause auf dem Handy."]],
    kb: ["elektrogeraete-flohmarkt", "gekauft-wie-gesehen", "preise-festlegen-flohmarkt"] }
];
const SIGN_BY = Object.fromEntries(SIGNS.map(t => [t.s, t]));
for (const sp of ["/", TIPS_P]) { const hp = pages.get(sp); if (hp) hp.html = hp.html.split("%%SIGN_N%%").join(String(SIGNS.length)); }
const signUrl = t => SIGN_BASE + t.s + "/";
const SIGN_PAGE_IMGS = new Map(); // für die Bild-Sitemap

// Startzustand einer Vorlage (erste Variante)
// Farben der Schildfläche: Gelb (Standard), Pink und Mint. Eine Vorlage kann eine andere Farbe voreinstellen (tone).
const TONES = { gelb: ["Gelb", "#F6E03A"], pink: ["Pink", "#FF8FC0"], mint: ["Mint", "#8EE3C1"], schwarz: ["Schwarz", "#15211B"] };
// Schriftfarbe des großen Texts. Gold ist ein Goldton mit leichtem Verlauf (gedruckt nicht glänzend).
const INKS = { schwarz: ["Schwarz", "#15211B"], weiss: ["Weiß", "#FFFFFF"], gold: ["Gold", "#C9A13B"], pink: ["Pink", "#FF8FC0"] };
// Erlaubte Paare, erste Farbe = Standard. Weiß und Gold auf heller Fläche bekommen automatisch eine dunkle Kontur (Klasse ink-out), damit sie lesbar bleiben.
const INK_OK = { gelb: ["schwarz", "weiss"], pink: ["schwarz", "weiss", "gold"], mint: ["schwarz", "weiss", "gold"], schwarz: ["weiss", "gold", "pink"], save: ["schwarz", "gold", "pink"] };
const inkOut = st => { const k = st.ink || inkDefault(st.tone); return (k === "weiss" || k === "gold") && (st.save || (st.tone || "gelb") !== "schwarz"); };
// Formen der Farbfläche. Die genaue Form rechnet site.js passend zur Größe aus; hier nur die kleinen Bilder für die Auswahl.
const SHAPES = [["rund", "Klassisch"], ["wolke", "Wolke"], ["blume", "Blume"], ["stern", "Stern"], ["blase", "Sprechblase"], ["etikett", "Etikett"]];
const shapeOk = k => SHAPES.some(([x]) => x === k);
// gleiche Rechnung wie shapePath in site.js (für die Auswahlbilder)
function shapePath(k, w, h) {
  const p = Math.max(1.5, Math.min(w, h) * 0.02), f = n => Math.round(n * 10) / 10, m = Math.min(w, h);
  if (k === "wolke" || k === "blume") {
    const r = k === "wolke" ? m * 0.14 : m * 0.1, x0 = p + r, y0 = p + r, x1 = w - p - r, y1 = h - p - r, pts = [];
    const side = (ax, ay, bx, by) => { const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / (2 * r))); for (let i = 0; i < n; i++) { let t = i / n; if (k === "wolke" && i > 0) t += (i % 2 ? 0.16 : -0.1) / n; pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]); } };
    side(x0, y0, x1, y0); side(x1, y0, x1, y1); side(x1, y1, x0, y1); side(x0, y1, x0, y0);
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length], c = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2; d += `A${f(c)} ${f(c)} 0 0 1 ${f(b[0])} ${f(b[1])}`; }
    return d + "Z";
  }
  if (k === "stern") { // Stern wie ein Preis-Aufkleber („Knaller“), passt sich als Oval der Fläche an
    const cx = w / 2, cy = h / 2, a = w / 2 - p, b = h / 2 - p, n = Math.max(16, Math.min(30, Math.round(Math.PI * (a + b) / (m * 0.2)))), pts = [];
    for (let i = 0; i < n * 2; i++) { const ang = -Math.PI / 2 + i * Math.PI / n, k2 = i % 2 ? 0.84 : 1; pts.push([cx + Math.cos(ang) * a * k2, cy + Math.sin(ang) * b * k2]); }
    return "M" + pts.map(q => f(q[0]) + " " + f(q[1])).join("L") + "Z";
  }
  if (k === "blase") {
    const R = m * 0.18, th = h * 0.17, x0 = p, y0 = p, x1 = w - p, y1 = h - p - th, tx = x0 + (x1 - x0) * 0.2;
    return `M${f(x0 + R)} ${f(y0)}H${f(x1 - R)}Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + R)}V${f(y1 - R)}Q${f(x1)} ${f(y1)} ${f(x1 - R)} ${f(y1)}H${f(tx + th * 1.2)}L${f(tx - th * 0.25)} ${f(h - p)}L${f(tx)} ${f(y1)}H${f(x0 + R)}Q${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - R)}V${f(y0 + R)}Q${f(x0)} ${f(y0)} ${f(x0 + R)} ${f(y0)}Z`;
  }
  if (k === "etikett") {
    const tip = Math.min(h * 0.42, w * 0.17), R = m * 0.09, x0 = p, y0 = p, x1 = w - p, y1 = h - p, cy = h / 2, hr = m * 0.06, hx = x0 + tip * 0.85;
    return `M${f(x0 + tip)} ${f(y0)}H${f(x1 - R)}Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + R)}V${f(y1 - R)}Q${f(x1)} ${f(y1)} ${f(x1 - R)} ${f(y1)}H${f(x0 + tip)}L${f(x0)} ${f(cy)}Z`
      + `M${f(hx + hr)} ${f(cy)}A${f(hr)} ${f(hr)} 0 1 0 ${f(hx - hr)} ${f(cy)}A${f(hr)} ${f(hr)} 0 1 0 ${f(hx + hr)} ${f(cy)}Z`;
  }
  const R = m * 0.14; return `M${f(p + R)} ${f(p)}H${f(w - p - R)}Q${f(w - p)} ${f(p)} ${f(w - p)} ${f(p + R)}V${f(h - p - R)}Q${f(w - p)} ${f(h - p)} ${f(w - p - R)} ${f(h - p)}H${f(p + R)}Q${f(p)} ${f(h - p)} ${f(p)} ${f(h - p - R)}V${f(p + R)}Q${f(p)} ${f(p)} ${f(p + R)} ${f(p)}Z`;
}
const inkDefault = tone => INK_OK[tone || "gelb"][0];
// Schriften für den Schildtext; eine Schrift erscheint nur, wenn ihre Datei im Ordner fonts liegt
const SIGN_FONTS = [["modern", "Modern", "Bricolage Grotesque"], ["klar", "Klar", "Figtree"], ["elegant", "Elegant", "Fraunces"], ["verspielt", "Verspielt", "Pacifico"]].filter(([k, , fam]) => k === "modern" || fontsFound.some(x => x.fam === fam));
const fontOk = k => SIGN_FONTS.some(([x]) => x === k);
// Symbole für die Schilder: Font Awesome Free 7.1.0 (Solid), Lizenz CC BY 4.0, Copyright 2025 Fonticons, Inc., unverändert übernommen.
// Kräftige, gefüllte Formen passen zur fetten Schilder-Schrift. [Beschriftung, viewBox, Pfad]
const SYM = {
  "crown": ["Krone", "0 0 576 512", "M313 87.2c9.2-7.3 15-18.6 15-31.2 0-22.1-17.9-40-40-40s-40 17.9-40 40c0 12.6 5.9 23.9 15 31.2l-68.4 107.6c-10 15.7-31.3 19.6-46.2 8.4l-59.5-44.5c4.5-6.4 7.1-14.3 7.1-22.7 0-22.1-17.9-40-40-40s-40 17.9-40 40c0 21.8 17.5 39.6 39.2 40l32.6 217.5c4.7 31.3 31.6 54.5 63.3 54.5h273.8c31.7 0 58.6-23.2 63.3-54.5L520.8 176c21.7-.4 39.2-18.2 39.2-40 0-22.1-17.9-40-40-40s-40 17.9-40 40c0 8.4 2.6 16.3 7.1 22.7l-59.4 44.6c-14.9 11.2-36.2 7.3-46.2-8.4z"],
  "champagne-glasses": ["Sekt", "0 0 640 512", "M155.6 17.3C163 3 179.9-3.6 195 1.9l125 45.6L445 1.9c15.1-5.5 32 1.1 39.4 15.4l78.8 152.9c28.8 55.8 10.3 122.3-38.5 156.6L556 413l41-15c16.6-6 35 2.5 41 19.1s-2.5 35-19.1 41c-47.4 17.3-94.8 34.5-142.2 51.8-16.6 6.1-35-2.5-41-19.1s2.5-35 19.1-41l41-15-31.3-86.2c-59.4 5.2-116.2-33.9-130-95.2l-14.6-64.7-14.6 64.7c-13.8 61.3-70.6 100.4-130 95.2L144 434.8l41 15c16.6 6.1 25.2 24.4 19.1 41s-24.4 25.2-41 19.1c-47.4-17.3-94.8-34.6-142.2-51.8-16.6-6.1-25.2-24.4-19.1-41S26.3 392 42.9 398l41 15 31.3-86.2C66.5 292.5 48.1 226 76.9 170.2zm44 54.4-27.2 52.8 89.2 32.5 13.1-57.9zm240.9 0-75.1 27.4 13.1 57.9 89.2-32.5z"],
  "gem": ["Diamant", "0 0 512 512", "M116.7 33.8c4.5-6.1 11.7-9.8 19.3-9.8h240c7.6 0 14.8 3.6 19.3 9.8l112 152c6.8 9.2 6.1 21.9-1.5 30.4l-232 256c-4.5 5-11 7.9-17.8 7.9s-13.2-2.9-17.8-7.9l-232-256c-7.7-8.5-8.3-21.2-1.5-30.4zm38.5 39.8c-3.3 2.5-4.2 7-2.1 10.5l57.4 95.7L63.3 192c-4.1.3-7.3 3.8-7.3 8s3.2 7.6 7.3 8l192 16h1.3l192-16c4.1-.3 7.3-3.8 7.3-8s-3.2-7.6-7.3-8l-147.2-12.3 57.4-95.6c2.1-3.5 1.2-8.1-2.1-10.5s-7.9-2-10.7 1l-90 97.6-90.1-97.6c-2.8-3-7.4-3.4-10.7-1"],
  "wand-magic-sparkles": ["Glitzer", "0 0 576 512", "m263.4-27 14.8 36.8L315 24.6c3 1.2 5 4.2 5 7.4s-2 6.2-5 7.4l-36.8 14.8L263.4 91c-1.2 3-4.2 5-7.4 5s-6.2-2-7.4-5l-14.8-36.8L197 39.4c-3-1.2-5-4.2-5-7.4s2-6.2 5-7.4l36.8-14.8L248.6-27c1.2-3 4.2-5 7.4-5s6.2 2 7.4 5M110.7 41.7l21.5 50.1 50.1 21.5c5.9 2.5 9.7 8.3 9.7 14.7s-3.8 12.2-9.7 14.7l-50.1 21.5-21.5 50.1c-2.5 5.9-8.3 9.7-14.7 9.7s-12.2-3.8-14.7-9.7l-21.5-50.1-50.1-21.5C3.8 140.2 0 134.4 0 128s3.8-12.2 9.7-14.7l50.1-21.5 21.5-50.1C83.8 35.8 89.6 32 96 32s12.2 3.8 14.7 9.7M464 304c6.4 0 12.2 3.8 14.7 9.7l21.5 50.1 50.1 21.5c5.9 2.5 9.7 8.3 9.7 14.7s-3.8 12.2-9.7 14.7l-50.1 21.5-21.5 50.1c-2.5 5.9-8.3 9.7-14.7 9.7s-12.2-3.8-14.7-9.7l-21.5-50.1-50.1-21.5c-5.9-2.5-9.7-8.3-9.7-14.7s3.8-12.2 9.7-14.7l50.1-21.5 21.5-50.1c2.5-5.9 8.3-9.7 14.7-9.7M460 0c11 0 21.6 4.4 29.5 12.2l42.3 42.3C539.6 62.4 544 73 544 84s-4.4 21.6-12.2 29.5l-88.2 88.2-101.3-101.3 88.2-88.2C438.4 4.4 449 0 460 0M44.2 398.5l264.2-264.2 101.3 101.3-264.2 264.2C137.6 507.6 127 512 116 512s-21.6-4.4-29.5-12.2l-42.3-42.3C36.4 449.6 32 439 32 428s4.4-21.6 12.2-29.5"],
  "heart": ["Herz", "0 0 512 512", "m241 87.1 15 20.7 15-20.7C296 52.5 336.2 32 378.9 32 452.4 32 512 91.6 512 165.1v2.6c0 112.2-139.9 242.5-212.9 298.2-12.4 9.4-27.6 14.1-43.1 14.1s-30.8-4.6-43.1-14.1C139.9 410.2 0 279.9 0 167.7v-2.6C0 91.6 59.6 32 133.1 32 175.8 32 216 52.5 241 87.1"],
  "star": ["Stern", "0 0 576 512", "M309.5-18.9c-4.1-8-12.4-13.1-21.4-13.1s-17.3 5.1-21.4 13.1l-73.6 144.2-159.9 25.4c-8.9 1.4-16.3 7.7-19.1 16.3s-.5 18 5.8 24.4l114.4 114.5-25.2 159.9c-1.4 8.9 2.3 17.9 9.6 23.2s16.9 6.1 25 2l144.4-73.4L432.4 491c8 4.1 17.7 3.3 25-2s11-14.2 9.6-23.2l-25.3-159.9 114.4-114.5c6.4-6.4 8.6-15.8 5.8-24.4s-10.1-14.9-19.1-16.3L383 125.3z"],
  "bag-shopping": ["Tasche", "0 0 448 512", "M160 80c0-35.3 28.7-64 64-64s64 28.7 64 64v48H160zm-48 48H48c-26.5 0-48 21.5-48 48v208c0 53 43 96 96 96h256c53 0 96-43 96-96V176c0-26.5-21.5-48-48-48h-64V80c0-61.9-50.1-112-112-112S112 18.1 112 80zm24 48a24 24 0 1 1 0 48 24 24 0 1 1 0-48m152 24a24 24 0 1 1 48 0 24 24 0 1 1-48 0"],
  "shirt": ["Shirt", "0 0 640 512", "M320.2 112c44.2 0 80-35.8 80-80h53.5c17 0 33.3 6.7 45.3 18.7l118.6 118.7c12.5 12.5 12.5 32.8 0 45.3l-50.7 50.7c-12.5 12.5-32.8 12.5-45.3 0L480.2 224v224c0 35.3-28.7 64-64 64h-192c-35.3 0-64-28.7-64-64V224l-41.4 41.4c-12.5 12.5-32.8 12.5-45.3 0l-50.6-50.8c-12.5-12.5-12.5-32.8 0-45.3L141.5 50.7c12-12 28.3-18.7 45.3-18.7h53.5c0 44.2 35.8 80 80 80z"],
  "glasses": ["Brille", "0 0 576 512", "M143.3 96c-14 0-26.5 9.2-30.6 22.6L70.4 256H224c17.7 0 32 14.3 32 32h64c0-17.7 14.3-32 32-32h153.6l-42.3-137.4c-4.1-13.4-16.5-22.6-30.6-22.6H400c-17.7 0-32-14.3-32-32s14.3-32 32-32h32.7c42.1 0 79.4 27.5 91.8 67.8l45.4 147.5c4.1 13.2 6.1 26.9 6.1 40.7v96c0 53-43 96-96 96h-64c-53 0-96-43-96-96v-32h-64v32c0 53-43 96-96 96H96c-53 0-96-43-96-96v-96c0-13.8 2.1-27.5 6.1-40.7L51.5 99.8C63.9 59.5 101.1 32 143.3 32H176c17.7 0 32 14.3 32 32s-14.3 32-32 32zM64 320v64c0 17.7 14.3 32 32 32h64c17.7 0 32-14.3 32-32v-64zm416 96c17.7 0 32-14.3 32-32v-64H384v64c0 17.7 14.3 32 32 32z"],
  "tag": ["Preisschild", "0 0 512 512", "M32.5 96v149.5c0 17 6.7 33.3 18.7 45.3l192 192c25 25 65.5 25 90.5 0l149.5-149.5c25-25 25-65.5 0-90.5l-192-192C279.2 38.7 263 32 246 32H96.5c-35.3 0-64 28.7-64 64m112 16a32 32 0 1 1 0 64 32 32 0 1 1 0-64"],
  "percent": ["Prozent", "0 0 448 512", "M192 128a96 96 0 1 0-192 0 96 96 0 1 0 192 0m256 256a96 96 0 1 0-192 0 96 96 0 1 0 192 0m-9.4-297.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-384 384c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0z"],
  "coins": ["Münzen", "0 0 512 512", "M128 96V80c0-44.2 86-80 192-80s192 35.8 192 80v16c0 30.6-41.3 57.2-102 70.7-2.4-2.8-4.9-5.5-7.4-8-15.5-15.3-35.5-26.9-56.4-35.5-41.9-17.5-96.5-27.1-154.2-27.1-21.9 0-43.3 1.4-63.8 4.1-.2-1.3-.2-2.7-.2-4.1zm304 257v-46.2c15.1-3.9 29.3-8.5 42.2-13.9 13.2-5.5 26.1-12.2 37.8-20.3V288c0 26.8-31.5 50.5-80 65m0-96v-33c0-4.5-.4-8.8-1-13 15.5-3.9 30-8.6 43.2-14.2s26.1-12.2 37.8-20.3v15.4c0 26.8-31.5 50.5-80 65zM0 240v-16c0-44.2 86-80 192-80s192 35.8 192 80v16c0 44.2-86 80-192 80S0 284.2 0 240m384 96c0 44.2-86 80-192 80S0 380.2 0 336v-15.4c11.6 8.1 24.5 14.7 37.8 20.3C79.7 358.4 134.3 368 192 368s112.3-9.7 154.2-27.1c13.2-5.5 26.1-12.2 37.8-20.3zm0 80.6V432c0 44.2-86 80-192 80S0 476.2 0 432v-15.4c11.6 8.1 24.5 14.7 37.8 20.3C79.7 454.4 134.3 464 192 464s112.3-9.7 154.2-27.1c13.2-5.5 26.1-12.2 37.8-20.3"],
  "piggy-bank": ["Sparschwein", "0 0 576 512", "M288-32a96 96 0 1 1 0 192 96 96 0 1 1 0-192M48 304c0-70.1 47-131.4 117.1-164.9C190.4 180.4 236 208 288 208c55.7 0 104.1-31.7 128-78 15.8-11.3 35.1-18 56-18h19.5c10.4 0 18 9.8 15.5 19.9l-17.1 68.3c9.9 12.4 18.2 25.7 24.4 39.8H536c13.3 0 24 10.7 24 24v112c0 13.3-10.7 24-24 24h-40c-16.5 22-38.5 39.6-64 50.7V480c0 17.7-14.3 32-32 32h-33c-14.3 0-26.8-9.5-30.8-23.2l-7.1-24.8h-82.3l-7.1 24.8c-3.9 13.7-16.4 23.2-30.7 23.2h-33c-17.7 0-32-14.3-32-32v-29.3C87.5 426 48 369.6 48 304m376 16a24 24 0 1 0 0-48 24 24 0 1 0 0 48"],
  "wallet": ["Geldbörse", "0 0 512 512", "M64 32C28.7 32 0 60.7 0 96v288c0 35.3 28.7 64 64 64h384c35.3 0 64-28.7 64-64V192c0-35.3-28.7-64-64-64H72c-13.3 0-24-10.7-24-24s10.7-24 24-24h384c13.3 0 24-10.7 24-24s-10.7-24-24-24zm352 224a32 32 0 1 1 0 64 32 32 0 1 1 0-64"],
  "gift": ["Geschenk", "0 0 512 512", "M321.5 68.8c7.6-12.9 21.4-20.8 36.3-20.8h2.2c22.1 0 40 17.9 40 40s-17.9 40-40 40h-73.3zm-131 0 34.8 59.2H152c-22.1 0-40-17.9-40-40s17.9-40 40-40h2.2c14.9 0 28.8 7.9 36.3 20.8m89.6-24.3-24.1 41-24.1-41C215.7 16.9 186.1 0 154.2 0H152c-48.6 0-88 39.4-88 88 0 14.4 3.5 28 9.6 40H32c-17.7 0-32 14.3-32 32v32c0 17.7 14.3 32 32 32h448c17.7 0 32-14.3 32-32v-32c0-17.7-14.3-32-32-32h-41.6c6.1-12 9.6-25.6 9.6-40 0-48.6-39.4-88-88-88h-2.2c-31.9 0-61.5 16.9-77.7 44.4zM480 272H280v208h136c35.3 0 64-28.7 64-64zm-248 0H32v144c0 35.3 28.7 64 64 64h136z"],
  "snowflake": ["Schneeflocke", "0 0 512 512", "M288.2 0c0-17.7-14.3-32-32-32s-32 14.3-32 32v62.1l-15-15c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l49 49v70.6l-61.2-35.3-17.9-66.9c-3.4-12.8-16.6-20.4-29.4-17S95.3 98 98.7 110.8l5.5 20.5-53.7-31C35.2 91.5 15.6 96.7 6.8 112s-3.6 34.9 11.7 43.7l53.7 31-20.5 5.5c-12.8 3.4-20.4 16.6-17 29.4s16.6 20.4 29.4 17l66.9-17.9 61.2 35.3-61.2 35.3-66.9-17.9c-12.8-3.4-26 4.2-29.4 17s4.2 26 17 29.4l20.5 5.5-53.7 31C3.2 365.1-2 384.7 6.8 400s28.4 20.6 43.7 11.7l53.7-31-5.5 20.5c-3.4 12.8 4.2 26 17 29.4s26-4.2 29.4-17l17.9-66.9 61.2-35.3V382l-49 49c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l15-15V512c0 17.7 14.3 32 32 32s32-14.3 32-32v-62.1l15 15c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-49-49v-70.6l61.2 35.3 17.9 66.9c3.4 12.8 16.6 20.4 29.4 17s20.4-16.6 17-29.4l-5.5-20.5 53.7 31c15.3 8.8 34.9 3.6 43.7-11.7s3.6-34.9-11.7-43.7l-53.7-31 20.5-5.5c12.8-3.4 20.4-16.6 17-29.4s-16.6-20.4-29.4-17l-66.9 17.9L320 256l61.2-35.3 66.9 17.9c12.8 3.4 26-4.2 29.4-17s-4.2-26-17-29.4l-20.5-5.5 53.7-31c15.3-8.8 20.6-28.4 11.7-43.7s-28.4-20.5-43.7-11.7l-53.7 31 5.5-20.5c3.4-12.8-4.2-26-17-29.4s-26 4.2-29.4 17l-17.9 66.9-61.2 35.3V130l49-49c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-15 15V0z"],
  "sun": ["Sonne", "0 0 576 512", "M178.2-10.1c7.4-3.1 15.8-2.2 22.5 2.2l87.8 58.2 87.8-58.2c6.7-4.4 15.1-5.2 22.5-2.2S411.4-.5 413 7.3l20.9 103.2 103.2 20.9c7.8 1.6 14.4 7 17.4 14.3s2.2 15.8-2.2 22.5L494.1 256l58.2 87.8c4.4 6.7 5.2 15.1 2.2 22.5s-9.6 12.8-17.4 14.3l-103.3 20.8L413 504.7c-1.6 7.8-7 14.4-14.3 17.4s-15.8 2.2-22.5-2.2l-87.8-58.2-87.8 58.2c-6.7 4.4-15.1 5.2-22.5 2.2s-12.8-9.6-14.3-17.4L143 401.4 39.7 380.5c-7.8-1.6-14.4-7-17.4-14.3s-2.2-15.8 2.2-22.5L82.7 256l-58.2-87.8c-4.4-6.7-5.2-15.1-2.2-22.5s9.6-12.8 17.4-14.3L143 110.6 163.9 7.3c1.6-7.8 7-14.4 14.3-17.4M207.6 256a80.4 80.4 0 1 1 160.8 0 80.4 80.4 0 1 1-160.8 0m208.8 0a128.4 128.4 0 1 0-256.8 0 128.4 128.4 0 1 0 256.8 0"],
  "umbrella": ["Regenschirm", "0 0 512 512", "M256-32c17.7 0 32 14.3 32 32v2c126.3 15.7 224 123.5 224 254 0 3.8-.1 7.5-.2 11.3-.3 6.9-5 12.8-11.7 14.7s-13.8-.7-17.6-6.5C468.1 254.1 443.7 240 416 240c-29.3 0-54.9 15.7-68.9 39.3-2.7 4.6-7.6 7.6-13 7.8s-10.5-2.2-13.7-6.5c-14.6-19.8-38-32.6-64.5-32.6s-49.9 12.8-64.5 32.6c-3.2 4.3-8.3 6.8-13.7 6.5s-10.2-3.2-13-7.8c-14-23.6-39.6-39.3-68.9-39.3-27.7 0-52.1 14.1-66.5 35.5-3.9 5.7-11 8.4-17.6 6.5S.5 274.2.2 267.3c-.1-3.8-.2-7.5-.2-11.3C0 125.5 97.7 17.7 224 2V0c0-17.7 14.3-32 32-32m32 360v102.6c0 45-36.5 81.4-81.4 81.4-30.8 0-59-17.4-72.8-45l-2.3-4.7c-7.9-15.8-1.5-35 14.3-42.9s35-1.5 42.9 14.3l2.3 4.7c3 5.9 9 9.6 15.6 9.6 9.6 0 17.4-7.8 17.4-17.4V328c0-17.7 14.3-32 32-32s32 14.3 32 32"],
  "mug-hot": ["Kaffee", "0 0 576 512", "M152-16c-13.3 0-24 10.7-24 24 0 38.9 23.4 59.4 39.1 73.1l1.1 1C184.5 96.4 192 103.9 192 120c0 13.3 10.7 24 24 24s24-10.7 24-24c0-38.9-23.4-59.4-39.1-73.1l-1.1-1C183.5 31.7 176 24.1 176 8c0-13.3-10.7-24-24-24M96 192c-17.7 0-32 14.3-32 32v192c0 53 43 96 96 96h192c41.8 0 77.4-26.7 90.5-64h5.5c70.7 0 128-57.3 128-128s-57.3-128-128-128zm352 192V256c35.3 0 64 28.7 64 64s-28.7 64-64 64M288 8c0-13.3-10.7-24-24-24S240-5.3 240 8c0 38.9 23.4 59.4 39.1 73.1l1.1 1C296.5 96.4 304 103.9 304 120c0 13.3 10.7 24 24 24s24-10.7 24-24c0-38.9-23.4-59.4-39.1-73.1l-1.1-1C295.5 31.7 288 24.1 288 8"],
  "cake-candles": ["Kuchen", "0 0 448 512", "M86.4-10.5 61.8 31.6C58 38.1 56 45.6 56 53.2V56c0 22.1 17.9 40 40 40s40-17.9 40-40v-2.8c0-7.6-2-15-5.8-21.6l-24.6-42.1c-2-3.4-5.7-5.5-9.6-5.5s-7.6 2.1-9.6 5.5m128 0-24.6 42.1c-3.8 6.5-5.8 14-5.8 21.6V56c0 22.1 17.9 40 40 40s40-17.9 40-40v-2.8c0-7.6-2-15-5.8-21.6l-24.6-42.1c-2-3.4-5.7-5.5-9.6-5.5s-7.6 2.1-9.6 5.5m103.4 42.1c-3.8 6.5-5.8 14-5.8 21.6V56c0 22.1 17.9 40 40 40s40-17.9 40-40v-2.8c0-7.6-2-15-5.8-21.6l-24.6-42.1c-2-3.4-5.7-5.5-9.6-5.5s-7.6 2.1-9.6 5.5zM128 160c0-17.7-14.3-32-32-32s-32 14.3-32 32v53.5C26.7 226.6 0 262.2 0 304v20.8c20.9 1.3 41.6 7.3 60.3 18l7.1 4.1c26.3 15 58.9 13.4 83.6-4.2 43.7-31.2 102.3-31.2 146 0 24.6 17.6 57.3 19.3 83.6 4.2l7.1-4.1c18.7-10.7 39.3-16.7 60.3-18V304c0-41.8-26.7-77.4-64-90.5V160c0-17.7-14.3-32-32-32s-32 14.3-32 32v48h-64v-48c0-17.7-14.3-32-32-32s-32 14.3-32 32v48h-64zm320 213c-12.7 1.2-25.1 5-36.5 11.5l-7.1 4.1c-42.6 24.3-95.4 21.7-135.3-6.8-27-19.3-63.2-19.3-90.2 0-39.9 28.5-92.7 31.2-135.3 6.8l-7.1-4.1C25.1 378 12.7 374.1 0 373v75c0 35.3 28.7 64 64 64h320c35.3 0 64-28.7 64-64z"],
  "cookie": ["Keks", "0 0 512 512", "M247.2 17c-22.1-3.1-44.6.9-64.4 11.4l-74 39.5c-19.7 10.5-35.6 27-45.4 47.1l-36.7 75.6c-9.8 20.1-13 42.9-9.1 64.9l14.5 82.8c3.9 22.1 14.6 42.3 30.7 57.9l60.3 58.4c16.1 15.6 36.6 25.6 58.7 28.7l83 11.7c22.1 3.1 44.6-.9 64.4-11.4l74-39.5c19.7-10.5 35.6-27 45.4-47.2l36.7-75.5c9.8-20.1 13-42.9 9.1-64.9l-14.6-82.8c-3.9-22.1-14.6-42.3-30.7-57.9l-60.2-58.3c-16.1-15.6-36.6-25.6-58.7-28.7zM208 144a32 32 0 1 1 0 64 32 32 0 1 1 0-64m-64 192a32 32 0 1 1 64 0 32 32 0 1 1-64 0m224-64a32 32 0 1 1 0 64 32 32 0 1 1 0-64"],
  "ice-cream": ["Eis", "0 0 384 512", "M335.1 160c.6-5.3.9-10.6.9-16C336 64.5 271.5 0 192 0S48 64.5 48 144c0 5.4.3 10.7.9 16H48c-26.5 0-48 21.5-48 48s21.5 48 48 48h288c26.5 0 48-21.5 48-48s-21.5-48-48-48zM64 304l105.2 225.5c4.1 8.8 13 14.5 22.8 14.5s18.6-5.7 22.8-14.5L320 304z"],
  "lemon": ["Zitrone", "0 0 448 512", "M448 96c0-35.3-28.7-64-64-64-6.6 0-13 1-19 2.9-22.5 7-48.1 14.9-71 9-75.2-19.1-156.4 11-213.7 68.3S-7.2 250.8 11.9 326c5.8 22.9-2 48.4-9 71C1 403 0 409.4 0 416c0 35.3 28.7 64 64 64 6.6 0 13-1 19.1-2.9 22.5-7 48.1-14.9 71-9 75.2 19.1 156.4-11 213.7-68.3s87.4-138.6 68.3-213.8c-5.8-22.9 2-48.4 9-71 1.9-6 2.9-12.4 2.9-19.1zm-225.3 47c-52 15.2-96.5 59.7-111.7 111.7-3.7 12.7-17.1 20-29.8 16.3s-20-17-16.2-29.7C84.8 173.6 141.6 116.8 209.3 97c12.7-3.7 26.1 3.6 29.8 16.3s-3.6 26.1-16.3 29.8z"],
  "record-vinyl": ["Schallplatte", "0 0 512 512", "M0 256a256 256 0 1 1 512 0 256 256 0 1 1-512 0m256-96a96 96 0 1 1 0 192 96 96 0 1 1 0-192m0 240a144 144 0 1 0 0-288 144 144 0 1 0 0 288m0-112a32 32 0 1 0 0-64 32 32 0 1 0 0 64"],
  "book-open": ["Buch", "0 0 512 512", "M256 141.3v309.3l.5-.2A449 449 0 0 1 428.8 416H448V96h-19.2c-42.2 0-84.1 8.4-123.1 24.6-16.8 7-33.4 13.9-49.7 20.7m-25.1-79.8L256 72l25.1-10.5C327.9 42 378.1 32 428.8 32H464c26.5 0 48 21.5 48 48v352c0 26.5-21.5 48-48 48h-35.2c-50.7 0-100.9 10-147.7 29.5l-12.8 5.3c-7.9 3.3-16.7 3.3-24.6 0l-12.8-5.3C184.1 490 133.9 480 83.2 480H48c-26.5 0-48-21.5-48-48V80c0-26.5 21.5-48 48-48h35.2c50.7 0 100.9 10 147.7 29.5"],
  "camera": ["Kamera", "0 0 512 512", "M149.1 64.8 138.7 96H64c-35.3 0-64 28.7-64 64v256c0 35.3 28.7 64 64 64h384c35.3 0 64-28.7 64-64V160c0-35.3-28.7-64-64-64h-74.7l-10.4-31.2C356.4 45.2 338.1 32 317.4 32H194.6c-20.7 0-39 13.2-45.5 32.8M256 192a96 96 0 1 1 0 192 96 96 0 1 1 0-192"],
  "puzzle-piece": ["Spielzeug", "0 0 512 512", "M224 0c35.3 0 64 21.5 64 48 0 10.4-4.4 20-12 27.9-6.6 6.9-12 15.3-12 24.9 0 15 12.2 27.2 27.2 27.2H336c26.5 0 48 21.5 48 48v44.8c0 15 12.2 27.2 27.2 27.2 9.5 0 18-5.4 24.9-12 7.9-7.5 17.5-12 27.9-12 26.5 0 48 28.7 48 64s-21.5 64-48 64c-10.4 0-20.1-4.4-27.9-12-6.9-6.6-15.3-12-24.9-12-15 0-27.2 12.2-27.2 27.2V464c0 26.5-21.5 48-48 48h-56.8c-12.8 0-23.2-10.4-23.2-23.2 0-9.2 5.8-17.3 13.2-22.8 11.6-8.7 18.8-20.7 18.8-34 0-26.5-28.7-48-64-48s-64 21.5-64 48c0 13.3 7.2 25.3 18.8 34 7.4 5.5 13.2 13.5 13.2 22.8 0 12.8-10.4 23.2-23.2 23.2H48c-26.5 0-48-21.5-48-48V343.2C0 330.4 10.4 320 23.2 320c9.2 0 17.3 5.8 22.8 13.2 8.7 11.6 20.7 18.8 34 18.8 26.5 0 48-28.7 48-64s-21.5-64-48-64c-13.3 0-25.3 7.2-34 18.8-5.5 7.4-13.5 13.2-22.8 13.2C10.4 256 0 245.6 0 232.8V176c0-26.5 21.5-48 48-48h108.8c15 0 27.2-12.2 27.2-27.2 0-9.5-5.4-18-12-24.9-7.5-7.9-12-17.5-12-27.9 0-26.5 28.7-48 64-48"],
  "baby": ["Baby", "0 0 384 512", "M120 88a72 72 0 1 1 144 0 72 72 0 1 1-144 0M7.7 144.5c13-17.9 38-21.8 55.9-8.8L99.8 162c26.8 19.5 59.1 30 92.2 30s65.4-10.5 92.2-30l36.2-26.4c17.9-13 42.9-9 55.9 8.8s9 42.9-8.8 55.9l-36.2 26.4c-13.6 9.9-28.1 18.2-43.3 25V288H96v-36.3c-15.2-6.7-29.7-15.1-43.3-25l-36.2-26.4c-17.9-13-21.8-38-8.8-55.9zm89.8 184.8 60.6 53-26 37.2 24.3 24.3c15.6 15.6 15.6 40.9 0 56.6s-40.9 15.6-56.6 0l-48-48C38 438.6 36.1 417 47.2 401.1l50.2-71.8zm128.5 53 60.6-53 50.2 71.8c11.1 15.9 9.2 37.5-4.5 51.2l-48 48c-15.6 15.6-40.9 15.6-56.6 0s-15.6-40.9 0-56.6l24.3-24.3-26-37.2z"],
  "bicycle": ["Fahrrad", "0 0 640 512", "M331.7 43.3c4.3-7 12-11.3 20.3-11.3h104c13.3 0 24 10.7 24 24s-10.7 24-24 24h-65.6l72.2 148.4c10.7-2.9 21.9-4.4 33.4-4.4 70.7 0 128 57.3 128 128s-57.3 128-128 128-128-57.3-128-128c0-42 20.2-79.2 51.4-102.6L399 207.5l-73.5 147c-2.3 4.8-6.3 8.8-11.4 11.2-.6.3-1.2.5-1.8.7-2.9 1.1-5.9 1.6-8.9 1.5l-32.4.1c-7.9 63.1-61.7 112-127 112-70.7 0-128-57.3-128-128s57.3-128 128-128c10.8 0 21.2 1.3 31.2 3.8l28.5-56.9-11.5-26.9H152c-13.3 0-24-10.7-24-24s10.7-24 24-24h56c9.6 0 18.3 5.7 22.1 14.5l14.3 33.5h123.7l-37.7-77.5c-3.6-7.4-3.2-16.2 1.2-23.2zM228.5 228.7 182.9 320h84.8l-39.1-91.3zm77.2 58.3 47.5-95H265zm168.7 75.5-29.7-61c-12.8 13-20.7 30.8-20.7 50.5 0 39.8 32.2 72 72 72s72-32.2 72-72-32.2-72-72-72c-2.7 0-5.5.2-8.1.5l29.7 61c5.8 11.9.8 26.3-11.1 32.1s-26.3.8-32.1-11.1M149.2 368c-20.2 0-33.4-21.3-24.3-39.4l24.2-48.5c-1.7-.1-3.4-.2-5.1-.2-39.8 0-72 32.2-72 72s32.2 72 72 72c34.3 0 62.9-23.9 70.2-56h-65z"],
  "couch": ["Möbel", "0 0 640 512", "M144 272c0-47.3-34.2-86.6-79.2-94.5C72 113.6 126.2 64 192 64h256c65.8 0 120 49.6 127.2 113.5-45 8-79.2 47.2-79.2 94.5v32H144zM0 384V272c0-26.5 21.5-48 48-48s48 21.5 48 48v80h448v-80c0-26.5 21.5-48 48-48s48 21.5 48 48v112c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64"],
  "lightbulb": ["Lampe", "0 0 384 512", "M292.9 384c7.3-22.3 21.9-42.5 38.4-59.9C364 289.7 384 243.2 384 192 384 86 298 0 192 0S0 86 0 192c0 51.2 20 97.7 52.7 132.1 16.5 17.4 31.2 37.6 38.4 59.9h201.7zm-4.9 48H96v16c0 44.2 35.8 80 80 80h32c44.2 0 80-35.8 80-80zM184 112c-39.8 0-72 32.2-72 72 0 13.3-10.7 24-24 24s-24-10.7-24-24c0-66.3 53.7-120 120-120 13.3 0 24 10.7 24 24s-10.7 24-24 24"],
  "box-open": ["Kiste", "0 0 640 512", "M560.3 237.2c10.4 11.8 28.3 14.4 41.8 5.5 14.7-9.8 18.7-29.7 8.9-44.4l-48-72c-2.8-4.2-6.6-7.7-11.1-10.2L351.4 4.7C332.1-6 308.6-6 289.2 4.7L88.8 116c-5.4 3-9.7 7.4-12.6 12.8l-48.5 89.9c-12.6 23.4-3.8 52.5 19.6 65.1l33 17.7v53.3c0 23 12.4 44.3 32.4 55.7l176 99.7c19.6 11.1 43.5 11.1 63.1 0l176-99.7c20.1-11.4 32.4-32.6 32.4-55.7V237.3zm-240-9.8L170.2 144l150.1-83.4L470.4 144zm-41.5 50.2-21.3 46.2L91.7 235l25.4-47.2z"],
  "clock": ["Uhr", "0 0 512 512", "M256 0a256 256 0 1 1 0 512 256 256 0 1 1 0-512m-24 120v136c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2V120c0-13.3-10.7-24-24-24s-24 10.7-24 24"],
  "hand": ["Hand", "0 0 512 512", "M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32v208c0 8.8-7.2 16-16 16s-16-7.2-16-16V64c0-17.7-14.3-32-32-32s-32 14.3-32 32v272c0 1.5 0 3.1.1 4.6L67.6 283c-16-15.2-41.3-14.6-56.6 1.4s-14.6 41.3 1.4 56.6l112.4 107c43.1 41.1 100.4 64 160 64H304c97.2 0 176-78.8 176-176V128c0-17.7-14.3-32-32-32s-32 14.3-32 32v112c0 8.8-7.2 16-16 16s-16-7.2-16-16V64c0-17.7-14.3-32-32-32s-32 14.3-32 32v176c0 8.8-7.2 16-16 16s-16-7.2-16-16z"],
  "hand-holding-heart": ["Spende", "0 0 576 512", "M279.6 31c-14.1-19.5-36.7-31-60.7-31C177.5 0 144 33.5 144 74.9v2.4c0 64.4 82 133.4 122.2 163.3 13 9.7 30.5 9.7 43.5 0 40.2-30 122.2-98.9 122.2-163.3v-2.4C431.9 33.5 398.4 0 357 0c-24 0-46.6 11.5-60.7 31L288 42.7zM109.3 341.5 66.7 384H32c-17.7 0-32 14.3-32 32v64c0 17.7 14.3 32 32 32h320.5c29 0 57.3-9.3 80.7-26.5l126.6-93.3c17.8-13.1 21.6-38.1 8.5-55.9s-38.1-21.6-55.9-8.5L392.6 416H280c-13.3 0-24-10.7-24-24s10.7-24 24-24h72c17.7 0 32-14.3 32-32s-14.3-32-32-32H199.8c-33.9 0-66.5 13.5-90.5 37.5"],
  "handshake": ["Handschlag", "0 0 576 512", "M268.9 85.2 152.3 214.8c-4.6 5.1-4.4 13 .5 17.9 30.5 30.5 80 30.5 110.5 0l31.8-31.8c4.2-4.2 9.5-6.5 14.9-6.9 6.8-.6 13.8 1.7 19 6.9L505.6 376l70.4-56V32L464 96l-23.8-15.9A96.2 96.2 0 0 0 386.9 64h-70.4c-1.1 0-2.3 0-3.4.1-16.9.9-32.8 8.5-44.2 21.1m-152.3 97.5L223.4 64h-39.6c-25.5 0-49.9 10.1-67.9 28.1L112 96 0 32v288l156.4 130.3c23 19.2 52 29.7 81.9 29.7H254l-7-7c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l41 41h9c19.1 0 37.8-4.3 54.8-12.3L359 441c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l32 32 17.5-17.5c8.9-8.9 11.5-21.8 7.6-33.1L312.1 251.7l-14.9 14.9c-49.3 49.3-129.1 49.3-178.4 0-23-23-23.9-59.9-2.2-84z"],
  "thumbs-up": ["Daumen hoch", "0 0 512 512", "M80 160c17.7 0 32 14.3 32 32v256c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32V192c0-17.7 14.3-32 32-32zM270.6 16c27.3 0 49.4 22.1 49.4 49.4v4.2c0 6.8-1.3 13.6-3.8 19.9L288 160h160c26.5 0 48 21.5 48 48 0 19.7-11.9 36.6-28.9 44 17 7.4 28.9 24.3 28.9 44 0 23.4-16.8 42.9-39 47.1 4.4 7.3 7 15.8 7 24.9 0 22.2-15 40.8-35.4 46.3 2.2 5.5 3.4 11.5 3.4 17.7 0 26.5-21.5 48-48 48h-87.9c-36.3 0-71.6-12.4-99.9-35.1l-12.2-9.7c-15.2-12.1-24-30.5-24-50V198.6c0-14.9 3.5-29.6 10.1-42.9l56.2-112.4c8.4-16.7 25.5-27.3 44.3-27.3"],
  "circle-check": ["Geprüft", "0 0 512 512", "M256 512a256 256 0 1 1 0-512 256 256 0 1 1 0 512m118-366.3c-10.7-7.8-25.7-5.4-33.5 5.3L221.1 315.2 169 263.1c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l72 72c5 5 11.8 7.5 18.8 7s13.4-4.1 17.5-9.8l135.9-187c7.8-10.7 5.4-25.7-5.3-33.5"],
  "circle-question": ["Fragezeichen", "0 0 512 512", "M256 512a256 256 0 1 0 0-512 256 256 0 1 0 0 512m0-336c-17.7 0-32 14.3-32 32 0 13.3-10.7 24-24 24s-24-10.7-24-24c0-44.2 35.8-80 80-80s80 35.8 80 80c0 47.2-36 67.2-56 74.5v3.8c0 13.3-10.7 24-24 24s-24-10.7-24-24v-8.1c0-20.5 14.8-35.2 30.1-40.2 6.4-2.1 13.2-5.5 18.2-10.3 4.3-4.2 7.7-10 7.7-19.6 0-17.7-14.3-32-32-32zm-32 192a32 32 0 1 1 64 0 32 32 0 1 1-64 0"],
  "screwdriver-wrench": ["Werkzeug", "0 0 576 512", "M70.8-6.7c5.4-5.4 13.8-6.2 20.2-2l118.9 79.2c8.9 5.9 14.2 15.9 14.2 26.6v49.6l90.8 90.8c33.3-15 73.9-8.9 101.2 18.5l126.1 126.1c18.7 18.7 18.7 49.1 0 67.9l-60.1 60.1c-18.7 18.7-49.1 18.7-67.9 0L288.1 384c-27.4-27.4-33.5-67.9-18.5-101.2L178.8 192h-49.6c-10.7 0-20.7-5.3-26.6-14.2L23.4 58.9c-4.2-6.3-3.4-14.8 2-20.2zm145 303.5c-6.3 36.9 2.3 75.9 26.2 107.2l-94.9 95c-28.1 28.1-73.7 28.1-101.8 0s-28.1-73.7 0-101.8l135.4-135.5 35.2 35.1zM384.1 0c20.1 0 39.4 3.7 57.1 10.5 10 3.8 11.8 16.5 4.3 24.1l-56.7 56.7c-3 3-4.7 7.1-4.7 11.3V144c0 8.8 7.2 16 16 16h41.4c4.2 0 8.3-1.7 11.3-4.7l56.7-56.7c7.6-7.5 20.3-5.7 24.1 4.3 6.8 17.7 10.5 37 10.5 57.1 0 43.2-17.2 82.3-45 111.1L450 222c-33.1-33-78.5-45.7-121.1-38.4l-56.8-56.8V97.1l-.2-5c-.8-12.4-4.4-24.3-10.5-34.9C290.8 22.2 334.8 0 384.1-.1z"],
  "triangle-exclamation": ["Achtung", "0 0 512 512", "M256 0c14.7 0 28.2 8.1 35.2 21l216 400c6.7 12.4 6.4 27.4-.8 39.5S486.1 480 472 480H40c-14.1 0-27.2-7.4-34.4-19.5s-7.5-27.1-.8-39.5l216-400c7-12.9 20.5-21 35.2-21m0 352a32 32 0 1 0 0 64 32 32 0 1 0 0-64m0-192c-18.2 0-32.7 15.5-31.4 33.7l7.4 104c.9 12.5 11.4 22.3 23.9 22.3 12.6 0 23-9.7 23.9-22.3l7.4-104c1.3-18.2-13.1-33.7-31.4-33.7z"],
  "fire": ["Feuer", "0 0 448 512", "M160.5-26.4c9.3-7.8 23-7.5 31.9.9 12.3 11.6 23.3 24.4 33.9 37.4 13.5 16.5 29.7 38.3 45.3 64.2 5.2-6.8 10-12.8 14.2-17.9 1.1-1.3 2.2-2.7 3.3-4.1C297 44.3 306.8 32 319.9 32c13.4 0 22.8 11.9 30.8 22.1q1.95 2.55 3.9 4.8c10.3 12.4 24 30.3 37.7 52.4 27.2 43.9 55.6 106.4 55.6 176.6 0 123.7-100.3 224-224 224S0 411.7 0 288c0-91.1 41.1-170 80.5-225 19.9-27.7 39.7-49.9 54.6-65.1 8.2-8.4 16.5-16.7 25.5-24.2zM225.7 416c25.3 0 47.7-7 68.8-21 42.1-29.4 53.4-88.2 28.1-134.4-4.5-9-16-9.6-22.5-2l-25.2 29.3c-6.6 7.6-18.5 7.4-24.7-.5-17.3-22.1-49.1-62.4-65.3-83-5.4-6.9-15.2-8-21.5-1.9-18.3 17.8-51.5 56.8-51.5 104.3 0 68.6 50.6 109.2 113.7 109.2z"],
  "house": ["Haus", "0 0 512 512", "M277.8 8.6c-12.3-11.4-31.3-11.4-43.5 0l-224 208c-9.6 9-12.8 22.9-8 35.1S18.8 272 32 272h16v176c0 35.3 28.7 64 64 64h288c35.3 0 64-28.7 64-64V272h16c13.2 0 25-8.1 29.8-20.3s1.6-26.2-8-35.1zM240 320h32c26.5 0 48 21.5 48 48v96H192v-96c0-26.5 21.5-48 48-48"],
  "face-grin-wink": ["Zwinker-Smiley", "0 0 512 512", "M256 512a256 256 0 1 0 0-512 256 256 0 1 0 0 512m130.7-203.1c11.9-3.7 23.9 6.3 19.6 18.1C383.9 388.3 325 432.1 256 432.1s-127.9-43.9-150.3-105.2c-4.3-11.8 7.7-21.8 19.6-18.1C164.5 321 209 327.9 256 327.9s91.5-6.9 130.7-19.1zM328 196c-11 0-20 9-20 20s-9 20-20 20-20-9-20-20c0-33.1 26.9-60 60-60h16c33.1 0 60 26.9 60 60 0 11-9 20-20 20s-20-9-20-20-9-20-20-20zm-152-20a32 32 0 1 1 0 64 32 32 0 1 1 0-64"],
  "dumbbell": ["Hantel", "0 0 640 512", "M96 112c0-26.5 21.5-48 48-48s48 21.5 48 48v112h256V112c0-26.5 21.5-48 48-48s48 21.5 48 48v16h16c26.5 0 48 21.5 48 48v48c17.7 0 32 14.3 32 32s-14.3 32-32 32v48c0 26.5-21.5 48-48 48h-16v16c0 26.5-21.5 48-48 48s-48-21.5-48-48V288H192v112c0 26.5-21.5 48-48 48s-48-21.5-48-48v-16H80c-26.5 0-48-21.5-48-48v-48c-17.7 0-32-14.3-32-32s14.3-32 32-32v-48c0-26.5 21.5-48 48-48h16z"],
  "wine-glass": ["Glas", "0 0 320 512", "M32.6 25.7C35.6 10.8 48.7 0 64 0h192c15.3 0 28.4 10.8 31.4 25.7L316.8 173c2.1 10.5 3.2 21.2 3.2 32v3c0 77.4-55 142-128 156.8V480h64c17.7 0 32 14.3 32 32s-14.3 32-32 32H64c-17.7 0-32-14.3-32-32s14.3-32 32-32h64V364.8C55 350 0 285.4 0 208v-3c0-10.7 1.1-21.4 3.2-32zM77.4 128h165.1l-12.8-64H90.2z"] };
const symSVG = k => SYM[k] ? `<svg viewBox="${SYM[k][1]}" aria-hidden="true" focusable="false"><path d="${SYM[k][2]}"/></svg>` : "";
// Symbol einer Variante: eigene Angabe (auch "" für keins) geht vor der Angabe der Vorlage
const symOf = (t, x) => { const k = x.sym !== undefined ? x.sym : t.sym; return k && SYM[k] ? k : ""; };
const signState = (t, x = t.v[0]) => ({ kind: t.kind || "sign", fmt: t.kind === "tags" ? "tags" : (t.fmt || "quer"), top: x.top || "", main: x.main || "", bot: x.bot || "", price: x.price || "", ...((x.tone || t.tone) && (x.tone || t.tone) !== "gelb" ? { tone: x.tone || t.tone } : {}), ...(t.kind !== "tags" && symOf(t, x) ? { sym: symOf(t, x) } : {}), ...(x.ink && x.ink !== inkDefault(x.tone || t.tone) ? { ink: x.ink } : {}), ...(x.font && x.font !== "modern" && fontOk(x.font) ? { font: x.font } : {}), ...(t.kind !== "tags" && x.shape && x.shape !== "rund" && shapeOk(x.shape) ? { shape: x.shape } : {}) });
/* Vorschaubilder: echte Aufnahmen des Schilder-Designers (src/schilder/flohmarkt-<kennung>-vorlage.webp), damit Übersicht,
   Startseite und Google-Bildersuche genau das Schild zeigen, das man druckt (Schrift, Pfeile, Farben). Sie entstehen außerhalb
   des Baus. vorschau.json merkt sich, zu welchem Text ein Bild gehört: Passt es nicht mehr (Text geändert), nimmt der Bau
   das einfache gezeichnete Bild (SVG) und meldet das im Bericht. Die SVG-Dateien entstehen weiter, damit alte Bildadressen gültig bleiben. */
const SIGN_PREV_V = 1, SIGN_PREV_DIR = path.join(ROOT, "src", "schilder");
const SIGN_PREV = (() => { try { return JSON.parse(fs.readFileSync(path.join(SIGN_PREV_DIR, "vorschau.json"), "utf8")); } catch { return {}; } })();
const signKey = t => hashOf("sha1").update(JSON.stringify([SIGN_PREV_V, signState(t)])).digest("hex").slice(0, 10);
const signWebp = t => SIGN_PREV[t.s] === signKey(t) && fs.existsSync(path.join(SIGN_PREV_DIR, `flohmarkt-${t.s}-vorlage.webp`));
for (const t of SIGNS) if (!signWebp(t)) warn("Schilder", `Vorschaubild für „${t.chip}“ fehlt oder passt nicht mehr zum Text der Vorlage. Bis zum nächsten Update zeigt die Website das einfache gezeichnete Vorschaubild.`, true);
if (process.env.VORSCHAU_SCHLUESSEL) fs.writeFileSync(process.env.VORSCHAU_SCHLUESSEL, JSON.stringify(Object.fromEntries(SIGNS.map(t => [t.s, signKey(t)])), null, 1));
const signImg = t => `/assets/schilder/flohmarkt-${t.s}-vorlage.${signWebp(t) ? "webp" : "svg"}`;
for (const pg of pages.values()) if (pg.html.includes("%%SIGNIMG:")) pg.html = pg.html.replace(/%%SIGNIMG:([a-z0-9-]+)%%/g, (m, s) => SIGN_BY[s] ? signImg(SIGN_BY[s]) : `/assets/schilder/flohmarkt-${s}-vorlage.svg`);
// Markup: dieselben Bausteine nutzt src/site.js (Vorlagen <template id="tplSign"> und "tplTag")
const SG_UNIT = `<div class="sg"><div class="sg-top"></div><div class="sg-mw"><div class="sg-main"><svg class="sg-shape" aria-hidden="true" focusable="false"><path fill-rule="evenodd"/></svg><span></span></div><span class="sg-sym" aria-hidden="true"></span></div><div class="sg-bot"></div><div class="sg-foot"><div class="sg-pay"><svg class="sg-payqr" aria-hidden="true" focusable="false"></svg><span><b>Mit PayPal zahlen</b><span class="sg-payurl"></span></span></div>${qrSVG("sg-qr")}<span><b>flohlotse.de/schilder</b>Schilder kostenlos gestalten</span></div></div>`;
const TG_UNIT = `<div class="tg"><i class="tg-hole"></i><div class="tg-price"><span></span></div><div class="tg-vb"><i></i>VB</div><div class="tg-brand">flohlotse.de</div></div>`;
// Pfeile auf Schildern als Grafik in Schriftstärke, ein Pfeil bleibt bei seinem Nachbarwort (wie in src/site.js, signText)
const ARW_DEG = { "→": 0, "↓": 90, "←": 180, "↑": 270 }, ARW_D = "M8 50H80M54 22l28 28-28 28";
const isArw = x => Object.prototype.hasOwnProperty.call(ARW_DEG, x);
const arwSVG = ch => `<svg class="sg-arw" viewBox="0 0 100 100" aria-hidden="true"><path d="${ARW_D}" transform="rotate(${ARW_DEG[ch]} 50 50)"/></svg>`;
const signTxt = t => {
  const g = [];
  for (const x of String(t).match(/[←→↑↓]|[^\s←→↑↓]+/g) || []) {
    const a = isArw(x), last = g[g.length - 1];
    if (a && last && !last.wait) last.push(x); else if (!a && last && last.wait) { last.push(x); last.wait = false; } else { const n = [x]; n.wait = a; g.push(n); }
  }
  return g.map(grp => grp.length === 1 && !isArw(grp[0]) ? esc(grp[0]) : `<span class="nw">${grp.map(x => isArw(x) ? arwSVG(x) : esc(x)).join(" ")}</span>`).join(" ");
};
const SIGN_PER = { quer: 1, hoch: 1, zwei: 2, vier: 4, acht: 8 };
const sheetCls = st => (st.tone ? " tone-" + st.tone : "") + " ink-" + (st.ink || inkDefault(st.tone)) + (inkOut(st) ? " ink-out" : "") + (st.font ? " font-" + st.font : "") + (st.shape ? " shp shape-" + st.shape : "");
function sheetHTML(st) {
  if (st.kind === "tags") {
    const u = `<div class="tg"><i class="tg-hole"></i><div class="tg-price${st.price ? "" : " blank"}"><span>${st.price ? esc(st.price) : "€"}</span></div><div class="tg-vb"><i></i>VB</div><div class="tg-brand">flohlotse.de</div></div>`;
    return `<div class="sheet f-tags${sheetCls(st)}" id="sheet">${u.repeat(24)}</div>`;
  }
  const u = `<div class="sg"><div class="sg-top">${signTxt(st.top)}</div><div class="sg-mw"><div class="sg-main"><svg class="sg-shape" aria-hidden="true" focusable="false"><path fill-rule="evenodd"/></svg><span>${signTxt(st.main)}</span></div><span class="sg-sym" aria-hidden="true">${symSVG(st.sym)}</span></div><div class="sg-bot">${signTxt(st.bot)}</div><div class="sg-foot"><div class="sg-pay"><svg class="sg-payqr" aria-hidden="true" focusable="false"></svg><span><b>Mit PayPal zahlen</b><span class="sg-payurl"></span></span></div>${qrSVG("sg-qr")}<span><b>flohlotse.de/schilder</b>Schilder kostenlos gestalten</span></div></div>`;
  return `<div class="sheet f-${st.fmt}${sheetCls(st)}${st.sym ? " sym" : ""}" id="sheet">${u.repeat(SIGN_PER[st.fmt] || 1)}</div>`;
}
// Themen im Designer: jede Vorlage mit all ihren Sprüchen, dazu „Eigener Text“. So findet man jeden Spruch auf jeder Designer-Seite.
// Reihenfolge: Beliebtes und Lustiges zuerst.
const THEME_ORDER = ["alles-1-euro", "lustige-sprueche", "maedelsflohmarkt", "preisschilder", "bar-und-paypal", "handeln-erwuenscht", "mengenrabatt", "alles-muss-raus", "reserviert-verkauft", "zu-verschenken", "bin-gleich-zurueck", "bitte-nicht-anfassen", "hofflohmarkt", "kinderflohmarkt", "kaffee-und-kuchen", "guter-zweck", "vintage", "getestet", "weihnachtsflohmarkt"];
const signThemes = () => [...THEME_ORDER.map(s => SIGN_BY[s]).filter(Boolean), ...SIGNS.filter(t => !THEME_ORDER.includes(t.s))]
  .map(t => ({ s: t.s, l: { mengenrabatt: "Mengenrabatt", "reserviert-verkauft": "Reserviert & Verkauft" }[t.s] || t.chip, items: t.v.map(x => ({ l: x.l, set: t.s === "bar-und-paypal" ? { ...signState(t, x), pay: x.l === "Nur Bargeld" ? 0 : 1 } : signState(t, x) })) }))
  .concat([{ s: "", l: "Eigener Text", items: [{ l: "Eigener Text", set: { kind: "sign", fmt: "quer", top: "", main: "Dein Text", bot: "" } }] }]);
// Ideen zum Antippen: fertige Looks (Spruch, Farbe, Schrift, Form) als kleines Bild. Ein Tipp übernimmt alles, danach Text ändern und drucken.
// Bilder: src/schilder/ideen/<kennung>.webp (echte Aufnahmen aus dem Designer, entstehen außerhalb des Baus). Fehlt ein Bild, zeigt die Karte Farbe und Namen.
const IDEAS = [
  ["prickelnde-preise", "maedelsflohmarkt", "Prickelnde Preise", { tone: "pink", ink: "weiss", font: "verspielt", shape: "wolke" }],
  ["koenigliche-preise", "maedelsflohmarkt", "Gold-Edition", {}, "Königliche Preise"],
  ["mir-zu-klein", "maedelsflohmarkt", "Mir zu klein", { tone: "mint", ink: "weiss", font: "verspielt", shape: "blume" }],
  ["neu-mit-etikett", "maedelsflohmarkt", "Neu mit Etikett", { tone: "pink", ink: "gold", font: "elegant", shape: "etikett" }],
  ["glitzer-ecke", "maedelsflohmarkt", "Glitzer-Ecke", { tone: "schwarz", ink: "pink", shape: "stern" }],
  ["anprobieren", "maedelsflohmarkt", "Anprobieren erwünscht", { tone: "mint", ink: "schwarz", font: "elegant", shape: "blase" }, "Anprobieren"],
  ["alles-1-euro", "alles-1-euro", "1 €", {}, "Alles 1 €"],
  ["halber-preis", "alles-muss-raus", "Halber Preis", {}],
  ["fehlkauf", "lustige-sprueche", "Fehlkauf", {}],
  ["moin", "lustige-sprueche", "Moin", { tone: "mint", font: "verspielt" }],
  ["raritaet", "vintage", "Rarität", { tone: "pink", font: "verspielt", shape: "etikett" }],
  ["bar-und-paypal", "bar-und-paypal", "Bar & PayPal", { tone: "schwarz", ink: "gold", font: "verspielt", shape: "etikett" }]
];
const IDEA_DIR = path.join(ROOT, "src", "schilder", "ideen");
const ideaImg = k => fs.existsSync(path.join(IDEA_DIR, `${k}.webp`));
const ideasHTML = themes => {
  const cards = IDEAS.map(([k, s, l, o, name]) => {
    const t = SIGN_BY[s], x = t && t.v.find(v => v.l === l), g = themes.findIndex(h => h.s === s);
    if (!t || !x || g < 0) { warn("Schilder", `Idee „${k}“: Vorlage „${s}“ / „${l}“ nicht gefunden, die Karte fehlt.`); return ""; }
    const tone = o.tone || x.tone || t.tone || "gelb", ink = o.ink || x.ink || inkDefault(tone), font = fontOk(o.font || x.font || "modern") ? (o.font || x.font || "modern") : "modern";
    if (!INK_OK[tone].includes(ink)) warn("Schilder", `Idee „${k}“: Schriftfarbe ${ink} passt nicht zur Fläche ${tone}.`);
    const set = { ...signState(t, x), tone, ink, font, shape: o.shape || x.shape || "rund", sym: symOf(t, x), look: 1, ...(s === "bar-und-paypal" ? { pay: 1 } : {}) };
    const img = ideaImg(k) ? `<img src="/assets/schilder/ideen/${k}.webp" width="200" height="141" alt="" loading="lazy" decoding="async">` : `<i class="idea-ph sw-${tone}" aria-hidden="true"></i>`;
    return `<button type="button" class="idea" data-set="${esc(JSON.stringify(set))}" data-grp="${g}" aria-pressed="false">${img}<span>${esc(name || l)}</span></button>`;
  }).join("");
  return cards ? `<div class="gen-ideas js-only"><p class="gen-sub" id="genIdeasH">Ideen zum Antippen</p><div class="idea-row" role="group" aria-labelledby="genIdeasH">${cards}</div></div>` : "";
};
function genHTML(st, themes, act, heading, pay) {
  // Aufbau fürs Handy: oben Überschrift mit Druckknopf, eine wischbare Zeile mit Thema und Sprüchen, die Vorschau (bleibt beim Bearbeiten stehen),
  // darunter vier Reiter mit kurzen Bereichen. So passt alles auf einen Bildschirm, ohne hin und her zu scrollen.
  const pj = p => esc(JSON.stringify(p));
  const fmtBtn = (f, l) => `<button type="button" class="chip" data-fmt="${f}" aria-pressed="${st.fmt === f}">${l}</button>`;
  const tone = st.tone || "gelb", toneBtn = k => `<button type="button" class="swb" data-tone="${k}" data-name="${TONES[k][0]}" aria-pressed="${tone === k}" title="${TONES[k][0]}"><i class="sw sw-${k}"></i><span class="vh">${TONES[k][0]}</span></button>`;
  const symBtn = k => `<button type="button" class="sym-btn" data-sym="${k}" aria-pressed="${(st.sym || "") === k}" aria-label="${k ? "Symbol: " + esc(SYM[k][0]) : "Ohne Symbol"}" title="${k ? esc(SYM[k][0]) : "Ohne"}">${k ? symSVG(k) : "<span>Ohne</span>"}</button>`;
  const ink = st.ink || inkDefault(tone), inkBtn = k => `<button type="button" class="swb ink ink-b-${k}" data-ink="${k}" data-name="${INKS[k][0]}" aria-pressed="${ink === k}" title="${INKS[k][0]}"${INK_OK[tone].includes(k) ? "" : " disabled"}><b aria-hidden="true">A</b><span class="vh">${INKS[k][0]}</span></button>`;
  const font = st.font || "modern", fontBtn = ([k, l]) => `<button type="button" class="chip fnt fnt-${k}" data-font="${k}" aria-pressed="${font === k}"><b aria-hidden="true">Aa</b>${l}</button>`;
  const txt = (id, lab, v, max, ph, cls = "only-sign") => `<label class="fld ${cls}"><span>${lab}</span><input id="${id}" type="text" value="${esc(v)}" maxlength="${max}" autocomplete="off" enterkeyhint="done"${ph ? ` placeholder="${ph}"` : ""}></label>`;
  return `<section class="gen" id="gen" data-kind="${st.kind}" data-fmt="${st.fmt}" data-tone="${tone}" data-ink="${ink}" data-font="${font}" data-shape="${st.shape || "rund"}" data-inkok="${esc(JSON.stringify(INK_OK))}" data-sym="${st.sym || ""}"${pay === "auto" ? ' data-pay="0"' : ""} aria-labelledby="genH">
<div class="gen-head"><h2 id="genH">${heading}</h2><button class="btn gen-print js-only" id="doPrint" type="button" aria-label="Als PDF speichern oder drucken">${ic("download")}<span>Speichern</span></button></div>
${ideasHTML(themes)}<p class="gen-sub js-only" id="genPickH">Alle Vorlagen nach Kategorie</p>
<div class="gen-pick js-only"><div class="gen-theme"><label for="genTheme" class="vh">Kategorie</label><select id="genTheme"><option value="" selected disabled>Kategorie wählen</option>${themes.map((g, i) => `<option value="${i}">${esc(g.l)}</option>`).join("")}</select></div>
${themes.map((g, i) => `<div class="gen-presets" data-grp="${i}" role="group" aria-label="${esc(g.l)}: Spruch wählen"${i === act ? "" : " hidden"}>${g.items.map((p, j) => `<button type="button" class="chip" data-set="${pj(p.set)}" aria-pressed="${i === act && j === 0}">${esc(p.l)}</button>`).join("")}</div>`).join("")}</div>
<div class="sheet-wrap" id="sheetWrap">${sheetHTML(st)}</div>
<div class="gen-form js-only">
<div class="gen-tabs" role="tablist" aria-label="Schild bearbeiten"><button type="button" role="tab" data-tab="look" aria-selected="true">Stil</button><button type="button" role="tab" data-tab="text" aria-selected="false">Text</button><button type="button" role="tab" class="only-sign" data-tab="shape" aria-selected="false">Form</button><button type="button" role="tab" class="only-sign" data-tab="sym" aria-selected="false">Symbol</button><button type="button" role="tab" data-tab="fmt" aria-selected="false">Format</button></div>
<div class="gen-panel gp-text" data-panel="text" role="tabpanel" hidden>
${txt("fTop", "Oben", st.top, 40, "optional")}
${txt("fMain", "Mitte", st.main, 40, "")}
${txt("fBot", "Unten", st.bot, 60, "optional")}
${pay ? `<label class="fld only-sign gen-pay"><span>PayPal</span><span class="pfx"><b>paypal.me/</b><input id="fPay" type="text" value="" maxlength="80" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="deinname"></span></label><small class="pay-note only-sign" id="payNote" aria-live="polite"></small>` : ""}
${txt("fPrice", "Preis", st.price, 12, "leer = zum Beschriften", "only-tags")}
</div>
<div class="gen-panel gp-look" data-panel="look" role="tabpanel">
<div class="sw-row" role="group" aria-label="Farbe der Fläche"><span class="seg-l">Fläche</span>${Object.keys(TONES).map(toneBtn).join("")}</div>
<div class="sw-row" role="group" aria-label="Schriftfarbe (nur gut lesbare Paare)"><span class="seg-l">Schrift&shy;farbe</span>${Object.keys(INKS).map(inkBtn).join("")}</div>
${SIGN_FONTS.length > 1 ? `<div class="seg hs seg-font only-sign" role="group" aria-label="Schrift">${SIGN_FONTS.map(fontBtn).join("")}</div>` : ""}
</div>
<div class="gen-panel gp-shape" data-panel="shape" role="tabpanel" hidden><div class="seg hs shape-row" role="group" aria-label="Form der Farbfläche">${SHAPES.map(([k, l]) => `<button type="button" class="chip shp-btn" data-shape="${k}" aria-pressed="${(st.shape || "rund") === k}"><svg viewBox="0 0 44 26" aria-hidden="true"><path fill-rule="evenodd" d="${shapePath(k, 44, 26)}"/></svg>${l}</button>`).join("")}</div></div>
<div class="gen-panel gp-sym" data-panel="sym" role="tabpanel" hidden><div class="sym-grid" role="group" aria-label="Symbol wählen">${["", ...Object.keys(SYM)].map(symBtn).join("")}</div></div>
<div class="gen-panel gp-fmt" data-panel="fmt" role="tabpanel" hidden>
<div class="seg hs only-sign" role="group" aria-label="Format">${fmtBtn("quer", "1 pro Blatt")}${fmtBtn("zwei", "2 pro Blatt")}${fmtBtn("vier", "4 pro Blatt")}${fmtBtn("acht", "8 pro Blatt")}</div>
<label class="switch only-tags"><input type="checkbox" id="fVb" checked>Kästchen „VB“</label>
<label class="switch"><input type="checkbox" id="fSave">Sparmodus: Rahmen statt Farbe</label>
</div>
</div>
<p class="gen-hint js-only">Tipp auf „Speichern“ und wähl im Fenster „Als PDF speichern“, oder gleich deinen Drucker. „Hochformat“ einfach lassen: Die Schilder liegen schon richtig auf dem Blatt und füllen es ganz aus. Deine Texte bleiben auf deinem Gerät.</p>
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
    + `<rect x="22" y="${st.top ? 50 : 34}" width="253" height="${st.top ? 118 : 134}" rx="10" fill="${TONES[st.tone || "gelb"][1]}" transform="rotate(-1.2 148.5 109)"/>`
    + lines.map((l, i) => `<text x="148.5" y="${(y0 + i * lh).toFixed(1)}" text-anchor="middle" font-family="${F}" font-size="${fs.toFixed(1)}" font-weight="900" fill="${INKS[st.ink || inkDefault(st.tone)][1]}" transform="rotate(-1.2 148.5 109)">${esc(l)}</text>`).join("")
    + (st.sym ? (() => { const [, vb, d] = SYM[st.sym], [, , vw, vh] = vb.split(" ").map(Number), sc = 22 / Math.max(vw, vh); return `<g transform="rotate(9 262 ${st.top ? 52 : 36})"><circle cx="262" cy="${st.top ? 52 : 36}" r="19" fill="#15211B"/><path d="${d}" fill="${st.tone === "schwarz" ? INKS[st.ink || inkDefault(st.tone)][1] : TONES[st.tone || "gelb"][1]}" transform="translate(${(262 - vw * sc / 2).toFixed(2)} ${((st.top ? 52 : 36) - vh * sc / 2).toFixed(2)}) scale(${sc.toFixed(5)})"/></g>`; })() : "")
    + (st.bot ? `<text x="148.5" y="188" text-anchor="middle" font-family="${B}" font-size="11.5" font-weight="700" fill="#15211B">${esc(st.bot)}</text>` : "")
    + `<text x="283" y="203" text-anchor="end" font-family="${B}" font-size="5" fill="#5A6961">flohlotse.de</text></svg>\n`;
}
const signAlt = t => t.kind === "tags" ? "Vorlage: Preisschilder für den Flohmarkt zum Ausdrucken" : `Vorlage: „${t.chip}“-Schild für den Flohmarkt`;
const signCard = t => `<a class="card sg-card" href="${signUrl(t)}"><img src="${signImg(t)}" width="297" height="210" alt="${esc(signAlt(t))}" loading="lazy" decoding="async"><h3>${esc(t.chip)}</h3><p>${esc(t.short)}</p></a>`;
const signLD = (p, crumbsArr, faq) => G([crumbLD(crumbsArr),
  { "@type": "WebApplication", name: `${NAME} Schilder-Designer`, url: SITE + p, applicationCategory: "DesignApplication", operatingSystem: "Web", inLanguage: "de", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" } },
  { "@type": "FAQPage", mainEntity: faq.map(([q, x]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(x.replace(/<[^>]+>/g, "")) } })) }]);
const signByline = `<div class="byline"><span>${ic("tag")}Kostenlos</span><span>${ic("user")}Ohne Anmeldung</span><span>${ic("printer")}Drucken oder PDF</span><span>${ic("globe")}Für jeden Flohmarkt</span></div>`;
const faqHTML = f => `<section class="faq"><h2>Häufige Fragen</h2>${f.map(([q, x]) => `<details><summary>${esc(q)}</summary><p>${x}</p></details>`).join("")}</section>`;
// Übersichtsseite
{
  const p = SIGN_BASE, cr = [[NAME, "/"], ["Schilder"]];
  const themes = signThemes(), first = SIGN_BY[themes[0].s];
  const faq = [["Kostet der Schilder-Designer etwas?", "Nein. Du kannst so viele Schilder gestalten und drucken, wie du möchtest, ohne Anmeldung."],
    ["Werden meine Texte gespeichert?", "Nein. Das Schild entsteht direkt in deinem Browser. Wir sehen nicht, was du eintippst."],
    ["Kann ich auf Etiketten drucken?", `Ja. Die <a href="${signUrl(SIGN_BY.preisschilder)}">Preisschilder-Vorlage</a> hat 24 Felder im Format 70 × 37 mm und passt auf gängige Etikettenbögen mit diesem Maß. Stell beim Drucken die Größe auf 100 %.`],
    ["Warum steht unten flohlotse.de/schilder?", "Damit auch andere sehen, wo es die Schilder kostenlos gibt. Der Hinweis ist klein und stört das Schild nicht."]];
  const body = crumbs(cr) + `<article class="kb"><h1>Flohmarkt-Schilder und Preisschilder zum Ausdrucken</h1>${signByline}
<p class="lead">Der Schilder-Designer für deinen Stand: Vorlage wählen, Text eintippen, drucken. Ohne Drucker speicherst du das Schild als PDF und druckst es im Copyshop.</p>
${genHTML(signState(first), themes, 0, "Schild gestalten und drucken", "auto")}
<section class="related"><div class="sec-head"><h2>Alle Vorlagen</h2></div>${grid(SIGNS.map(signCard))}</section>
<div class="kb-body"><h2>Welche Schilder lohnen sich am Stand?</h2><p>Ein großes Schild für die Wühlkiste wie <a href="${signUrl(first)}">„Alles 1 €“</a> erspart dir an einem vollen Markttag Dutzende Fragen. Ein <a href="${signUrl(SIGN_BY["bar-und-paypal"])}">Zahlungsschild</a> verhindert peinliche Momente an der Kasse, und <a href="${signUrl(SIGN_BY["handeln-erwuenscht"])}">„Handeln erwünscht“</a> holt Leute ins Gespräch, die sonst nur gucken. Für einzelne Stücke nimmst du <a href="${signUrl(SIGN_BY.preisschilder)}">kleine Preisschilder</a>. Für den Hofflohmarkt gibt es <a href="${signUrl(SIGN_BY.hofflohmarkt)}">Wegweiser mit Pfeil</a>, für die letzte Stunde <a href="${signUrl(SIGN_BY["alles-muss-raus"])}">„Alles muss raus“</a> und für den Stand deiner Kinder ein eigenes <a href="${signUrl(SIGN_BY.kinderflohmarkt)}">Kinderflohmarkt-Schild</a>. Für gute Laune gibt es <a href="${signUrl(SIGN_BY["lustige-sprueche"])}">lustige Sprüche</a>, für den <a href="${signUrl(SIGN_BY.maedelsflohmarkt)}">Mädelsflohmarkt</a> Schilder in Pink. Für Retro-Schätze gibt es <a href="${signUrl(SIGN_BY.vintage)}">Vintage-Schilder</a>, für Elektronik <a href="${signUrl(SIGN_BY.getestet)}">„Getestet“</a> und für Kita- und Schulflohmärkte <a href="${signUrl(SIGN_BY["kaffee-und-kuchen"])}">Kaffee &amp; Kuchen</a> und <a href="${signUrl(SIGN_BY["guter-zweck"])}">„Für den guten Zweck“</a>. Jedes Schild kannst du in Gelb, Pink oder Mint drucken und mit einem Symbol verzieren, von der Krone bis zum Sektglas.</p>
${sideImg("seite-schilder", "quer kante")}<h2>So hält dein Schild den ganzen Tag</h2><p>Steck das Blatt in eine Klarsichthülle, dann übersteht es Nieselregen und Kaffeeflecken. Mit Wäscheklammern oder Kreppband hält es an Kisten und Tischkanten, bei Wind hilft ein Stück Pappe dahinter. Was sonst noch in die Tasche gehört, steht in der ${kl("checkliste-flohmarktstand", "Checkliste für deinen Flohmarktstand")}.</p>
<h2>Drucken ohne eigenen Drucker</h2><p>Tipp im Designer auf „Speichern“ und wähl im Fenster „Als PDF speichern“. Das PDF druckst du im Copyshop oder bei Freunden aus. Für die gelbe Fläche reicht ein normaler Farbdrucker, im Sparmodus genügt Schwarzweiß.</p></div>
${faqHTML(faq)}
<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2>${more("/ratgeber/#verkaufen", "Verkaufen")}</div>${grid(["checkliste-flohmarktstand", "preise-festlegen-flohmarkt", "flohmarktstand-anmelden"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p, title: `Flohmarkt-Schilder & Preisschilder zum Ausdrucken | ${NAME}`, desc: "Kostenlose Vorlagen für deinen Flohmarktstand: Preisschilder, Bar & PayPal mit QR-Code, Alles 1 €, Reserviert und mehr. Drucken oder als PDF speichern.", body, nav: "schilder", ld: signLD(p, cr, faq) });
  SIGN_PAGE_IMGS.set(p, SIGNS.map(t => [signImg(t), signAlt(t)]));
}
// Eine Seite je Vorlage
for (const t of SIGNS) {
  const p = signUrl(t), cr = [[NAME, "/"], ["Schilder", SIGN_BASE], [t.chip]];
  const others = SIGNS.filter(x => x !== t);
  const body = crumbs(cr) + `<article class="kb"><h1>${esc(t.h1)}</h1>${signByline}
${(() => { const th = signThemes(); return genHTML(signState(t), th, th.findIndex(g => g.s === t.s), t.kind === "tags" ? "Preisschilder gestalten" : `„${esc(t.chip)}“-Schild gestalten`, t.s === "bar-und-paypal" ? true : "auto"); })()}
<div class="kb-body"><p class="intro">${esc(t.ans)}</p>${t.b().map(([h, x]) => `<h2>${esc(h)}</h2><p>${x}</p>`).join("")}</div>
${faqHTML(t.f)}
<section class="related"><div class="sec-head"><h2>Weitere Schilder-Vorlagen</h2>${more(SIGN_BASE, "Alle")}</div>${grid(others.map(signCard))}</section>
<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2></div>${grid(t.kb.filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p, title: `${t.title} | ${NAME}`, desc: t.desc, body, nav: "schilder", ld: signLD(p, cr, t.f) });
  SIGN_PAGE_IMGS.set(p, others.map(x => [signImg(x), signAlt(x)]));
}
// Hinweis-Kasten in passenden Ratgeber-Artikeln (wird dort eingefügt)
const SIGN_CTA = { "preise-festlegen-flohmarkt": "preisschilder", "checkliste-flohmarktstand": "", "reste-nach-dem-flohmarkt": "zu-verschenken", "wechselgeld-flohmarkt": "bar-und-paypal", "bezahlen-auf-dem-flohmarkt": "bar-und-paypal", "handeln-auf-dem-flohmarkt": "handeln-erwuenscht", "zuruecklegen-lassen-flohmarkt": "reserviert-verkauft", "was-verkauft-sich-gut-flohmarkt": "alles-1-euro", "kinderflohmarkt-verkaufen": "preisschilder", "flohmarktstand-anmelden": "",
  "hofflohmarkt-organisieren": "hofflohmarkt", "kita-flohmarkt-organisieren": "kinderflohmarkt", "diebstahl-am-flohmarktstand": "bin-gleich-zurueck", "standnachbarn-flohmarkt": "bin-gleich-zurueck", "anfassen-flohmarkt": "bitte-nicht-anfassen", "gekauft-wie-gesehen": "getestet" };
// Verweis auf den Preisvergleich in Artikeln rund um Stand und Standgebühr
const FEE_CTA = new Set(["standgebuehr-flohmarkt", "flohmarktstand-anmelden", "checkliste-flohmarktstand"]);
const feeCta = () => MARKETS.filter(m => m.fee).length >= 5 ? `<a class="cta-box" href="${FEE_P}">${ic("tag")}<span><b>Standgebühren im Vergleich</b>Was ein Stand auf den Märkten in Hamburg kostet, mit Link zur Anmeldung.</span>${ic("chev")}</a>` : "";
const signCta = t => `<a class="cta-box" href="${t ? signUrl(t) : SIGN_BASE}">${ic("printer")}<span><b>${!t ? "Gratis: Schilder für deinen Stand" : t.kind === "tags" ? "Gratis: Preisschilder zum Ausdrucken" : `Gratis-Vorlage: „${esc(t.chip)}“-Schild`}</b>${t ? esc(t.short) : "Preisschilder, „Alles 1 €“ und mehr, direkt drucken."}</span>${ic("chev")}</a>`;

/* ---------------------------------------------------------------- Ratgeber */
// Bildform je Bereich im Artikel: Banner (leer), „kante“ (schwarze Kante), „rund“ oder „rund links“ (Kreis neben dem Text).
// Damit nicht jeder Artikel eines Bereichs dasselbe Foto zeigt, wechseln sich je Bereich mehrere Fotos und Formen ab (Bild, Form).
// Formen: "" Banner, "kante" schwarze Kante, "rund" / "rund links" Kreis neben dem Text.
// Ein eigenes Foto für einen Artikel hat Vorrang: bilder/artikel-<kennung>.webp (und -klein.webp).
const KB_POOL = {
  kaufen: [["ratgeber-kaufen", ""], ["banner-mantel", "kante"], ["banner-antik", ""], ["ratgeber-grundwissen", "rund"], ["banner-spiegel", "kante"], ["ratgeber-knigge", ""]],
  verkaufen: [["ratgeber-verkaufen", "kante"], ["banner-aufbau", ""], ["ratgeber-organisieren", ""], ["ratgeber-recht", "kante"], ["banner-mantel", ""]],
  knigge: [["ratgeber-knigge", "rund links"], ["banner-antik", ""], ["banner-mantel", "kante"], ["ratgeber-kaufen", ""]],
  grundwissen: [["ratgeber-grundwissen", "rund"], ["ratgeber-knigge", ""], ["banner-spiegel", "kante"], ["ratgeber-organisieren", ""]],
  organisieren: [["ratgeber-organisieren", ""], ["banner-aufbau", "kante"], ["ratgeber-knigge", "rund"]],
  recht: [["ratgeber-recht", ""], ["ratgeber-verkaufen", "kante"], ["banner-antik", ""]] };
const kbPhoto = a => {
  if (pickImg(`artikel-${a.s}`) || pickImg(`artikel-${a.s}-klein`)) return [`artikel-${a.s}`, ""];
  const pool = (KB_POOL[a.c] || [[`ratgeber-${a.c}`, ""]]).filter(x => pickImg(x[0]) || pickImg(x[0] + "-klein"));
  return pool.length ? pool[KB.filter(x => x.c === a.c).indexOf(a) % pool.length] : [`ratgeber-${a.c}`, ""];
};
// Ratgeber-Artikel mit Hamburg im Titel gelten nur für Hamburg, alle anderen für jeden Flohmarkt
const kbHH = a => /hamburg/i.test(`${a.h} ${a.t}`);
const THUMB_FORM = ["", "rund"];
const clusterThumb = (c, i) => { const x = pickImg(`ratgeber-${c}-klein`) || pickImg(`ratgeber-${c}`); return x ? `<img class="cl-thumb ${THUMB_FORM[i % 2]}" src="${imgUrl(x.f)}" width="760" height="332" alt="${esc(altOf(x))}"${i ? ' loading="lazy"' : ""} decoding="async">` : ""; };
{
  const body = crumbs([[NAME, "/"], ["Ratgeber"]]) + `<section class="hub-head"><h1>Flohmarkt-Ratgeber: Antworten auf die häufigsten Fragen</h1>
<p>Unsere Empfehlungen zum Kaufen, Verkaufen, Handeln und Organisieren, für jeden Flohmarkt in Deutschland. Ein paar Artikel gelten speziell für Hamburg, das steht dann im Titel. Jeder Artikel beginnt mit einer kurzen Antwort, danach folgen die Details.</p>
<div class="search js-only"><label for="kbSearch" class="kicker">Frage suchen</label><input id="kbSearch" type="search" placeholder="z. B. handeln, Steuern, Standgebühr" autocomplete="off"></div></section>
${kcHubCta()}${signCta()}${Object.entries(CLUSTERS).map(([c, info], i) => { const items = KB.filter(a => a.c === c); return items.length ? `<section class="cluster" id="${c}"><div class="cl-head${i % 2 ? " flip" : ""}"><div><h2>${esc(info.t)}</h2><p>${esc(info.p)}</p></div>${clusterThumb(c, i)}</div><div class="qlist">${items.map(a => `<a href="/ratgeber/${a.s}/" data-q="${esc((a.h + " " + a.kw + " " + plain(a.a)).toLowerCase())}"><span>${brColon(esc(a.h))}</span>${ic("chev")}</a>`).join("")}</div></section>` : ""; }).join("")}
${CRED_SRC ? `<p class="meta cl-cred">Symbolfotos: ${credLink()}${S["Bildnachweis"] ? " · " + esc(String(S["Bildnachweis"]).replace(/^Fotos:\s*/, "").replace(/\.$/, "")) : ""}</p>` : ""}
<div class="empty" id="kbLeer" hidden>Dazu gibt es noch keinen Artikel. Versuch einen anderen Begriff, etwa „Steuern“ oder „Stand“.</div>`;
  layout({ p: "/ratgeber/", title: `Flohmarkt-Ratgeber: Die wichtigsten Fragen | ${NAME}`, desc: "Kaufen, verkaufen, handeln, Knigge und Tipps für Veranstalter: Der Ratgeber beantwortet die häufigsten Fragen rund um den Flohmarkt, kurz und verständlich.", body, nav: "ratgeber", ld: G([crumbLD([[NAME, "/"], ["Ratgeber"]]), { "@type": "CollectionPage", name: "Flohmarkt-Ratgeber", hasPart: KB.map(a => ({ "@type": "Article", headline: a.h, url: `${SITE}/ratgeber/${a.s}/` })) }]) });
}
for (const a of KB) {
  const cl = CLUSTERS[a.c] || { t: a.c }, ph = kbPhoto(a);
  const words = (plain(a.a) + " " + a.b.map(x => x.join(" ")).join(" ")).split(/\s+/).length;
  const body = crumbs([[NAME, "/"], ["Ratgeber", "/ratgeber/"], [cl.t, `/ratgeber/#${a.c}`]]) + `<article class="kb"><h1>${esc(a.h)}</h1>
<div class="byline">${kbHH(a) ? `<span>${ic("pin")}Speziell für Hamburg</span>` : `<span>${ic("globe")}Für jeden Flohmarkt</span>`}<span>${ic("update")}Stand: ${AKT_TIME}</span><span>${ic("clock")}${Math.max(2, Math.round(words / 200))} Min. Lesezeit</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${rich(a.a)}</p></div>
${/rund/.test(ph[1]) ? "" : clusterImg(a.c, `kb-photo${ph[1] ? " " + ph[1] : ""}`, false, ph[0])}<div class="kb-body">${/rund/.test(ph[1]) ? sideImg(pickImg(ph[0] + "-klein") ? ph[0] + "-klein" : ph[0], ph[1]) : ""}${a.b.map(([h, p]) => `<h2>${esc(h)}</h2><p>${rich(p)}</p>`).join("")}</div>
${FEE_CTA.has(a.s) ? feeCta() : ""}${a.s in SIGN_CTA || a.c === "verkaufen" ? signCta(SIGN_BY[SIGN_CTA[a.s]]) : ""}
${CAT_BY_S[ART_CTA[a.s]] ? catCta(CAT_BY_S[ART_CTA[a.s]]) : ""}${a.s in KC_ART ? (KC_ART[a.s] ? kcCta(KC_ART[a.s]) : kcHubCta()) : ""}
${a.f.length ? `<section class="faq"><h2>Häufige Fragen</h2>${a.f.map(([q, x]) => `<details><summary>${esc(q)}</summary><p>${rich(x)}</p></details>`).join("")}</section>` : ""}
${a.x ? '<p class="hint">Unser Tipp: Verbindliche Auskünfte für deinen Fall bekommst du bei den zuständigen Stellen, zum Beispiel beim Finanzamt, beim Bezirksamt oder beim Veranstalter des Markts.</p>' : ""}
<p class="ai-note">Dieser Text ist mit Unterstützung von künstlicher Intelligenz entstanden.</p>
<section class="related"><div class="sec-head"><h2>Das könnte dich auch interessieren</h2></div>${grid(a.r.map(kbCard))}</section></article>`;
  layout({ p: `/ratgeber/${a.s}/`, title: `${a.t} | ${NAME}`, desc: a.d, body, nav: "ratgeber", art: JSON.stringify([a.h, a.a, a.b, a.f, !!a.x]), ld: G([
    { "@type": "Article", headline: a.h, description: a.d, dateModified: AKT_ISO, author: ORG_AUTHOR, publisher: ORG_PUB, mainEntityOfPage: `${SITE}/ratgeber/${a.s}/` },
    ...(a.f.length ? [{ "@type": "FAQPage", mainEntity: a.f.map(([q, x]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(x) } })) }] : []),
    crumbLD([[NAME, "/"], ["Ratgeber", "/ratgeber/"], [cl.t, `/ratgeber/#${a.c}`], [a.h]])]) });
}

/* ---------------------------------------------------------------- Kauf-Check */
if (KC_ON) {
  const kcLine = x => `<span class="kc-q">${x.l && !x.tip ? `<b>${esc(x.l)}:</b> ` : x.tip ? `<b>${esc(x.l)}:</b> ` : ""}${nbU(x.x)}</span>${x.d ? `<span class="kc-x">${nbU(x.d)}</span>` : ""}`;
  const kcList = (pts, kind) => `<ul class="kc-list">${pts.map(x => x.tip ? `<li class="kc-tip"><span>${kcLine(x)}</span></li>` : `<li><label class="kc-pt"><input type="checkbox" data-k="${kind}"><span class="kc-box" aria-hidden="true"></span><span>${kcLine(x)}</span></label></li>`).join("")}</ul>`;
  const kcBody = (i, hl) => {
    const sec = (h, sub, pts, kind) => pts.length ? `<div class="kc-blk"><h${hl}>${h}</h${hl}>${sub ? `<p class="kc-sub">${sub}</p>` : ""}${kcList(pts, kind)}</div>` : "";
    return `<div class="kc-check"><p class="kc-how">Beantworte die Fragen. Was bei deinem Teil zutrifft, tippst du an.</p>${hl === 2 ? photoTip : ""}${sec("Echt oder Fälschung?", "", i.e, "e")}${sec("Gesperrt oder gestohlen?", "", i.g, "g")}${sec("In Ordnung?", "", i.z, "z")}
<div class="kc-res js-only" aria-live="polite"><p>Noch nichts angetippt. Hier erscheint deine Einschätzung.</p></div>
${i.f.length ? `<div class="kc-blk kc-ask"><h${hl}>Frag am Stand</h${hl}><ul>${i.f.map(q => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}</div>`;
  };
  const photoTip = `<div class="kc-photo">${ic("camera")}<span>Tipp: Mach ein Foto und zoom ran</span></div>`;
  // Fehler melden: per E-Mail an die Impressum-Adresse, sonst über das Impressum
  const kcMail = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(IMP_MAIL);
  const kcFix = subj => kcMail ? `<a href="mailto:${esc(IMP_MAIL)}?subject=${encodeURIComponent("Kauf-Check: " + subj)}">Schreib uns</a>` : `<a href="/impressum/">Schreib uns</a>`;
  const kcHint = (subj = "Hinweis") => `<p class="hint"><b>Alle Angaben ohne Gewähr. Die Nutzung des Kauf-Checks erfolgt auf eigenes Risiko. Für Kaufentscheidungen, die auf Grundlage dieser Hinweise getroffen werden, übernehmen wir keine Haftung.</b> Der Kauf-Check hilft beim genauen Hinsehen, ist aber kein Echtheitsnachweis und ersetzt keine Prüfung durch Fachleute. Gute Fälschungen sind auch für Kenner schwer zu erkennen. Dir ist ein Fehler aufgefallen? ${kcFix(subj)}, wir korrigieren ihn.</p><p class="ai-note">Die Prüfpunkte sind mit Unterstützung von künstlicher Intelligenz entstanden und anhand öffentlicher Quellen geprüft.</p>`;
  const kcTop = `<p class="kc-top">Hinweise ohne Gewähr, Nutzung auf eigenes Risiko. Eine Einschätzung, kein Echtheitsnachweis.</p>`;
  const shortN = i => i.n.replace(/\s*\([^)]*\)/g, "");
  const areaItems = a => KC.filter(i => i.a === a);
  const areaTip = a => KC_AREAS[a].tip ? `<p class="hint kc-areatip"><b>Wichtig bei Elektronik:</b> ${esc(KC_AREAS[a].tip)}</p>` : "";
  const qItem = i => `<a href="${kcUrl(i)}" data-q="${esc((i.n + " " + i.kw + " " + KC_AREAS[i.a].t).toLowerCase())}"><span>${esc(i.n)}</span>${ic("chev")}</a>`;
  // Übersicht
  {
    const AREAS_ON = Object.keys(KC_AREAS).filter(a => areaItems(a).length);
    const body = crumbs([[NAME, "/"], ["Kauf-Check"]]) + `<section class="hub-head"><h1>Kauf-Check: Echt und in Ordnung?</h1>
<p>Für ${KC.length} typische Flohmarkt-Artikel: Woran du Fälschungen erkennst, ob ein Gerät gesperrt sein könnte und worauf du beim Zustand achtest. Am Stand tippst du einfach an, was dir auffällt, und bekommst eine Einschätzung. Funktioniert auf jedem Flohmarkt.</p>
<div class="search kc-search js-only"><label for="kcSearch" class="kicker">Was willst du kaufen?</label><input id="kcSearch" type="search" enterkeyhint="go" placeholder="z. B. Levi's, iPhone, LEGO, Silber" autocomplete="off" aria-controls="kcSugg"><div class="kc-sugg" id="kcSugg" role="listbox" hidden></div></div>
${photoTip}</section>
${AREAS_ON.map(a => `<section class="cluster" id="${a}"><div class="cl-head"><div><h2>${esc(KC_AREAS[a].t)}</h2><p>${esc(KC_AREAS[a].p)}</p></div></div><div class="qlist">${areaItems(a).map(qItem).join("")}</div><p class="kc-all">${more(`${KC_P}${a}/`, `Alle ${areaItems(a).length} Checks: ${esc(KC_AREAS[a].t)}`)}</p></section>`).join("")}
<div class="empty" id="kcLeer" hidden>Dazu gibt es noch keinen Check. Versuch einen anderen Begriff, etwa „Uhr“, „Jacke“ oder „Handy“.</div>
${kcHint()}`;
    layout({ p: KC_P, title: `Kauf-Check: Fälschungen erkennen auf dem Flohmarkt | ${NAME}`, desc: pickDesc(`Echt oder Fake, gesperrt oder in Ordnung? Prüfpunkte für ${KC.length} Flohmarkt-Artikel von Levi's bis LEGO, von iPhone bis Meissen. Direkt am Stand abhaken.`), body, nav: "ratgeber",
      ld: G([crumbLD([[NAME, "/"], ["Kauf-Check"]]), { "@type": "CollectionPage", name: "Kauf-Check", hasPart: AREAS_ON.map(a => ({ "@type": "WebPage", name: KC_AREAS[a].t, url: `${SITE}${KC_P}${a}/` })) }]) });
  }
  // Bereichsseiten
  for (const [a, A] of Object.entries(KC_AREAS)) {
    const its = areaItems(a); if (!its.length) continue;
    const cr = [[NAME, "/"], ["Kauf-Check", KC_P], [A.t]];
    const cats = A.cat && CAT_BY_S[A.cat] ? catCta(CAT_BY_S[A.cat]) : "";
    const body = crumbs(cr) + `<article class="kb"><h1>${esc(A.t)}: Echtheit und Zustand prüfen</h1>
<div class="byline"><span>${ic("globe")}Für jeden Flohmarkt</span><span>${ic("search")}${its.length} Artikel</span><span>${ic("list")}${its.reduce((n, i) => n + kcCnt(i), 0)} Prüfpunkte</span><span>${ic("update")}Stand: ${SEITE_TIME}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(A.p)}</p></div>${areaTip(a)}${kcTop}
<nav class="chips kc-toc" aria-label="Artikel in diesem Bereich">${its.map(i => `<a class="chip" href="${i.own ? kcUrl(i) : "#" + i.s}">${esc(i.n)}</a>`).join("")}</nav>
${photoTip}
${its.map(i => `<section class="kc-item" id="${i.s}"><h2>${esc(i.n)}</h2><p class="kc-k">${esc(i.k)}</p>${i.own ? `<p><a class="route kc-go" href="${kcUrl(i)}">Zum Check mit ${kcCnt(i)} Prüfpunkten${ic("chev")}</a></p>` : kcBody(i, 3)}</section>`).join("")}
${cats}
<section class="related"><div class="sec-head"><h2>Weitere Bereiche</h2>${more(KC_P, "Alle")}</div><nav class="chips">${Object.keys(KC_AREAS).filter(x => x !== a && areaItems(x).length).map(x => `<a class="chip" href="${KC_P}${x}/">${esc(KC_AREAS[x].t)}</a>`).join("")}</nav></section>
${A.kb.some(k => KBY[k]) ? `<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2></div>${grid(A.kb.filter(k => KBY[k]).map(kbCard))}</section>` : ""}
${kcHint(A.t)}</article>`;
    layout({ p: `${KC_P}${a}/`, title: `${[`${A.t} gebraucht kaufen: echt und in Ordnung?`, `${A.t}: echt und in Ordnung?`].find(x => x.length <= 60) || A.t} | ${NAME}`, desc: pickDesc(`${A.p} ${its.length} Artikel mit Prüfpunkten zum Abhaken am Stand.`, A.p), body, nav: "ratgeber",
      ld: G([crumbLD(cr), { "@type": "ItemList", itemListElement: its.map((i, n) => ({ "@type": "ListItem", position: n + 1, name: i.n, url: SITE + kcUrl(i) })) }]) });
  }
  // Eigene Seiten für die gefragtesten Artikel
  for (const i of KC.filter(x => x.own)) {
    const A = KC_AREAS[i.a], cr = [[NAME, "/"], ["Kauf-Check", KC_P], [A.t, `${KC_P}${i.a}/`], [i.n]], n = kcCnt(i), sn = shortN(i);
    const h1 = i.e.length ? `${i.n}: echt und in Ordnung?` : i.g.length ? `${i.n} gebraucht kaufen: gesperrt oder in Ordnung?` : `${i.n} gebraucht kaufen: darauf achten`;
    const fit = (...c) => c.find(x => x.length <= 60) || c[c.length - 1];
    const title = i.t || (i.e.length ? fit(`${sn}: Fälschung erkennen & gebraucht prüfen`, `${sn}: Fälschung erkennen & prüfen`, `${sn}: Fälschung erkennen`, `${sn}: echt oder Fake?`) : i.g.length ? fit(`${sn} gebraucht: Sperre & Zustand prüfen`, `${sn} gebraucht prüfen`) : fit(`${sn} gebraucht kaufen: darauf achten`, `${sn} gebraucht kaufen`));
    const labs = [...i.e, ...i.g, ...i.z].filter(x => x.l && !x.tip).map(x => x.l);
    const dOf = k => `${i.e.length ? "Echt oder Fake? " : ""}${n} Prüfpunkte für ${sn} vom Flohmarkt${k ? ": " + labs.slice(0, k).join(", ") : ""}. Direkt am Stand abhaken, kostenlos.`;
    const desc = i.d || pickDesc(dOf(4), dOf(3), dOf(2), dOf(1), dOf(0));
    const ms = i.m.map(x => MBY[x]).filter(Boolean);
    i.m.filter(x => !MBY[x]).forEach(x => warn("Kauf-Check", `${i.n}: Markt „${x}“ unter „Passende Märkte“ gibt es nicht.`));
    const sib = KC.filter(x => x.a === i.a && x !== i);
    const body = crumbs(cr) + `<article class="kb kc-page"><h1>${esc(h1)}</h1>
<div class="byline"><span>${ic("globe")}Für jeden Flohmarkt</span><span>${ic("list")}${n} Prüfpunkte</span><span>${ic("update")}Stand: ${AKT_TIME}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(i.k)}</p></div>${areaTip(i.a)}${kcTop}
${kcBody(i, 2)}
${ms.length ? `<section class="related"><div class="sec-head"><h2>Hier wirst du in Hamburg fündig</h2></div>${grid(ms.map(mCard))}</section>` : ""}
${sib.length ? `<section class="related"><div class="sec-head"><h2>Weitere Checks: ${esc(A.t)}</h2>${more(`${KC_P}${i.a}/`, "Alle")}</div><div class="qlist">${sib.map(qItem).join("")}</div></section>` : ""}
${A.kb.some(k => KBY[k]) ? `<section class="related"><div class="sec-head"><h2>Aus dem Ratgeber</h2></div>${grid(A.kb.filter(k => KBY[k]).map(kbCard))}</section>` : ""}
${kcHint(i.n)}</article>`;
    layout({ p: kcUrl(i), title: `${title} | ${NAME}`, desc, body, nav: "ratgeber", art: JSON.stringify([h1, i.k, i.e, i.g, i.z, i.f, A.tip || ""]), ld: G([
      { "@type": "Article", headline: h1, description: desc, dateModified: AKT_ISO, author: ORG_AUTHOR, publisher: ORG_PUB, mainEntityOfPage: SITE + kcUrl(i) },
      crumbLD(cr)]) });
  }
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
<noscript><p class="small">Der Code-Baukasten braucht JavaScript.</p></noscript>
<label class="bdg-sel js-only">Dein Markt<select id="bdgSel" data-site="${esc(SITE)}">${[...MARKETS].sort((a, b) => a.name.localeCompare(b.name, "de")).map(m => `<option value="${m.slug}">${esc(m.name)}</option>`).join("")}</select></label>
<div class="bdg-prev js-only" id="bdgPrev" aria-label="Vorschau"></div>
<label class="bdg-code js-only">Code für deine Website<textarea id="bdgCode" rows="4" readonly></textarea></label>
<button class="btn js-only" id="bdgCopy" type="button">Code kopieren</button></section></article>`;
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
    `<h3>Icons</h3><p><a href="https://phosphoricons.com" rel="noopener">Phosphor Icons</a>, MIT-Lizenz (<a href="/assets/icons-lizenz.txt">Lizenztext</a>). Frosch-Icon und Symbole im Schilder-Designer: <a href="https://fontawesome.com" rel="noopener">Font Awesome Free</a>, Lizenz <a href="https://creativecommons.org/licenses/by/4.0/deed.de" rel="noopener">CC BY 4.0</a>, unverändert.</p>`].join("");
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
  // Über Flohlotse: wie die Seite arbeitet. Wer dahintersteht, steht im Impressum (Daten nur aus dem Sheet).
  {
    const cr = [[NAME, "/"], [`Über ${NAME}`]];
    const tools = [`der <a href="/ratgeber/">Ratgeber</a> beantwortet in ${KB.length} Artikeln die häufigsten Fragen rund ums Kaufen, Verkaufen und Handeln`,
      `mit dem <a href="/flohmarkt-schilder/">Schilder-Designer</a> gestaltest du Preisschilder und Schilder für deinen Stand und druckst sie aus`,
      ...(KC_ON ? [`der <a href="${KC_P}">Kauf-Check</a> hilft dir bei ${KC.length} typischen Artikeln, Fälschungen und Mängel zu erkennen`] : [])];
    const body = crumbs(cr) + `<article class="kb"><h1>Über ${esc(NAME)}</h1>
<div class="byline"><span>${ic("update")}Stand: ${SEITE_TIME}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(NAME)} hat zwei Teile: einen Kalender mit den Flohmärkten in Hamburg und bis 30 Kilometer drumherum, und Hilfen fürs Kaufen und Verkaufen, die auf jedem Flohmarkt in Deutschland funktionieren. Alles ist kostenlos und ohne Anmeldung.</p></div>
<div class="kb-body">
<h2>Termine für Hamburg und Umgebung</h2>
<p>Im Kalender stehen ${MARKETS.length} Märkte mit ihren Terminen. Die Angaben stammen aus öffentlichen Quellen der Veranstalter, vor allem aus ihren Websites. Die Seite wird jede Nacht neu erstellt, vergangene Termine verschwinden dabei von selbst.</p>
<p>Ein automatischer Abgleich schaut regelmäßig auf die Websites der Veranstalter und meldet uns, wenn sich dort etwas geändert hat. Übernommen wird davon nichts automatisch. Märkte können trotzdem kurzfristig ausfallen, schau vor dem Besuch am besten noch einmal beim Veranstalter nach.</p>
<h2>Gut vorbereitet auf jeden Flohmarkt</h2>
<p>${tools.map(cap).join(". ")}. Das alles funktioniert auf jedem Flohmarkt, nicht nur in Hamburg.</p>
<h2>Kostenlos, ohne Konto, ohne Tracking</h2>
<p>${esc(NAME)} kostet nichts und zeigt keine Werbebanner. Es gibt kein Konto und keine Analyse-Werkzeuge. Deine Merkliste bleibt nur in deinem Browser. Mehr dazu in der <a href="/datenschutz/">Datenschutzerklärung</a>.</p>
<h2>Fehler gefunden oder fehlt ein Markt?</h2>
<p>Sag uns Bescheid, am einfachsten über die Seite <a href="/veranstalter/">Für Veranstalter</a>. Wer hinter ${esc(NAME)} steht, steht im <a href="/impressum/">Impressum</a>.</p>
</div></article>`;
    layout({ p: ABOUT_P, title: `Über ${NAME}: So entstehen die Termine`, desc: `Wie ${NAME} arbeitet: Termine für Hamburg und Umgebung nach Angaben der Veranstalter, dazu Ratgeber, Schilder und Kauf-Check für jeden Flohmarkt.`,
      body, nav: "", ld: G([crumbLD(cr), { "@type": "AboutPage", name: `Über ${NAME}`, url: SITE + ABOUT_P }]) });
  }
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
<h2>4. Cookies, Tracking und warum es hier keinen Cookie-Banner gibt</h2><p>Diese Website setzt keine Cookies. Es gibt keine Reichweitenmessung, keine Werbung, keine Social-Media-Plugins, keine eingebetteten Videos und kein Nutzerprofil.</p><p>Einzige Ausnahme ist die <a href="/merkliste/">Merkliste</a>: Erst wenn du bei einem Markt auf das Herz tippst, legt dein Browser die Liste deiner gemerkten Märkte im sogenannten Local Storage auf deinem Gerät ab. Gespeichert werden nur die Kennungen der Märkte (zum Beispiel „flohschanze“), sonst nichts. Ist eine Merkliste vorhanden, liest die Seite sie beim Aufruf aus, um deine Herzen anzuzeigen. Die Liste bleibt auf deinem Gerät und wird nicht an uns übertragen. Du kannst sie jederzeit auf der Seite Merkliste mit „Merkliste leeren“ löschen oder über die Einstellungen deines Browsers. Sicherst du die Merkliste als Link, stehen die Kennungen hinter dem #-Zeichen der Adresse; dieser Teil wird beim Aufruf nicht an den Server gesendet.</p><p>Eine Einwilligung ist nach § 25 Abs. 1 TDDDG nötig, wenn eine Website Informationen auf dem Gerät speichert oder von dort ausliest. Das gilt nicht, wenn das unbedingt erforderlich ist, damit eine Funktion bereitsteht, die du ausdrücklich nutzen möchtest (§ 25 Abs. 2 Nr. 2 TDDDG). So ist es bei der Merkliste: Sie speichert nur, wenn du sie selbst nutzt, und nur dafür. Darüber hinaus wird nichts gespeichert oder ausgelesen. Deshalb gibt es hier keinen Cookie-Banner.</p><p>Zwei Funktionen brauchen deine ausdrückliche Handlung und starten erst dann: die Karte („Karte laden“) und die Standortabfrage („Mein Standort“). Beide sind in Abschnitt 9 beschrieben.</p>
<h2>5. Termine eintragen</h2><p>${formKind === "google" ? "Veranstalter können Termine über ein Formular von Google Formulare (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland) einreichen. Das Formular öffnet sich erst, wenn du den Link anklickst. Dabei gelten zusätzlich die Datenschutzbestimmungen von Google." : formKind === "other" ? `Veranstalter können Termine über ein Formular bei ${esc(formHost)} einreichen. Das Formular öffnet sich erst, wenn du den Link anklickst. Dabei gelten zusätzlich die Datenschutzbestimmungen dieses Anbieters.` : "Veranstalter können uns Termine per E-Mail schicken."} Wir verarbeiten die Angaben zum Markt und deine E-Mail-Adresse. Die Marktdaten veröffentlichen wir nach Prüfung. Die E-Mail-Adresse nutzen wir nur für Rückfragen zu deinem Eintrag und veröffentlichen sie nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und f DSGVO. Wir löschen die E-Mail-Adresse ${ph("Datenschutz: Löschfrist Formular", "Frist, z. B. zwölf Monate nach dem letzten Termin")}.</p>
<h2>6. Kontakt per E-Mail</h2><p>Schreibst du uns eine E-Mail, verarbeiten wir deine Angaben, um die Anfrage zu beantworten (Art. 6 Abs. 1 lit. b oder f DSGVO), und löschen sie, sobald die Anfrage erledigt ist und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.${f("Datenschutz: E-Mail-Anbieter") ? ` Unser E-Mail-Postfach liegt bei ${esc(f("Datenschutz: E-Mail-Anbieter"))}.` : ""}</p>
<h2>7. Links zu anderen Websites</h2><p>Links wie „Route planen“ führen zu Google Maps oder zu Websites der Veranstalter. Erst wenn du einen solchen Link anklickst, werden Daten an den jeweiligen Anbieter übertragen. Das gilt auch für „Teilen“: Erst wenn du darauf tippst, öffnet sich die Teilen-Funktion deines Geräts mit einer vorformulierten Nachricht. Welche App du dann wählst, entscheidest du. Vorher werden keine Daten an andere Dienste übertragen.</p>
<h2>8. Angaben zu Märkten und Veranstaltern</h2><p>Im Kalender nennen wir zu jedem Markt den Namen des Veranstalters, manchmal ist das eine Einzelperson. Diese Angaben stammen aus öffentlich zugänglichen Quellen, in der Regel von der Website des Veranstalters oder aus dessen eigener Ankündigung, oder der Veranstalter hat sie uns selbst geschickt. Wir veröffentlichen sie, damit Besucher wissen, wer hinter einem Markt steht und an wen sie sich wenden können. Rechtsgrundlage ist unser berechtigtes Interesse an einem vollständigen und überprüfbaren Flohmarkt-Kalender (Art. 6 Abs. 1 lit. f DSGVO). Verarbeitet werden der Name des Veranstalters, die Angaben zum Markt und, soweit öffentlich, die Adresse seiner Website. Die Angaben bleiben veröffentlicht, solange der Markt im Kalender steht. Empfänger sind unser Hoster (Abschnitt 2) und Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland, weil wir den Kalender in einer Tabelle bei Google pflegen. Du bist Veranstalter und möchtest, dass ein Eintrag geändert oder entfernt wird? Dann schreib uns an die E-Mail-Adresse in Abschnitt 1. Du kannst der Veröffentlichung jederzeit widersprechen (Art. 21 DSGVO), wir ändern oder entfernen den Eintrag dann umgehend.</p>
<h2>9. Suche, Umkreissuche und Karte</h2><p>Die Suche nach Märkten und Terminen läuft vollständig in deinem Browser. Deine Suchbegriffe werden nicht an uns übertragen und nicht gespeichert. Die Umkreissuche nach Postleitzahl oder Standort läuft ebenfalls vollständig in deinem Browser. Postleitzahl und Standort werden nicht an uns übertragen und nicht gespeichert. Deinen Standort fragt der Browser nur ab, wenn du auf „Mein Standort“ tippst und der Abfrage in deinem Browser zustimmst. Wie dein Gerät den Standort ermittelt, legt dein Browser oder Betriebssystem fest; je nach Gerät nutzt es dafür einen eigenen Ortungsdienst seines Herstellers.</p><p>Die Flohmarkt-Tour auf der Merkliste wird ebenfalls vollständig in deinem Browser berechnet. Startpunkt, Postleitzahl und Zeiten werden nicht an uns übertragen; deine Einstellungen (ohne Standort) bleiben nur im Speicher deines Browsers. Erst wenn du auf „In Google Maps öffnen“ oder „Genau prüfen“ tippst, öffnet sich Google Maps mit der Route, dabei gelten die Datenschutzhinweise von Google.</p><p>Was du im Kauf-Check antippst, bleibt nur auf deinem Gerät und ist nach dem Neuladen der Seite weg.</p><p>Der Schilder-Designer läuft ebenfalls vollständig in deinem Browser. Was du eintippst, auch ein PayPal.me-Name für den QR-Code zum Bezahlen, wird nicht an uns übertragen und nicht gespeichert. Der QR-Code entsteht auf deinem Gerät. Wer den gedruckten Code scannt, öffnet PayPal, dort gelten die Datenschutzhinweise von PayPal.</p><p>Beim Kalender-Abo ruft dein Kalenderprogramm die Kalenderdatei des Markts regelmäßig von unserem Server ab. Dabei fallen nur die üblichen Server-Protokolle an (siehe Abschnitt zum Hosting). Wir erfahren nicht, wer ein Abo nutzt.</p>${HAS_MAP ? `<p>Die Karte auf der Seite „Alle Märkte“ lädt erst, wenn du auf „Karte laden“ tippst. Dann werden Kartenbilder von Servern der OpenStreetMap Foundation (St John’s Innovation Centre, Cowley Road, Cambridge, CB4 0WS, Vereinigtes Königreich) geladen, dabei wird deine IP-Adresse übertragen. Rechtsgrundlage ist deine Einwilligung durch den Klick (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Die Einwilligung gilt nur für den aktuellen Seitenaufruf und wird nicht gespeichert: Nach dem Neuladen der Seite bleibt die Karte wieder aus. Du kannst sie also jederzeit für die Zukunft widerrufen, indem du die Seite verlässt oder neu lädst. Für das Vereinigte Königreich gilt ein Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO). Die Kartensoftware (Leaflet) gehört zur Website selbst und wird nicht von OpenStreetMap geladen. Mehr dazu in der <a href="https://osmfoundation.org/wiki/Privacy_Policy" rel="noopener">Datenschutzerklärung der OpenStreetMap Foundation</a>.</p>` : ""}
<h2>10. Deine Rechte</h2><p>Soweit wir personenbezogene Daten von dir verarbeiten, hast du diese Rechte:</p><ul><li>Auskunft über deine Daten (Art. 15 DSGVO)</li><li>Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li><li>Löschung (Art. 17 DSGVO)</li><li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li><li>Datenübertragbarkeit (Art. 20 DSGVO)</li><li>Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO)</li></ul><p><b>Widerspruchsrecht (Art. 21 DSGVO):</b> Stützen wir eine Verarbeitung auf unser berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO), kannst du ihr aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit widersprechen.</p><p>Um ein Recht auszuüben, genügt eine formlose Nachricht an die E-Mail-Adresse in Abschnitt 1.</p><p><b>Beschwerde:</b> Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), zum Beispiel beim <a href="https://datenschutz-hamburg.de" rel="noopener">Hamburgischen Beauftragten für Datenschutz und Informationsfreiheit</a>.</p>
<h2>11. Pflicht zur Angabe von Daten, automatisierte Entscheidungen</h2><p>Du kannst diese Website nutzen, ohne Angaben zu deiner Person zu machen. Es besteht keine gesetzliche oder vertragliche Pflicht, uns Daten bereitzustellen. Automatisierte Entscheidungen oder Profiling (Art. 22 DSGVO) finden nicht statt.</p>
<p>Stand: ${ph("Datenschutz: Stand", "Datum")}</p></div></article>`;
  layout({ p: "/datenschutz/", title: `Datenschutz | ${NAME}`, desc: `Datenschutzerklärung von ${NAME}.`, body: ds, noindex: true });
}

/* ---------------------------------------------------------------- Flohmärkte in Zahlen */
// Zitierbare Fakten aus dem eigenen Kalender, jede Nacht neu berechnet. Gut für Suchmaschinen und KI-Antworten.
/* ---------------------------------------------------------------- Flohmarkt unter der Woche (Montag bis Freitag) */
{
  const WDA = ["sonntags", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags"];
  const evs = EVENTS.filter(e => e.date.getUTCDay() >= 1 && e.date.getUTCDay() <= 5), lv = evs.filter(e => !e.cancelled);
  const msOf = list => [...new Set(list.map(e => e.m))];
  const mLink = m => `[${m.name}](/flohmarkt/${m.slug}/)`;
  const byWd = [1, 2, 3, 4, 5].map(d => ({ d, evs: lv.filter(e => e.date.getUTCDay() === d) })).filter(x => x.evs.length);
  const topWd = [...byWd].sort((a, b) => b.evs.length - a.evs.length)[0];
  // Abendmärkte: Beginn ab 16 Uhr
  const eve = lv.filter(e => e.start && parseInt(e.start, 10) >= 16), eveMs = msOf(eve);
  const nx = lv[0], night = CAT_BY_S["nachtflohmarkt-hamburg"];
  const { sat, sun, sunOnly } = weekendDays(), wSat = sunOnly ? addDays(sat, 7) : sat, wSun = addDays(wSat, 1);
  const wN = EVENTS.filter(e => !e.cancelled && (e.k === key(wSat) || e.k === key(wSun))).length;
  const wSpan = wSat.getUTCMonth() === wSun.getUTCMonth() ? `${wSat.getUTCDate()}. und ${wSun.getUTCDate()}. ${MON[wSun.getUTCMonth()]}` : `${wSat.getUTCDate()}. ${MON[wSat.getUTCMonth()]} und ${wSun.getUTCDate()}. ${MON[wSun.getUTCMonth()]}`;
  const parts = byWd.map(x => `${x.evs.length} ${WDA[x.d]}`);
  const ans = lv.length
    ? `Unter der Woche gibt es in Hamburg nur wenige Flohmärkte: In den nächsten ${HORIZON} Tagen ${lv.length === 1 ? "steht ein Termin" : "stehen " + lv.length + " Termine"} von Montag bis Freitag im Kalender${parts.length > 1 ? ", " + listNames(parts, 5) : ""}.${nx ? ` Der nächste: ${nx.m.name} am ${fmtDate(nx.date)}${nx.start ? ", " + timeText(nx) : ""}.` : ""}`
    : `In den nächsten ${HORIZON} Tagen steht kein Flohmarkt von Montag bis Freitag im Kalender. Die meisten Märkte in Hamburg öffnen samstags und sonntags.`;
  const faq = [
    ["Gibt es in Hamburg Flohmärkte unter der Woche?", lv.length ? `Ja, aber nur wenige. In den nächsten ${HORIZON} Tagen ${lv.length === 1 ? "steht ein Termin" : "stehen " + lv.length + " Termine"} von Montag bis Freitag im ${NAME}-Kalender${topWd && byWd.length > 1 ? `, die meisten ${WDA[topWd.d]}` : ""}. Die meisten Märkte öffnen samstags und sonntags.` : `Gerade steht kein Termin von Montag bis Freitag im Kalender. Die meisten Märkte öffnen samstags und sonntags: [alle Flohmärkte am Wochenende](/wochenende/).`],
    ...byWd.slice().sort((a, b) => b.evs.length - a.evs.length).slice(0, 3).map(x => { const ms = msOf(x.evs), f = x.evs[0]; return [`Welcher Flohmarkt ist ${WDA[x.d]} in Hamburg?`, `${ms.length === 1 ? "Im Kalender steht" : "Im Kalender stehen"} ${listMore(ms.map(mLink), 4)}. Der nächste Termin: ${f.m.name} am ${fmtDate(f.date)}${f.start ? ", " + timeText(f) : ""}.`]; }),
    ...(eveMs.length ? [["Gibt es Flohmärkte am Abend?", `Ja. ${listMore(eveMs.map(mLink), 4)} ${eveMs.length === 1 ? "beginnt" : "beginnen"} erst am späten Nachmittag oder Abend.${night ? ` Alle Abendtermine stehen unter ${catLink("nachtflohmarkt-hamburg", "Nachtflohmarkt Hamburg")}.` : ""}`]] : []),
    ["Wann ist der nächste Flohmarkt am Wochenende?", wN ? `Am Wochenende ${wSpan} ${wN === 1 ? "steht ein Flohmarkt" : "stehen " + wN + " Flohmärkte"} im Kalender: [alle Termine am Wochenende](/wochenende/).` : `Alle kommenden Termine stehen unter [Flohmarkt Hamburg am Wochenende](/wochenende/) und [alle Termine](/termine/).`]];
  const wdBox = byWd.length ? `<section class="block"><h2>Nach Wochentag</h2><dl class="facts">${byWd.map(x => `<div><dt>${ic("cal")}${WDL[x.d]} · ${x.evs.length} ${x.evs.length === 1 ? "Termin" : "Termine"}</dt><dd>${msOf(x.evs).map(m => { const f = x.evs.find(e => e.m === m); return `<a href="/flohmarkt/${m.slug}/">${esc(m.name)}</a> <span class="meta">ab ${fmtShort(f.date)}</span>`; }).join("<br>")}</dd></div>`).join("")}</dl>${eveMs.length ? `<p class="meta wk-eve">${ic("moon")}<span>Am Abend: ${listNames(eveMs.map(m => `<a href="/flohmarkt/${m.slug}/">${esc(m.name)}</a>`), 4)} ${eveMs.length === 1 ? "beginnt" : "beginnen"} erst ab ${hmText(eve.map(e => tFirst(e.start)).sort()[0])} Uhr.</span></p>` : ""}</section>` : "";
  const cr = [[NAME, "/"], ["Termine", "/termine/"], ["Unter der Woche"]];
  const body = crumbs(cr) + `<article class="kb"><h1>Flohmarkt unter der Woche in Hamburg</h1><div class="byline"><span>${ic("cal")}Montag bis Freitag</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${esc(ans)}</p></div>${wdBox}${lv.length ? nearBox() : ""}
<section class="block"><h2>Alle Termine von Montag bis Freitag</h2>${dayStrip(evs)}${groupList(evs, 3, true) || '<p class="meta">Gerade keine Termine unter der Woche im Kalender.</p>'}</section>
${night && night.evs.some(e => !e.cancelled) ? catCta(night) : ""}<a class="more" href="/wochenende/">Schon fürs Wochenende planen: alle Flohmärkte am ${esc(wSpan)}</a>
${faqBlock(faq)}
<section class="related"><div class="sec-head"><h2>Weitere Zeiträume und Bezirke</h2></div>${regionChips(WEEK_P)}</section>
<section class="related"><div class="sec-head"><h2>Vor dem Besuch lesen</h2></div>${grid(["nachtflohmarkt", "bezahlen-auf-dem-flohmarkt", "was-mitnehmen-flohmarkt"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p: WEEK_P, title: `Flohmarkt unter der Woche in Hamburg: Termine Mo–Fr | ${NAME}`,
    desc: pickDesc(lv.length ? `Flohmarkt unter der Woche in Hamburg: ${lv.length} Termine von Montag bis Freitag${darunter(lv)}. Mit Uhrzeit, Adresse und Abendmärkten.` : "",
      lv.length ? `Flohmarkt unter der Woche in Hamburg: ${lv.length} Termine von Montag bis Freitag. Alle Märkte mit Uhrzeit und Adresse, dazu Märkte am Abend.` : "",
      "Flohmärkte unter der Woche in Hamburg und im Umland: alle Termine von Montag bis Freitag mit Uhrzeit und Adresse, dazu Märkte am Abend."),
    body, nav: "termine", noindex: !lv.length, ld: G([crumbLD(cr), faqLD(faq)].concat(evs.map(eventLD))) });
}

/* ---------------------------------------------------------------- Standgebühren im Vergleich */
// Günstigster Meterpreis aus dem Text der Spalte „Standgebühr“: „13 € pro Meter, mit PKW 15 €“ → 13, „Sa 12 €, Mi 10 € pro Meter“ → 10,
// „Privat ab 30 € für 3 m“ → 10 (ungefähr). Aufschläge („+3 €“, „2 € pro Meter mehr“) zählen nicht. Kein Meterpreis erkennbar → null.
const feePerMeter = fee => {
  const t = String(fee || ""), v = [], N = "(\\d+(?:,\\d+)?)(?:\\s*[–-]\\s*\\d+(?:,\\d+)?)?\\s*€", PM = "pro\\s+(?:Stand|Tisch)?meter", num = x => parseFloat(x.replace(",", "."));
  for (const x of t.matchAll(new RegExp(`${N}\\s*(?:${PM}|\\/\\s*m(?![a-zäöü]))`, "gi"))) {
    if (/\+\s*$/.test(t.slice(Math.max(0, x.index - 2), x.index)) || /^\s*mehr/.test(t.slice(x.index + x[0].length))) continue;
    v.push({ pm: num(x[1]), approx: false });
  }
  for (const x of t.matchAll(new RegExp(`${N}\\s*,\\s*[^\\d,;€]{1,14}?\\d+(?:,\\d+)?\\s*€\\s*${PM}`, "gi"))) v.push({ pm: num(x[1]), approx: false });
  for (const x of t.matchAll(new RegExp(`${N}\\s*(?:pro|für)\\s+(\\d)\\s*m\\b`, "gi"))) v.push({ pm: num(x[1]) / +x[2], approx: num(x[1]) % +x[2] !== 0 });
  return v.length ? v.sort((a, b) => a.pm - b.pm)[0] : null;
};
const FEE_SPONTAN = /restpl|ohne (vor)?anmeldung|keine anmeldung|platzvergabe|oder vor ort|vor ort ab \d/i;
{
  const eur = v => (Math.round(v * 100) / 100).toFixed(2).replace(/[.,]00$/, "").replace(".", ",");
  const eurT = x => x.approx ? `rund ${Math.round(x.pm)} €` : `${eur(x.pm)} €`;
  const rows = MARKETS.filter(m => m.fee || m.signup || m.signupHint || m.sellers).map(m => {
    const pm = feePerMeter(m.fee), free = /^(kostenlos|gratis)\b/i.test(m.fee);
    const sp = FEE_SPONTAN.test(m.signupHint) && !/anwohner/i.test(m.signupHint), priv = /^nur privat/i.test(m.sellers);
    return { m, pm, free, sp, priv, cheap: free || (pm && pm.pm <= 10), n: nextEv(m) };
  });
  const withPm = rows.filter(r => r.pm).map(r => r.pm.pm).sort((a, b) => a - b);
  const q = f => withPm.length ? withPm[Math.min(withPm.length - 1, Math.max(0, Math.round((withPm.length - 1) * f)))] : 0;
  const q1 = Math.round(q(.25)), q3 = Math.round(q(.75)), med = q(.5);
  const sp = rows.filter(r => r.sp), priv = rows.filter(r => r.priv), free = rows.filter(r => r.free), cheap = rows.filter(r => r.cheap);
  const car = rows.filter(r => /(?:mit\s+(?:pkw|auto|kfz|fahrzeug)|autostand|fahrzeug)\s*(?:\+|zzgl\.)?\s*\d/i.test(r.m.fee));
  const cheapest = rows.filter(r => r.pm).sort((a, b) => a.pm.pm - b.pm.pm || ((a.n || {}).k || "9").localeCompare((b.n || {}).k || "9")).slice(0, 3);
  const mLink = m => `[${m.name}](/flohmarkt/${m.slug}/)`;
  const stats = withPm.length >= 5, nFee = rows.filter(r => r.m.fee).length;
  const ans = `${stats ? `Ein Meter Standfläche kostet auf den meisten Flohmärkten in Hamburg und im Umland ${q1} bis ${q3} €, typisch sind ${eur(med)} €. ` : ""}Hier stehen die Angaben von ${rows.length} Märkten im Vergleich, mit Standgebühr, Verkäufern und Anmeldung.${sp.length ? ` Bei ${sp.length} Märkten gibt es laut Veranstalter auch Restplätze am Markttag oder keine Voranmeldung.` : ""} Alle Angaben stammen von den Veranstaltern, ohne Gewähr.`;
  const faq = [
    ...(stats ? [["Was kostet ein Stand auf dem Flohmarkt in Hamburg?", `Laut Veranstaltern meist ${q1} bis ${q3} € pro Meter, typisch sind ${eur(med)} €. Grundlage sind ${withPm.length} Märkte mit Meterpreis im ${NAME}-Kalender.${car.length ? ` Bei ${car.length} Märkten kostet ein Stand mit Auto mehr.` : ""} Wie du die Kosten wieder reinholst, steht im Ratgeber ${kbL("standgebuehr-flohmarkt", "Was kostet ein Flohmarktstand?")}.`]] : []),
    ...(cheapest.length ? [["Wo ist ein Flohmarktstand am günstigsten?", `Laut den Angaben im Kalender: ${listNames(cheapest.map(r => `${mLink(r.m)} (ab ${eurT(r.pm)} pro Meter)`), 3)}.${free.length ? ` Ohne Standgebühr: ${listNames(free.map(r => mLink(r.m)), 3)}.` : ""} Oft kommen Müllpfand oder eine Grundgebühr dazu, die Details stehen in der Liste.`]] : []),
    ...(sp.length ? [["Wo kann ich ohne Voranmeldung verkaufen?", `Bei ${sp.length} Märkten gibt es laut Veranstalter Restplätze am Markttag oder keine Voranmeldung, zum Beispiel ${listNames(sp.slice().sort((a, b) => ((a.n || {}).k || "9").localeCompare((b.n || {}).k || "9")).map(r => mLink(r.m)), 3)}. Sicher ist ein Platz nur mit Anmeldung. Der Filter „Spontan möglich“ oben zeigt alle diese Märkte.`]] : []),
    ...(priv.length ? [["Welche Flohmärkte sind nur für Privatverkäufer?", `${priv.length} Märkte nehmen laut Veranstalter nur Privatverkäufer, darunter ${listNames(priv.map(r => mLink(r.m)), 3)}. Mehr dazu im Ratgeber ${kbL("gewerblich-oder-privat-flohmarkt", "Privat oder Händler")}.`]] : []),
    ["Woher stammen die Preise?", `Von den Veranstaltern, etwa von ihrer Website oder aus dem Anmeldeformular. Preise und Regeln können sich ändern. Verbindlich ist, was der Veranstalter bei der Anmeldung nennt.`]];
  const row = r => { const m = r.m; return `<article class="fee" data-f="${[r.sp && "spontan", r.priv && "privat", r.cheap && "guenstig"].filter(Boolean).join(" ")}">
<h3><a href="/flohmarkt/${m.slug}/">${esc(m.name)}</a></h3><p class="meta">${esc(m.area)} · ${r.n ? `Nächster Termin ${fmtShortY(r.n)}` : esc(m.rhythm)}</p>
<p class="fee-v${m.fee ? "" : " none"}">${ic("tag")}<span>${m.fee ? nbU(m.fee) : "Standgebühr beim Veranstalter erfragen"}</span></p>${m.signupHint ? `<p class="fee-h">${nbU(m.signupHint)}</p>` : ""}
<div class="row">${r.sp ? `<span class="tag">${ic("sunrise")}Spontan möglich</span>` : ""}${m.sellers ? `<span class="tag">${ic("user")}${esc(/^nur privat/i.test(m.sellers) ? "Nur privat" : m.sellers.replace(/ und /, " & "))}</span>` : ""}${m.signup ? `<a class="route" href="${esc(m.signup)}" rel="noopener">Zur Anmeldung${ic("chev")}</a>` : ""}</div></article>`; };
  const byReg = REGIONS.map(rg => ({ rg, list: rows.filter(r => r.m.bez === rg.k).sort((a, b) => ((a.n || {}).k || "9").localeCompare((b.n || {}).k || "9") || a.m.name.localeCompare(b.m.name, "de")) })).filter(x => x.list.length);
  const chip = (f, l, n) => `<button class="chip" type="button" data-f="${f}" aria-pressed="${!f}">${l}${n !== undefined ? ` <small>${n}</small>` : ""}</button>`;
  const cr = [[NAME, "/"], ["Ratgeber", "/ratgeber/"], ["Standgebühren"]];
  const body = crumbs(cr) + `<article class="kb fee-page"><h1>Standgebühren auf Flohmärkten in Hamburg im Vergleich</h1>
<div class="byline"><span>${ic("tag")}${rows.length} Märkte</span><span>${ic("update")}Stand: ${STAND}</span></div>
<div class="answer"><span class="kicker">Kurz gesagt</span><p>${nbU(ans)}</p></div>
<div class="chips js-only" id="feeF" role="group" aria-label="Märkte filtern">${chip("", "Alle", rows.length)}${sp.length ? chip("spontan", "Spontan möglich", sp.length) : ""}${priv.length ? chip("privat", "Nur Privatverkäufer", priv.length) : ""}${cheap.length ? chip("guenstig", "Bis 10 € pro Meter", cheap.length) : ""}</div>
${byReg.map(x => `<section class="cluster fee-reg"><div class="sec-head"><h2>${esc(x.rg.name)}</h2>${more(`/flohmarkt-hamburg/${x.rg.k}/`, x.rg.umland ? "Zur Region" : "Zum Bezirk", "Seite " + x.rg.name)}</div><div class="fee-list">${x.list.map(row).join("")}</div></section>`).join("")}
<div class="empty" id="feeLeer" hidden>Mit diesem Filter ist gerade kein Markt dabei.</div>
<p class="hint">Die Angaben stammen von den Veranstaltern (Website, Aushang oder Anmeldeformular) und können sich ändern. Verbindlich ist, was der Veranstalter bei der Anmeldung nennt. „Spontan möglich“ heißt: Laut Veranstalter gibt es Restplätze am Markttag oder keine Voranmeldung, ein Platz ist dann aber nicht garantiert.</p>
${signCta(null)}
${faqBlock(faq)}
<section class="related"><div class="sec-head"><h2>Mehr zum Verkaufen</h2></div>${grid(["standgebuehr-flohmarkt", "flohmarktstand-anmelden", "preise-festlegen-flohmarkt"].filter(s => KBY[s]).map(kbCard))}</section></article>`;
  layout({ p: FEE_P, title: `Flohmarkt Standgebühr Hamburg: alle Preise im Vergleich | ${NAME}`,
    desc: pickDesc(stats ? `Was kostet ein Flohmarktstand in Hamburg? Standgebühren von ${nFee} Märkten im Vergleich, meist ${q1} bis ${q3} € pro Meter. Mit Anmeldung und Restplätzen.` : "",
      `Was kostet ein Flohmarktstand in Hamburg? Standgebühren von ${nFee} Märkten im Vergleich, mit Link zur Anmeldung und Märkten mit Restplätzen vor Ort.`),
    body, nav: "maerkte", noindex: rows.length < 5, ld: G([crumbLD(cr), faqLD(faq)]) });
}

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
<h2>Termine nach Wochentag</h2><p>${sa + so} von ${nf(live.length)} Terminen liegen am Wochenende.${topDayEv ? ` Der Tag mit den meisten Flohmärkten im Zeitraum ist ${fmtDateY(topDayEv.date)} mit ${topDay[1]} Märkten.` : ""} Die Termine von Montag bis Freitag stehen unter <a href="${WEEK_P}">Flohmarkt unter der Woche</a>.</p>
<div class="tbl"><table><thead><tr><th>Wochentag</th><th class="num">Termine</th><th class="num">Anteil</th></tr></thead><tbody>${byDay.map(x => row(WDL[x.d], x.c, pct(x.c, live.length) + " %")).join("")}</tbody></table></div>
${topStart ? `<h2>Uhrzeiten</h2><p>Die häufigste Anfangszeit ist ${hmText(topStart[0])} Uhr (${topStart[1]} Termine). ${early} Termine beginnen bis 7 Uhr und sind etwas für <a href="/termine/">Frühaufsteher</a>, ${late} beginnen erst ab 10 Uhr. Wann sich welche Uhrzeit lohnt, steht im Ratgeber ${KBY["beste-uhrzeit-flohmarkt"] ? `<a href="/ratgeber/beste-uhrzeit-flohmarkt/">Wann ist die beste Uhrzeit für den Flohmarkt?</a>` : "zur besten Uhrzeit"}.</p>` : ""}
<h2>So entstehen die Zahlen</h2><p>Alle Angaben werden jede Nacht aus dem ${esc(NAME)}-Kalender berechnet. Gezählt werden Flohmärkte in Hamburg und im Umkreis von rund 30 km, die im Kalender stehen. Die Termine stammen von den Veranstaltern. Es ist keine amtliche Statistik: Märkte, die wir noch nicht kennen, fehlen. Wer die Zahlen zitiert, nennt bitte ${esc(NAME)} (${esc(SITE.replace(/^https?:\/\//, ""))}) und das Datum als Quelle.</p></div>
${faqHTML(faq)}</article>`;
  layout({ p: STATS_P, title: `Flohmärkte in Hamburg in Zahlen: Statistik ${YEAR} | ${NAME}`, desc: `Wie viele Flohmärkte gibt es in Hamburg? ${n} Märkte, ${nf(live.length)} Termine, Verteilung nach Bezirk, Art, Wochentag und Uhrzeit. Täglich neu berechnet.`, body,
    ld: G([crumbLD(cr), faqLD(faq)]) });
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
    if (target.startsWith("/assets/") || target.startsWith("/fonts/") || target.startsWith("/kalender/") || /^\/(favicon\.ico|apple-touch-icon\.png|manifest\.webmanifest)$/.test(target)) continue;
    if (!existing.has(target)) warn("Links", `${p} verlinkt auf ${target}, diese Seite gibt es nicht.`);
  }
}

/* ---------------------------------------------------------------- Merkzettel der letzten Nacht und Notbremse
   Der Merkzettel liegt unter /assets/seiten-stand.json auf der Website und wird beim nächsten Bau von dort gelesen.
   Er merkt sich je Seite, wann sich ihr Inhalt zuletzt geändert hat (für Google), und wie viele Märkte und Termine es gab. */
{
  // Notbremse: Fehlt plötzlich mehr als die Hälfte der Märkte oder Termine, ist fast immer in der Tabelle etwas verrutscht
  // (Zeilen gelöscht, Spalte überschrieben, falsch sortiert). Dann lieber nichts veröffentlichen: Die bisherige Website bleibt online.
  const z = Array.isArray(OLD_STATE._zahlen) ? OLD_STATE._zahlen : null, vorM = z ? +z[0] || 0 : Object.keys(OLD_STATE).filter(p => /^\/flohmarkt\/[^/]+\/$/.test(p)).length;
  // Termine lassen sich nur vergleichen, wenn der Vergleichsstand frisch ist (höchstens eine Woche alt) und „Tage im Voraus“ gleich geblieben ist
  const frisch = z && +z[3] === HORIZON && /^\d{4}-\d{2}-\d{2}$/.test(String(z[4])) && (TODAY - new Date(z[4] + "T00:00:00Z")) / 864e5 <= 7;
  const vorT = frisch ? +z[1] || 0 : 0, vorD = frisch ? +z[2] || 0 : 0, mitTermin = MARKETS.length - NO_DATES.length;
  const aus = /^(aus|nein|no|0|off)$/i.test(String(S["Notbremse"] || "").trim());
  const weg = vorM >= 20 && MARKETS.length < vorM / 2 ? `nur noch ${MARKETS.length} statt ${vorM} Märkte` : vorD >= 20 && mitTermin < vorD / 2 ? `nur noch ${mitTermin} statt ${vorD} Märkte mit Termin` : vorT >= 40 && EVENTS.length < vorT * 0.4 ? `nur noch ${EVENTS.length} statt ${vorT} Termine` : "";
  if (weg && !aus) throw new Error(`Notbremse: Die Tabelle ergibt ${weg}. Das sieht nach einem Versehen aus (Zeilen gelöscht, Spalte überschrieben oder falsch sortiert), deshalb wurde nichts veröffentlicht. Bitte die Blätter „Märkte“ und „Termine“ prüfen; in Google Sheets hilft Datei > Versionsverlauf. Ist der Rückgang gewollt: im Blatt Einstellungen eine Zeile „Notbremse“ mit dem Wert „aus“ eintragen, neu bauen und die Zeile danach wieder löschen.`);
  if (weg) warn("Einstellungen", `Die Notbremse ist ausgeschaltet (Einstellung „Notbremse“ = aus) und die Tabelle ergibt ${weg}. Wenn das so gewollt war: die Zeile „Notbremse“ jetzt wieder löschen.`);
  else if (aus) warn("Einstellungen", "Die Notbremse ist ausgeschaltet (Einstellung „Notbremse“ = aus). Sie schützt davor, dass eine versehentlich geleerte Tabelle veröffentlicht wird. Bitte die Zeile wieder löschen.");
}

/* ---------------------------------------------------------------- Änderungsdatum je Seite
   Das Datum bleibt stehen, solange sich der Inhalt nicht ändert. Google nutzt lastmod (Sitemap) und dateModified (Artikel) nur,
   wenn die Angaben verlässlich sind, und ein Datum, das jede Nacht neu ist, ohne dass sich etwas geändert hat, gilt als geschönt.
   Als Inhalt einer Seite zählen Titel, Beschreibung, strukturierte Daten und der Hauptteil. Nicht mit zählen: Kopf, Menü, Fuß,
   Versionskürzel von Stil, Skript und Icons, die Werkzeug- und Hamburg-Hinweise am Seitenende und der Text in Hinweiskästen
   (cta-box, etwa „der nächste am …“), von denen nur zählt, wohin sie verlinken, und die wechselnden Beispiele bei den
   Werkzeugen (Kauf-Check-Beispiel, Ratgeber-Fragen, Fragenliste auf /flohmarkt-tipps/). Ein neuer Menüpunkt, ein neuer Anstrich, ein weitergerücktes Datum in einem
   Kasten oder ein anderes Tagesbeispiel ist kein neuer Inhalt.
   Artikel (Ratgeber, Kauf-Check) haben zusätzlich ein Datum für ihren Wortlaut. Es ändert sich nur, wenn sich Überschrift, Text oder
   Fragen ändern, nicht wenn sich ein Kasten daneben ändert (etwa der nächste Termin einer Marktart). Dieses Datum steht im Artikel
   als „Stand“ und in den Angaben für Google als dateModified. */
const indexable = [...pages].filter(([p, pg]) => !pg.noindex && p !== "/404.html").map(([p]) => p);
// Version der Berechnung. Beim ersten Bau mit einer neuen Version lassen sich die alten Fingerabdrücke nicht vergleichen:
// Dann bleiben die bisherigen Daten stehen, statt dass alle Seiten auf einmal das heutige Datum bekommen.
const SIG_V = 2;
const LASTMOD = {}, PAGE_STATE = {}, ART_STATE = {};
{
  const old = OLD_STATE, today = key(TODAY), same = old._v === SIG_V, oldArt = same && old._art && typeof old._art === "object" ? old._art : {};
  const okDay = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today;
  const fp = t => hashOf("sha1").update(t).digest("hex").slice(0, 12);
  const one = (html, re) => (html.match(re) || [""])[0];
  const sigOf = html => fp([one(html, /<title>[\s\S]*?<\/title>/), one(html, /<meta name="description"[^>]*>/), ...(html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []), one(html, /<main[\s\S]*?<\/main>/)].join("\n")
    .replace(/<section class="sec (?:more-tools|lp-hh|lp-qs)">[\s\S]*?<\/section>/g, "").replace(/<a class="cta-box" href="([^"]*)">[\s\S]*?<\/a>/g, "[$1]")
    .replace(/<fieldset class="st-check"[\s\S]*?<\/fieldset>/g, "").replace(/<div class="st-vis st-qs">[\s\S]*?<\/div>/g, "")
    .split(STAND).join("").split(today).join("").replace(/\?v=[0-9a-f]{8}/g, ""));
  for (const p of indexable) {
    const sig = sigOf(pages.get(p).html), o = old[p], had = Array.isArray(o) && okDay(o[1]);
    const d = had && (o[0] === sig || !same) ? o[1] : today;
    LASTMOD[p] = d; PAGE_STATE[p] = [sig, d];
  }
  for (const [p, pg] of pages) {
    if (!pg.art) continue;
    const sig = fp(pg.art), o = oldArt[p], op = old[p];
    // Bei der Umstellung bekommt ein Artikel das bisherige Änderungsdatum seiner Seite: Der Text kann älter sein, aber nicht jünger.
    const d = Array.isArray(o) && o[0] === sig && okDay(o[1]) ? o[1] : !same && Array.isArray(op) && okDay(op[1]) ? op[1] : today;
    ART_STATE[p] = [sig, d];
    if (LASTMOD[p] && d > LASTMOD[p]) LASTMOD[p] = PAGE_STATE[p][1] = d; // Eine Seite ist nie älter als ihr Artikel
  }
}
PAGE_STATE._v = SIG_V; PAGE_STATE._art = ART_STATE;
// Platzhalter für die Daten einsetzen (siehe AKT_ISO weiter oben)
{
  const today = key(TODAY), de = k => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
  for (const [p, pg] of pages) {
    if (!pg.html.includes("%%")) continue;
    const a = ART_STATE[p] ? ART_STATE[p][1] : today, sd = LASTMOD[p] || today;
    pg.html = pg.html.split("%%AKT_ISO%%").join(a).split("%%AKT_DE%%").join(de(a)).split("%%SEITE_ISO%%").join(sd).split("%%SEITE_DE%%").join(de(sd));
    const rest = pg.html.match(/%%[A-Z][A-Za-z0-9_:-]*%%/); if (rest) warn("Datum", `${p}: Platzhalter ${rest[0]} wurde nicht ersetzt.`);
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
fs.writeFileSync(path.join(OUT, "assets/style.css"), withBase(fontCSS) + CSS_SRC.slice(fontCSS.length));
// Skript schlanker ausliefern: Kommentare und Einrückung raus (der Code selbst bleibt unverändert, Zeilenumbrüche bleiben).
const JS_OUT = fs.readFileSync(path.join(ROOT, "src/site.js"), "utf8").replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//")).join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "assets/site.js"), JS_OUT);
fs.writeFileSync(path.join(OUT, "assets/maerkte.json"), MERK_JSON);
// Werkzeuge für die Suche: [Art, Titel, Adresse, Suchwörter]. Apostrophe zusätzlich ohne Lücke („Levi's“ findet auch „levis“).
{ const kw = (...x) => { const t = x.filter(Boolean).join(" "); return t + " " + t.replace(/['’`]/g, ""); };
  const W = [["sign", "Schilder-Designer", SIGN_BASE, kw("Schilder-Designer schild schilder preisschild preisschilder etikett etiketten vorlage vorlagen drucken ausdrucken pdf gestalten")],
    ...SIGNS.map(t => ["sign", `Schild: ${t.chip}`, signUrl(t), kw(t.chip, t.h1, t.title, t.s.replace(/-/g, " "), t.s === "bar-und-paypal" ? "paypal qr code bezahlen zahlung" : "")]),
    ...(KC_ON ? [["kc", "Kauf-Check: Echt oder Fälschung?", KC_P, kw("Kauf-Check kaufcheck echt fake fälschung fälschungen original prüfen gesperrt gestohlen")],
      ...Object.keys(KC_AREAS).filter(a => KC.some(i => i.a === a)).map(a => ["kc", `Kauf-Check: ${KC_AREAS[a].t}`, `${KC_P}${a}/`, kw(KC_AREAS[a].t)]),
      ...KC.map(i => ["kc", `Kauf-Check: ${i.n}`, kcUrl(i), kw(i.n, i.kw, i.s.replace(/-/g, " "))])] : []),
    ...KB.map(a => ["kb", a.h, `/ratgeber/${a.s}/`, kw(a.h, a.kw, a.s.replace(/-/g, " "))])];
  fs.writeFileSync(path.join(OUT, "assets/werkzeuge.json"), JSON.stringify(W)); }
// Kalenderdateien je Markt: alle bekannten Termine (Abo) und nur der nächste Termin
{ fs.mkdirSync(path.join(OUT, "kalender"), { recursive: true });
  for (const m of MARKETS) { if (!calOk(m)) continue; const seen = new Set(), evs = [...m.events, ...(m.later || [])].filter(e => e.k >= key(TODAY) && !seen.has(e.k) && seen.add(e.k)).sort((a, b) => a.k.localeCompare(b.k));
    fs.writeFileSync(path.join(OUT, `kalender/${m.slug}.ics`), icsOf(m, evs, `${m.short || m.name} (${NAME})`));
    fs.writeFileSync(path.join(OUT, `kalender/${m.slug}-naechster.ics`), icsOf(m, evs.filter(e => !e.cancelled).slice(0, 1), `${m.short || m.name} (${NAME})`)); } }
// Das Skript liegt zusätzlich unter einem Namen mit Versionskürzel: Diese Datei ändert sich nie und darf ein Jahr gespeichert werden.
if (JS_V) fs.writeFileSync(path.join(OUT, `assets/site.${JS_V.slice(3)}.js`), JS_OUT);
fs.copyFileSync(path.join(ROOT, "src/icon.svg"), path.join(OUT, "assets/icon.svg"));
if (HAS_ICONS) {
  // favicon.ico und apple-touch-icon.png suchen Browser von sich aus ganz oben, die übrigen liegen bei den anderen Dateien
  for (const f of APP_ICONS) fs.copyFileSync(path.join(ROOT, "src", f), path.join(OUT, /^(favicon|apple)/.test(f) ? f : "assets/" + f));
  // Web-Manifest: Name, Farben und Symbole, wenn jemand die Seite auf den Startbildschirm legt. Pfade ohne Schrägstrich vorn, damit es auch in einem Unterordner stimmt.
  fs.writeFileSync(path.join(OUT, "manifest.webmanifest"), JSON.stringify({ name: `${NAME} – Flohmärkte in Hamburg`, short_name: NAME, description: "Flohmarkt-Kalender für Hamburg und das Umland: Termine, Uhrzeiten, Anfahrt.", lang: "de", start_url: "./", scope: "./", display: "minimal-ui", background_color: "#F2F4F0", theme_color: "#F2F4F0",
    icons: [{ src: "assets/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "assets/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "assets/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] }, null, 1) + "\n");
}
if (PLZ_ROWS.length) fs.writeFileSync(path.join(OUT, "assets/plz.json"), JSON.stringify(PLZ_C));
if (HAS_MAP) for (const f of ["leaflet.js", "leaflet.css"]) fs.copyFileSync(path.join(ROOT, "src", f), path.join(OUT, "assets", f));
fs.writeFileSync(path.join(OUT, "assets/icons-lizenz.txt"), ICON_LICENSE);
fs.writeFileSync(path.join(OUT, "assets/icons.svg"), SPRITE_FILE);
if (WATCH_ON) fs.writeFileSync(path.join(OUT, "assets/waechter.json"), JSON.stringify(WATCH));
fs.mkdirSync(path.join(OUT, "assets/schilder"), { recursive: true });
if (IDEAS.some(([k]) => ideaImg(k))) { fs.mkdirSync(path.join(OUT, "assets/schilder/ideen"), { recursive: true }); for (const [k] of IDEAS) if (ideaImg(k)) fs.copyFileSync(path.join(IDEA_DIR, `${k}.webp`), path.join(OUT, `assets/schilder/ideen/${k}.webp`)); }
for (const t of SIGNS) { fs.writeFileSync(path.join(OUT, `assets/schilder/flohmarkt-${t.s}-vorlage.svg`), signPreviewSVG(t)); if (signWebp(t)) fs.copyFileSync(path.join(SIGN_PREV_DIR, `flohmarkt-${t.s}-vorlage.webp`), path.join(OUT, `assets/schilder/flohmarkt-${t.s}-vorlage.webp`)); }
// Bilder: Hochgeladen wird nur, was auf mindestens einer Seite vorkommt. Der Rest bleibt im Ordner bilder liegen und steht im Bericht.
const IMG_UNUSED = [];
if (IMGS.size) {
  const used = new Set(); for (const pg of pages.values()) for (const m of pg.html.matchAll(/\/assets\/img\/([a-z0-9-]+\.(?:webp|jpg))/g)) used.add(m[1]);
  fs.mkdirSync(path.join(OUT, "assets/img"), { recursive: true });
  // Im Bericht steht eine Datei nur, wenn auch ihre zweite Größe (…-klein) nirgends vorkommt: Dann ist sie wirklich übrig.
  const twin = x => /-(klein|mini)\.(webp|jpg)$/.test(x) ? x.replace(/-(klein|mini)\./, ".") : x.replace(/\.(webp|jpg)$/, "-klein.$1");
  for (const x of IMGS) { if (used.has(imgOut(x))) fs.copyFileSync(path.join(imgDir, x), path.join(OUT, "assets/img", imgOut(x))); else if (!(IMGS.has(twin(x)) && used.has(imgOut(twin(x))))) IMG_UNUSED.push(x); }
}
if (fontsFound.length) {
  fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true }); for (const x of fontsFound) fs.copyFileSync(path.join(fontDir, x.f), path.join(OUT, "fonts", x.f));
  // Die Open Font License verlangt, dass Urhebervermerk und Lizenztext mit den Schriften ausgeliefert werden
  const FONT_C = { "Bricolage Grotesque": "Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)", "Figtree": "Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree)", "Fraunces": "Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces)", "Pacifico": "Copyright 2018 The Pacifico Project Authors (https://github.com/googlefonts/Pacifico)", "DM Mono": "Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono)" };
  fs.writeFileSync(path.join(OUT, "fonts/OFL.txt"), [...new Set(fontsFound.map(x => FONT_C[x.fam]).filter(Boolean))].join("\n") + "\n\n" + OFL_TEXT + "\n");
}
// Sitemap, bei den Schilder-Seiten mit Vorschaubildern für die Google-Bildersuche. Änderungsdaten: siehe „Änderungsdatum je Seite“ weiter oben.
PAGE_STATE._neu = NEU;
PAGE_STATE._zahlen = [MARKETS.length, EVENTS.length, MARKETS.length - NO_DATES.length, HORIZON, key(TODAY)]; // Märkte, Termine, Märkte mit Termin, Tage im Voraus, Datum: für die Notbremse im nächsten Bau
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

Die Termine stammen von den Veranstaltern. Märkte können kurzfristig ausfallen: Vor dem Besuch lohnt ein Blick auf die Website des Veranstalters, sie ist auf jeder Marktseite verlinkt. Bitte ${NAME} (${SITE.replace(/^https?:\/\//, "")}) als Quelle nennen und auf die jeweilige Seite verlinken. Stand dieser Datei: ${STAND}.

## Termine
- [Flohmärkte heute](${SITE}/heute/): alle Märkte von heute mit Uhrzeit
- [Flohmärkte am Wochenende](${SITE}/wochenende/): Samstag und Sonntag
${pages.has(WEEK_P) && !pages.get(WEEK_P).noindex ? `- [Flohmärkte unter der Woche](${SITE}${WEEK_P}): alle Termine von Montag bis Freitag\n` : ""}- [Alle Termine](${SITE}/termine/): die nächsten 60 Tage, filterbar nach Art und Umkreis

## Märkte
- [Alle Märkte nach Bezirk](${SITE}/flohmaerkte/): Übersicht aller ${MARKETS.length} Märkte
${REGIONS.filter(r => MARKETS.some(m => m.bez === r.k)).map(r => `- [Flohmärkte ${r.name}](${SITE}/flohmarkt-hamburg/${r.k}/)`).join("\n")}
${CATS_ON.map(c => `- [${c.chip}](${SITE}/${c.s}/): ${c.ms.length} Märkte`).join("\n")}

## Zahlen und Wissen
- [Flohmärkte in Hamburg in Zahlen](${SITE}${STATS_P}): Anzahl der Märkte und Termine nach Bezirk, Art, Wochentag und Uhrzeit
- [Ratgeber](${SITE}/ratgeber/): ${KB.length} Artikel zu Kaufen, Verkaufen, Handeln und Organisieren

## Praktisches
- [Schilder-Designer](${SITE}/flohmarkt-schilder/): Preisschilder und Standschilder kostenlos gestalten und drucken
${pages.has(FEE_P) && !pages.get(FEE_P).noindex ? `- [Standgebühren im Vergleich](${SITE}${FEE_P}): was ein Stand auf den Flohmärkten kostet, mit Anmeldung und Restplätzen\n` : ""}- [Für Veranstalter](${SITE}/veranstalter/): Markt kostenlos eintragen

## Rechtliches
${INSTA ? `- [Instagram](${INSTA}): jede Woche die Flohmärkte am Wochenende\n` : ""}- [Impressum](${SITE}/impressum/)
- [Datenschutz](${SITE}/datenschutz/)
`);
if (!PUBLIC) warn("Google", "Die Website ist noch nicht für Google freigegeben (Einstellung „Für Google freigeben“ = Nein). Das ist richtig, solange ihr testet.", true);
if (process.env.CNAME) fs.writeFileSync(path.join(OUT, "CNAME"), process.env.CNAME + "\n");
// Kurzadresse /schilder: Auf Apache leitet die .htaccess weiter, sonst diese kleine Seite (nicht in der Sitemap)
fs.mkdirSync(path.join(OUT, "schilder"), { recursive: true });
fs.writeFileSync(path.join(OUT, "schilder/index.html"), `<!doctype html><html lang="de"><meta charset="utf-8"><title>Schilder-Designer | ${esc(NAME)}</title><meta name="robots" content="noindex"><link rel="canonical" href="${SITE}/flohmarkt-schilder/"><meta http-equiv="refresh" content="0; url=/flohmarkt-schilder/"><p><a href="/flohmarkt-schilder/">Weiter zum Schilder-Designer</a></p></html>\n`);
// Kurzadresse /start für die Instagram-Bio: leitet auf die Seite für jeden Flohmarkt (nicht in der Sitemap)
fs.mkdirSync(path.join(OUT, "start"), { recursive: true });
fs.writeFileSync(path.join(OUT, "start/index.html"), `<!doctype html><html lang="de"><meta charset="utf-8"><title>Flohmarkt-Tipps | ${esc(NAME)}</title><meta name="robots" content="noindex"><link rel="canonical" href="${SITE}${TIPS_P}"><meta name="description" content="Kostenlose Flohmarkt-Tipps für überall: Schilder zum Ausdrucken, Kauf-Check gegen Fälschungen und Checklisten."><meta property="og:type" content="website"><meta property="og:title" content="Flohmarkt-Tipps für jeden Flohmarkt | ${esc(NAME)}"><meta property="og:description" content="Schilder drucken, Fälschungen erkennen, besser handeln. Kostenlos, ohne Anmeldung."><meta property="og:url" content="${SITE}${TIPS_P}">${OG_IMG ? `<meta property="og:image" content="${SITE}${OG_IMG}"><meta name="twitter:card" content="summary_large_image">` : ""}<meta http-equiv="refresh" content="0; url=${TIPS_P}"><p><a href="${TIPS_P}">Weiter zu den Flohmarkt-Tipps</a></p></html>\n`);
// Einstellungen für Webspace mit Apache (z. B. Hetzner). GitHub Pages beachtet die Datei nicht.
{
  const host = new URL(SITE).hostname, bare = host.replace(/^www\./, ""), rx = bare.replace(/\./g, "\\.");
  // Was die Seite laden darf. Wer später etwas von außen einbindet (z. B. ein Video), muss die Quelle hier ergänzen.
  const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://tile.openstreetmap.org", "font-src 'self'", "connect-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join("; ");
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
# Kurzadresse auf den gedruckten Schildern
RewriteRule ^schilder/?$ https://${host}/flohmarkt-schilder/ [R=301,L]
RewriteRule ^start/?$ https://${host}${TIPS_P} [R=301,L]
</IfModule>

<IfModule mod_mime.c>
AddType font/woff2 .woff2
AddType image/webp .webp
AddType image/svg+xml .svg
AddType application/manifest+json .webmanifest
AddType "text/calendar; charset=utf-8" .ics
</IfModule>

<IfModule mod_deflate.c>
<IfModule mod_filter.c>
AddOutputFilterByType DEFLATE text/html text/css text/plain application/javascript text/javascript image/svg+xml application/json application/xml text/xml application/manifest+json
</IfModule>
</IfModule>

<IfModule mod_expires.c>
ExpiresActive On
ExpiresDefault "access plus 1 hour"
ExpiresByType text/html "access plus 10 minutes"
ExpiresByType application/json "access plus 10 minutes"
ExpiresByType application/xml "access plus 1 hour"
ExpiresByType application/manifest+json "access plus 1 day"
ExpiresByType text/calendar "access plus 6 hours"
# Stil, Skript und Icons tragen ein Versionskürzel in der Adresse (?v=…): Änderungen kommen sofort an.
# Die Speicherdauer bleibt trotzdem kurz. Beim Hochladen kommen Seiten und Dateien nicht im selben Augenblick an;
# wer genau dann eine Seite öffnet, hätte sonst die alte Datei lange unter der neuen Adresse gespeichert.
ExpiresByType text/css "access plus 1 day"
ExpiresByType application/javascript "access plus 1 day"
ExpiresByType text/javascript "access plus 1 day"
# Ausnahme: Das Skript mit Versionskürzel im Dateinamen (site.1a2b3c4d.js) ändert sich nie und darf ein Jahr bleiben.
<FilesMatch "\\.[0-9a-f]{8}\\.js$">
ExpiresByType application/javascript "access plus 1 year"
ExpiresByType text/javascript "access plus 1 year"
</FilesMatch>
ExpiresByType image/svg+xml "access plus 1 week"
ExpiresByType image/webp "access plus 1 month"
ExpiresByType image/jpeg "access plus 1 month"
ExpiresByType image/png "access plus 1 week"
ExpiresByType image/x-icon "access plus 1 week"
ExpiresByType image/vnd.microsoft.icon "access plus 1 week"
ExpiresByType font/woff2 "access plus 1 year"
</IfModule>

# Sicherheit: Die Seite lädt Skripte, Schriften und Stile nur von sich selbst, Kartenbilder nur von OpenStreetMap.
# Sie lässt sich nicht in fremde Seiten einbetten und ist für Browser ein halbes Jahr lang nur verschlüsselt erreichbar.
<IfModule mod_headers.c>
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
Header always set X-Frame-Options "SAMEORIGIN"
Header always set Permissions-Policy "geolocation=(self), camera=(), microphone=(), payment=(), usb=()"
Header always set Strict-Transport-Security "max-age=15552000"
Header always set Content-Security-Policy "${CSP}"
</IfModule>
`);
}

/* ---------------------------------------------------------------- Bericht */
const evCount = [...pages.values()].reduce((n, pg) => n + (pg.html.match(/"@type":"Event"/g) || []).length, 0);
const summary = [`# ${NAME}: Website gebaut`, "", `Stand ${STAND} · ${pages.size} Seiten (${PUBLIC ? indexable.length + " für Google" : "noch nicht für Google freigegeben"}) · ${MARKETS.length} Märkte · ${EVENTS.length} Termine in den nächsten ${HORIZON} Tagen · ${KB.length} Ratgeber-Artikel · ${evCount} Event-Auszeichnungen`, ""];
// Erst, was zu tun ist (Fehler in der Tabelle zuerst), dann die fertigen Zeilen des Termin-Wächters, am Ende, was nur zur Kenntnis ist.
if (NO_TIME.length) warn("Uhrzeit fehlt", `${NO_TIME.length === 1 ? "Ein Termin" : NO_TIME.length + " Termine"} in den nächsten drei Wochen ohne Uhrzeit: ${NO_TIME.map(e => `${e.m.name} am ${fmtDate(e.date)}`).join("; ")}. Uhrzeit beim Veranstalter nachsehen und im Blatt „Termine“ (oder „Serien“) eintragen.`);
const ORDER = ["Einstellungen", "Impressum", "Datenschutz", "Google", "Bezirke", "Märkte", "Serien", "Termine", "Bereiche", "Neuigkeiten", "Datum", "Uhrzeit", "Links", "Ratgeber", "Bilder", "Schriften", "Karte", "Wetter", "Uhrzeit fehlt", "Termin-Wächter", "Serie endet bald", "SEO"];
const rank = b => { const i = ORDER.indexOf(b); return i < 0 ? 10.5 : i; };
const todo = warnings.filter(w => !w[2]).map((w, i) => [w, i]).sort((x, y) => rank(x[0][0]) - rank(y[0][0]) || x[1] - y[1]).map(x => x[0]);
const info = warnings.filter(w => w[2]).map(w => w[1]);
if (NO_DATES.length) info.push(`${NO_DATES.length === 1 ? "Ein Markt hat" : NO_DATES.length + " Märkte haben"} in den nächsten ${HORIZON} Tagen keinen Termin (Saisonpause oder noch nicht angekündigt): ${NO_DATES.map(m => m.name).sort((a, b) => a.localeCompare(b, "de")).join(", ")}.`);
if (IMG_UNUSED.length) info.push(`${IMG_UNUSED.length === 1 ? "Eine Bilddatei" : IMG_UNUSED.length + " Bilddateien"} im Ordner bilder ${IMG_UNUSED.length === 1 ? "wird" : "werden"} auf keiner Seite verwendet und deshalb nicht hochgeladen: ${IMG_UNUSED.join(", ")}.`);
if (todo.length) {
  summary.push(`## Zu erledigen: ${todo.length} ${todo.length === 1 ? "Hinweis" : "Hinweise"}`, "", "| Bereich | Hinweis |", "|---|---|");
  for (const [b, t] of todo) summary.push(`| ${b} | ${t.replace(/\|/g, "/").replace(/\s*[\r\n]+\s*/g, " ")} |`);
} else summary.push("Nichts zu erledigen. Alles in Ordnung.");
if (WATCH_ROWS.length) {
  const rows = WATCH_ROWS.sort((a, b) => a.row[0].localeCompare(b.row[0]) || a.k.localeCompare(b.k));
  summary.push("", `## Termin-Wächter: ${rows.length} ${rows.length === 1 ? "Vorschlag" : "Vorschläge"} zum Einfügen`, "",
    "Diese Tage stehen neu auf Veranstalterseiten und fehlen in der Tabelle. **Erst auf der Seite des Veranstalters prüfen**, ob es wirklich ein Markttermin ist und ob die Uhrzeit stimmt (eingesetzt ist die übliche Uhrzeit des Markts; ist sie leer, kennt die Tabelle noch keine). Dann die Zeilen markieren, kopieren und im Blatt „Termine“ in die erste freie Zeile einfügen. Die Spalten sind: Markt, Datum, Beginn, Ende, Status, Hinweis. Ein Vorschlag bleibt sieben Tage stehen und verschwindet, sobald der Tag in der Tabelle steht.", "",
    "```", ...rows.map(r => r.row.join("\t")), "```", "", "Quellen:", ...[...new Set(rows.map(r => r.src))].map(u => `- ${u}`));
}
if (info.length) summary.push("", "## Zur Kenntnis", "", ...info.map(t => `- ${t.replace(/\s*[\r\n]+\s*/g, " ")}`));
const report = summary.join("\n") + "\n";
fs.writeFileSync(path.join(ROOT, "bericht.md"), report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
