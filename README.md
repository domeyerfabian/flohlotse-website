# Flohlotse Website

Die Website entsteht automatisch aus der Google-Tabelle „Flohlotse Redaktion“. Jede Nacht wird sie neu gebaut.
Ihr pflegt nur die Tabelle. Die ausführliche Einrichtungsanleitung liegt als Dokument bei.

## Was wo ist
- `build.mjs` baut die Website. Nicht ändern nötig.
- `daten/` enthält eine Kopie der Tabelle. Sie wird nur genutzt, solange noch keine Google-Tabelle verbunden ist.
- `src/` enthält Gestaltung (style.css), Menü-Skript und Symbol.
- `fonts/` für die Schriftdateien, siehe LIESMICH.txt.
- `bilder/` enthält die Symbolfotos (Startseite, Ratgeber, Vorschaubild beim Teilen). Dateinamen nicht ändern; fehlt ein Foto, wird die Stelle ohne Bild gebaut.
- Icons: Jede Marktart aus der Spalte „Kategorien“ (Blatt Märkte) hat ein eigenes Icon (Phosphor Icons, Stil Light, MIT-Lizenz; Stern, Mond, Haus …). Eine neue Kategorie im Sheet bekommt automatisch ein neutrales Etikett-Icon, es geht nichts kaputt.
- Schilder: Der Schildgenerator liegt unter /flohmarkt-schilder/. Die Texte der Vorlagen stehen in build.mjs im Abschnitt „Schilder“ (nicht im Sheet). Die Vorschaubilder entstehen beim Bau automatisch.
- `bericht.md` zeigt nach jedem Bau, was geprüft werden sollte: fehlende Uhrzeiten, kaputte Links, fehlende Angaben.

## Was die Website für Google automatisch macht
- **Titel und Beschreibungen** der Markt-, Bezirks-, Tages- und Monatsseiten entstehen aus den Terminen, mit nächstem Termin und Jahreszahl. Die Spalte „SEO-Beschreibung“ im Blatt Märkte wird nur genutzt, wenn kein Termin bekannt ist und sie kein festes Datum enthält. Der „SEO-Titel“ bleibt, die Jahreszahl wird automatisch ergänzt.
- **Seiten nach Art des Markts** (z. B. /hallenflohmarkt-hamburg/, /nachtflohmarkt-hamburg/, /kinderflohmarkt-hamburg/) entstehen aus der Spalte „Kategorien“. Eine Seite erscheint, sobald mindestens zwei Märkte die Kategorie haben.
- **Monatsseiten** (z. B. /flohmarkt-hamburg-november/) gibt es für jeden Monat mit Terminen. Feiertage in Hamburg werden an den Tagen angezeigt.
- **Tagesseiten**: /heute/, /morgen/, /wochenende/, /samstag/, /sonntag/. In allen Terminlisten zeigt ein Hinweis „Jetzt geöffnet“, „Öffnet heute um …“ oder „Heute schon vorbei“ (nach Hamburger Uhrzeit, im Browser berechnet).
- **Häufige Fragen** auf jeder Marktseite entstehen aus den Daten (nächster Termin, Uhrzeit, Adresse, Haltestelle, Stand).
- **Bezirkstexte**: Fehlt in der „Einleitung“ eines Bezirks ein Markt, wird er automatisch mit Link ergänzt.
- Spalte **„Veranstalter-Website“** (Blatt Märkte, freiwillig, ganz rechts): Link zum Veranstalter. Er erscheint auf der Marktseite und in den Event-Daten für Google.
- **Umkreis-Suche** nach Postleitzahl oder Standort auf den Termin-, Tages-, Monats- und Art-Seiten sowie auf „Alle Märkte“. Läuft nur im Browser. Daten: `src/plz-hamburg.csv` (GeoNames, CC BY 4.0), nicht ändern.
- **Karte** auf „Alle Märkte“ (lädt erst nach Klick, Kartenbilder von OpenStreetMap). Benötigt `src/leaflet.js` und `src/leaflet.css`. Die Lage eines Markts kommt aus Postleitzahl und Stadtteil der Adresse; genauer wird sie mit der freiwilligen Spalte **„Koordinaten“** im Blatt Märkte, z. B. `53.5602, 9.9667` (in Google Maps per Rechtsklick auf den Ort kopierbar).
- **Tipp des Tages** auf der Startseite wird jede Nacht aus den Terminen berechnet.
- Auf /veranstalter/ können Veranstalter einen **Link-Code** für ihre eigene Website kopieren. Jeder eingebaute Link hilft beim Ranking.

## Impressum und Datenschutz

- Beide Seiten entstehen aus dem Blatt **Einstellungen**. Pflicht sind: Name, Straße, PLZ und Ort, E-Mail, Telefon. Solange eine Angabe fehlt, ist die Seite als Vorlage markiert und die Website bleibt für Google gesperrt, auch wenn „Für Google freigeben“ auf Ja steht.
- „Verantwortlich nach § 18 MStV“ darf leer bleiben, dann steht dort dein Name mit „Anschrift wie oben“.
- Optional: Zeile „Datenschutz: E-Mail-Anbieter“ (z. B. „IONOS SE, Montabaur“), dann wird der Anbieter des Postfachs genannt.
- Im Impressum steht „keine bezahlten Einträge, keine Werbung“. Sobald sich das ändert, muss der Satz raus (in `build.mjs` nach „Kostenlos und unabhängig“ suchen).
- Die Datenschutzerklärung erklärt, warum es keinen Cookie-Banner gibt. Das stimmt nur, solange nichts eingebaut wird, das Cookies setzt, etwas auf dem Gerät speichert oder Inhalte von fremden Servern lädt.
- **Regel für die Tabelle:** Keine E-Mail-Adressen, Telefonnummern oder Notizen über Personen eintragen, nur was auch auf der Website erscheinen soll.
- **Neue Filter:** „Frühaufsteher“ (Beginn bis 7 Uhr) und „Langschläfer“ (Beginn 10 bis 15 Uhr) entstehen automatisch aus der Uhrzeit, in der Tabelle ist nichts einzutragen.
- **Bildnachweis:** Im Blatt Einstellungen bei „Bildnachweis“ steht „Fotos: Pexels (kostenlose Pexels-Lizenz).“
- **Umkreissuche:** Die Postleitzahl wird erst nach Tippen auf „Anzeigen“ angewandt und steht nur hinter dem `#` in der Adresse, sie wird also nie an den Server geschickt.

## Gestaltung: ein festes System

- **Farben:** nur Schwarz, Gelb und Weiß (plus Grau für Nebentext und Linien). Kein Blau, kein Rot, kein Grün.
- **Gelb** = Uhrzeit und die großen Markenflächen (Aufkleber, „Kurz gesagt“).
- **Schwarz** = Hinweis oder Zustand: Feiertag, Wetterfrosch, „Jetzt geöffnet“, Entfernung, aktiver Filter, Hauptknopf.
- **Weiß mit Rand** = alles zum Antippen: Filter, Art des Markts, Route, Teilen.
- **Schriften:** Bricolage Grotesque für Überschriften, Figtree für alles andere. DM Mono wird nicht mehr gebraucht; die Dateien im Ordner `fonts` können bleiben oder gelöscht werden.

## Technik für Google (Stand 3. Oktober)

- **Schriften:** Im Ordner `fonts` liegen zwei kompakte Dateien (`Figtree-Variable.woff2`, `BricolageGrotesque-Variable.woff2`, zusammen rund 105 KB statt 470 KB). Sie werden vorgeladen, damit Überschriften sofort in der richtigen Schrift erscheinen. Alte `.ttf`-Dateien können gelöscht werden.
- **Icons:** liegen in einer eigenen Datei `/assets/icons.svg`, die der Browser einmal lädt und dann merkt. Jede Seite ist dadurch rund ein Drittel leichter.
- **Seitentitel:** Wäre ein Titel mit „ | Flohlotse“ länger als 60 Zeichen, fällt der Zusatz automatisch weg, damit Google nichts abschneidet.
- **Sitemap:** Das Änderungsdatum einer Seite ändert sich nur, wenn sich ihr Inhalt geändert hat. Der Merkzettel dafür liegt unter `/assets/seiten-stand.json`.
- **Lange Listen:** Terminkarten außerhalb des Bildschirms werden erst beim Scrollen gezeichnet.

## Termin-Wächter

- Jede Nacht ruft der Bau die Adresse aus der Spalte „Veranstalter-Website“ ab und merkt sich, welche Datumsangaben dort stehen. Ändern sie sich, steht im Bericht unter „Termin-Wächter“, was neu ist und was fehlt, zusammen mit dem Link. Der Hinweis bleibt sieben Tage stehen.
- Es wird **nichts automatisch übernommen**. Für neue Tage liefert der Bericht aber fertige Zeilen („Vorschläge zum Einfügen“): auf der Veranstalterseite prüfen, Zeilen kopieren, im Blatt „Termine“ einfügen. Eingesetzt ist die übliche Uhrzeit des Markts. Verschwindet ein Tag von der Veranstalterseite, der noch im Kalender steht, warnt der Bericht ausdrücklich.
- Am genauesten arbeitet der Wächter, wenn in „Veranstalter-Website“ die Seite steht, auf der die Termine wirklich stehen (nicht nur die Startseite).
- Der erste Lauf merkt sich nur den Stand und meldet nichts. Termine in Bildern, PDFs oder auf Facebook und Instagram erkennt der Wächter nicht.
- Sperrt ein Veranstalter automatische Abrufe (robots.txt), wird seine Seite nicht abgerufen und einmalig im Bericht genannt.
- Der Merkzettel liegt unter `/assets/waechter.json` auf der Website. Abschalten: im Workflow die Variable `WAECHTER` auf `aus` setzen.

## Wetter und Teilen

- **Wetter:** Beim nächtlichen Bau lädt die Website einmal die Vorhersage des Deutschen Wetterdienstes (über Bright Sky, kostenlos, ohne Anmeldung). Für die nächsten fünf Tage sagt dann der Wetterfrosch auf gelbem Schild das Wetter voraus („Regen wahrscheinlich ab ca. 10 Uhr, bis 15°“). Wird es an einem Markttag nass, erscheint oben ein Kasten mit den überdachten Märkten dieses Tages. Besucher laden dabei nichts von fremden Servern.
- Ist der Wetterdienst nicht erreichbar, wird die Seite ohne Wetter gebaut. Abschalten: im Workflow die Variable `WETTER` auf `aus` setzen.
- **Teilen:** Jeder Termin und jede Marktseite hat einen Teilen-Knopf. Er öffnet das Teilen-Menü des Handys (WhatsApp, Signal, SMS, Mail …). Die Nachricht ist fertig formuliert (Markt, Tag, Uhrzeit, Link, bei Bedarf ein Wetter-Satz). Es wird nichts übertragen, bevor jemand tippt.

## Rechtliches, das die Website automatisch erledigt
- Der Lizenztext der Schriften (Open Font License) wird unter /fonts/OFL.txt mitveröffentlicht, die Icon-Lizenz unter /assets/icons-lizenz.txt. Quellen für Karte und Postleitzahlen stehen im Impressum.
- Die Datenschutzerklärung enthält Abschnitte zu Veranstalter-Daten, Umkreissuche und Karte. Trotzdem vor dem Livegang fachlich prüfen lassen.
- Echte Fotos (ohne `-ki` im Dateinamen) brauchen einen Bildnachweis im Blatt Einstellungen. Fehlt er, steht eine Erinnerung im Bericht.
- **Wichtig:** Die Google-Tabelle ist per Link lesbar. Dort niemals E-Mail-Adressen, Telefonnummern oder Notizen zu Einsendern speichern.

## Sofort neu bauen
Reiter „Actions“ > „Website bauen“ > „Run workflow“.

## Wenn ein Bau rot wird
Dann steht oben in der Zusammenfassung des Laufs in einem Satz, was in der Tabelle nicht stimmt, z. B. eine doppelte Kennung oder ein fehlendes Anführungszeichen. Die bisherige Website bleibt so lange unverändert online. Fehler korrigieren und neu bauen.

## Sicherheit
- Links in der Tabelle werden nur übernommen, wenn sie mit `https://`, `mailto:` oder `/` beginnen. Alles andere wird entfernt und im Bericht gemeldet.
- Kennungen dürfen nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.
- Die Bausteine im Ablauf (`.github/workflows/website.yml`) sind auf feste Versionen gepinnt, und jeder Schritt hat nur die Rechte, die er braucht.

## Lokal testen (nur für Technik-Interessierte)
    node build.mjs
Danach liegt die fertige Website im Ordner `dist/`.

## Fotos und Bildnachweis

Im Ordner `bilder` liegen die Symbolfotos. Ein echtes Foto (`start.webp`) hat Vorrang vor einem KI-Bild (`start-ki.webp`). Fehlt eine Datei, wird die Stelle ohne Bild gebaut.

| Datei | Wo | Format |
|---|---|---|
| `start.webp`, `start-klein.webp` | Startseite, erstes Bild im Slider | quer 3:2 (1520 × 1013, 760 × 507) |
| `ratgeber-<bereich>.webp`, `…-klein.webp` | Kopfbild je Ratgeber-Bereich | Banner (1520 × 665, 760 × 332) |
| `seite-<kennung-der-themenseite>.webp` | Themenseite, z. B. `seite-antikmarkt-hamburg.webp` | hoch 4:5 (480 × 600), neben dem Text |
| `seite-schilder.webp` | Schilder-Designer | quer 4:3 (800 × 600) |
| `teilen-ki.jpg` | Vorschaubild beim Teilen | 1200 × 630 |

`nachweis.json` enthält je Foto: `name` (Dateiname auf der Website, sprechend für die Google-Bildersuche), `alt` (Bildbeschreibung), `autor`, dazu die Quelle mit Pflichttext („Designed by Magnific“ mit Link) und die Liste der Fotos fürs Impressum. Daraus entstehen automatisch: der Nachweis am Bild, der Abschnitt im Impressum, die Bildbeschreibung, die Angaben für Google (Urheber, Lizenz) und die Einträge in der Sitemap.

Damit nicht jede Seite gleich aussieht, hat jede Stelle eine eigene Bildform: Banner, schwarze Kante („kante“), rund („rund“) oder abgerundet eckig, links oder rechts neben dem Text. Keine weißen Ränder, keine Rundbögen. Die Zuordnung steht in `build.mjs` bei `KB_FORM` (Ratgeber-Artikel), `THUMB_FORM` (Ratgeber-Übersicht) und `CAT_FORM` (Themenseiten).

Der Slider auf der Startseite zeigt nach dem Foto bis zu zwei „Wochen-Highlights“: die nächsten Termine von Märkten mit der Kategorie „Groß & bekannt“ in den kommenden acht Tagen.

Die Lizenz-Zertifikate (PDF) nicht ins Repository legen, sondern privat aufbewahren. Die Fotos zeigen keinen gelisteten Markt und stehen deshalb auf keiner Marktseite.

## Für KI-Suchdienste (GEO)

- `/flohmarkt-hamburg-statistik/` („Flohmärkte in Hamburg in Zahlen“) wird jede Nacht aus dem Kalender berechnet: Märkte und Termine nach Bezirk, Art, Wochentag und Uhrzeit. Solche Zahlen mit Quelle und Datum werden gern zitiert.
- `robots.txt` erlaubt KI-Suchdienste ausdrücklich (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended und weitere). Wer das nicht möchte, trägt im Blatt Einstellungen `KI-Crawler erlauben` = `Nein` ein. Dann werden diese Dienste ausgesperrt, normale Suchmaschinen bleiben erlaubt.
- `llms.txt` beschreibt die Website und ihre wichtigsten Seiten für KI-Dienste. Sie entsteht nur, wenn die Website für Google freigegeben ist und KI-Crawler erlaubt sind.

Marktseiten zeigen den nächsten bekannten Termin auch dann, wenn er weiter entfernt liegt als die Vorschau („Tage im Voraus“). In den Terminlisten bleibt es bei der Vorschau.

## Instagram

Das Profil ist im Menü, im Footer und in einem Kasten auf der Startseite verlinkt (nur als Link, ohne eingebettete Inhalte). Die Adresse lässt sich im Blatt Einstellungen mit der Zeile `Instagram` ändern, mit dem Wert `Nein` verschwindet der Link.

Auf der Startseite läuft oben ein Laufband mit dem Instagram-Hinweis („+++ Flohlotse gibt’s jetzt auch bei Insta +++“) und einem festen Knopf „Folgen“. Beim Drüberfahren hält es an; ist am Gerät „Bewegung reduzieren“ eingestellt, steht es still. Ohne Instagram-Adresse entfällt es.

Ratgeber-Artikel: Je Bereich wechseln sich mehrere Fotos und Formen ab (`KB_POOL` in `build.mjs`), damit nicht jeder Artikel dasselbe Bild zeigt. Zusätzliche Banner heißen `banner-<name>.webp` und `banner-<name>-klein.webp`. Ein Foto nur für einen Artikel: `artikel-<kennung>.webp` (und `-klein.webp`) in den Ordner `bilder` legen, es hat Vorrang.
