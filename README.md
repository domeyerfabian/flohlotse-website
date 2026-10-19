# Flohlotse Website

Die Website entsteht automatisch aus der Google-Tabelle „Flohlotse Redaktion“. Jede Nacht wird sie neu gebaut.
Ihr pflegt nur die Tabelle. Die ausführliche Einrichtungsanleitung liegt als Dokument bei.

## Was wo ist
- `build.mjs` baut die Website. Nicht ändern nötig.
- `daten/` enthält eine Kopie der Tabelle. Sie wird nur genutzt, solange noch keine Google-Tabelle verbunden ist.
- `src/` enthält Gestaltung (style.css), Skript (site.js) und die Symbole für Browser-Tab, Lesezeichen und Startbildschirm (`icon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`).
- `fonts/` für die Schriftdateien, siehe LIESMICH.txt.
- `bilder/` enthält die Symbolfotos (Startseite, Ratgeber, Vorschaubild beim Teilen). Dateinamen nicht ändern; fehlt ein Foto, wird die Stelle ohne Bild gebaut.
- Icons: Jede Marktart aus der Spalte „Kategorien“ (Blatt Märkte) hat ein eigenes Icon (Phosphor Icons, Stil Light, MIT-Lizenz; Stern, Mond, Haus …). Eine neue Kategorie im Sheet bekommt automatisch ein neutrales Etikett-Icon, es geht nichts kaputt.
- Schilder: Der Schildgenerator liegt unter /flohmarkt-schilder/. Die Texte der Vorlagen stehen in build.mjs im Abschnitt „Schilder“ (nicht im Sheet). Die Vorschaubilder entstehen beim Bau automatisch. Seit 18. Oktober gibt es 19 Vorlagen: Preisschilder, Alles 1 €, Handeln erwünscht, Bar & PayPal, Mengenrabatt, Reserviert, Zu verschenken, Hofflohmarkt (Wegweiser), Alles muss raus, Bin gleich zurück, Bitte nicht anfassen, Kinderflohmarkt, Lustige Sprüche, Mädelsflohmarkt (in Pink voreingestellt), Weihnachten, Vintage & Rarität, Guter Zweck, Kaffee & Kuchen und Getestet (Elektronik). Jedes Schild lässt sich mit Fläche in Gelb, Pink, Mint oder Schwarz drucken, mit eigener Schriftfarbe (Schwarz, Weiß, Gold, Pink; nur gut lesbare Paare sind wählbar, Gold druckt als Goldton) und in den Schriften Modern, Klar oder Elegant (Fraunces, liegt als `fonts/Fraunces-SemiBold.woff2` bei). Eine verspielte Schreibschrift erscheint automatisch, sobald die Datei von Pacifico (fonts.google.com, Open Font License) im Ordner `fonts` liegt. Die Schild-Schriften werden nur geladen, wenn jemand sie auswählt. Bedienung: Die Vorschau bleibt beim Bearbeiten oben stehen, darunter vier Reiter (Text, Stil, Symbol, Format). Formate (alle im Querformat): 1, 2, 4 oder 8 Schilder pro Blatt. Der QR-Code zu Flohlotse steht nur bei 1 und 2 pro Blatt (dort gedruckt 15 mm groß, sicher scanbar); bei 4 und 8 pro Blatt wäre er zu klein, dort steht nur die Adresse. Der PayPal-QR-Code bleibt in allen Formaten groß genug. Gedruckt wird immer auf A4 hoch; bei 1 und 4 pro Blatt liegt das Querformat-Blatt dabei um 90 Grad gedreht auf dem Papier und füllt es ganz aus. So klappt es auf jedem Gerät, auch dort, wo der Browser „quer“ nicht beachtet (z. B. Chrome auf Android). Im Druckfenster muss „Hochformat“ eingestellt bleiben; darauf weist der Designer hin. Formen der Farbfläche (Reiter „Form“): Klassisch, Wolke, Blume, Stern, Sprechblase, Etikett; der Text wird automatisch so eingepasst, dass er ganz innerhalb der Form bleibt; einige Vorlagen haben eine Form voreingestellt. Weiß und Gold sind auch auf Gelb, Pink und Mint wählbar und bekommen dort automatisch eine dunkle Kontur. Bei „Verspielt“ bleibt die kleine Zeile oben in der normalen Schrift, damit sie gut lesbar ist und mit einem von 46 Symbolen als rundem Aufkleber verzieren (Krone, Sektglas, Herz, Diamant …; Font Awesome Free, Lizenz CC BY 4.0, im Impressum genannt). Jede hat eine eigene Seite und ein Vorschaubild in der Bild-Sitemap. Die Vorschaubilder sind echte Aufnahmen des Designers und liegen im Ordner `src/schilder` (je ein WebP-Bild plus `vorschau.json`). Ändert sich der Text einer Vorlage, zeigt die Website so lange das einfache gezeichnete Bild und der Bericht meldet es, bis die Aufnahmen neu erzeugt sind. Pfeile (→ ← ↑ ↓) im Schildtext erscheinen als Grafik in Schriftstärke. Im Designer wählt man oben ein „Thema“ (jede Vorlage plus „Eigener Text“), darunter erscheinen alle Sprüche dieses Themas; das gilt auf der Übersicht und auf jeder Vorlagen-Seite.
- `bericht.md` zeigt nach jedem Bau drei Abschnitte: **Zu erledigen** (Fehler in der Tabelle zuerst, dann fehlende Uhrzeiten und der Termin-Wächter), **Vorschläge zum Einfügen** (fertige Zeilen des Termin-Wächters) und **Zur Kenntnis** (z. B. Märkte ohne Termin in der Vorschau, als eine Sammelzeile).

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
- **Großer Bildschirm (ab 1080 px Breite):** alles steht in einem Raster aus zwölf Spalten. Auf der Startseite wechseln sich die Bereiche ab: Papiergrund, ein weißes Band (Stöbern nach Bezirk, Art und Monat; später Wissen und Fragen) und ein dunkles Band für „Wischen & merken“. Die Bänder reichen bis an den Bildschirmrand, ihr Inhalt bleibt im Raster. Nebeneinanderstehende Überschriften und Kästen sind oben und unten bündig. Der Sticker „Termine heute“ klebt auf der unteren linken Ecke des Kastens mit den heutigen Terminen. In Terminkarten steht „Zum Markt“ immer unten rechts.
- **Handy und Tablet:** „Wischen & merken“ steht in einem dunklen, abgerundeten Kasten, der etwas in den Seitenrand ragt; Karte, Texte und Knöpfe stehen genau wie vorher. Sonst ist dort alles unverändert.
- **Termin-Kasten oben auf der Startseite:** Sind alle heutigen Märkte vorbei und gibt es auch in den anderen Reitern nichts, blendet er sich ganz aus (auf allen Geräten) statt als leerer Rahmen stehen zu bleiben.

## Technik für Google (Stand 3. Oktober)

- **Schriften:** Im Ordner `fonts` liegen zwei kompakte Dateien (`Figtree-Variable.woff2`, `BricolageGrotesque-Variable.woff2`, zusammen rund 105 KB statt 470 KB). Sie werden vorgeladen, damit Überschriften sofort in der richtigen Schrift erscheinen. Alte `.ttf`-Dateien können gelöscht werden.
- **Icons:** liegen in einer eigenen Datei `/assets/icons.svg`, die der Browser einmal lädt und dann merkt. Jede Seite ist dadurch rund ein Drittel leichter.
- **Seitentitel:** Wäre ein Titel mit „ | Flohlotse“ länger als 60 Zeichen, fällt der Zusatz automatisch weg, damit Google nichts abschneidet.
- **Sitemap:** Das Änderungsdatum einer Seite ändert sich nur, wenn sich ihr Inhalt geändert hat. Der Merkzettel dafür liegt unter `/assets/seiten-stand.json`. Seit 18. Oktober zählt dabei nur der Hauptteil der Seite (mit Titel, Beschreibung und strukturierten Daten), nicht Kopf, Menü und Fuß: Ein neuer Menüpunkt oder ein neues Design gilt nicht als neuer Inhalt.
- **Datum in Artikeln:** Ratgeber- und Kauf-Check-Artikel nennen als „Stand“ den Tag, an dem sich ihr Text zuletzt geändert hat (Überschrift, Kurz gesagt, Abschnitte, Fragen). Dasselbe Datum steht für Google als `dateModified` in der Seite. Wer einen Artikel in der Tabelle ändert, bekommt am nächsten Morgen automatisch das neue Datum. Kalenderseiten (Märkte, Bezirke, Termine) nennen weiter den Tag des Baus, weil sie jede Nacht mit dem aktuellen Stand der Termine neu erstellt werden.
- **Hauptmenü:** zwei Bereiche, „Hamburg“ (Termine, Märkte) und „Für jeden Flohmarkt“ (Schilder, Kauf-Check, Ratgeber). Die Überschriften erscheinen ab 1280 px Breite, darunter trennt nur ein Strich. Auf dem Tablet steht „Für Veranstalter“ nur im Menü und im Fuß. Am Ende jeder Werkzeug-Seite steht ein leiser Hinweis für Besucher aus Hamburg mit Link zu allen Terminen.
- **Lange Listen:** Terminkarten außerhalb des Bildschirms werden erst beim Scrollen gezeichnet.

## Termin-Wächter

- Jede Nacht ruft der Bau die Adresse aus der Spalte „Veranstalter-Website“ ab und merkt sich, welche Datumsangaben dort stehen. Im Bericht steht nur, was zu tun ist:
  - **Neu dort und noch nicht in der Tabelle:** mit fertiger Zeile zum Einfügen („Vorschläge zum Einfügen“). Sobald der Tag in der Tabelle steht, verschwindet der Hinweis; sonst nach sieben Tagen.
  - **Dort verschwunden, aber noch im Kalender:** ausdrückliche Warnung, dass der Termin vielleicht ausfällt.
- Es wird **nichts automatisch übernommen**. Vorschläge immer erst auf der Veranstalterseite prüfen. Eingesetzt ist die übliche Uhrzeit des Markts (leer, wenn die Tabelle noch keine kennt).
- Damit der Bericht ruhig bleibt, zählt nicht mit: vergangene Tage und das Tagesdatum der Seite; Listen, die auf allen Seiten eines Veranstalters gleich stehen („Kommende Flohmärkte“); auf Sammelseiten für mehrere Orte alles, was zu fremden Orten gehört; auf der Startseite eines Veranstaltungsorts alles ohne Marktwort in der Nähe (Konzerte, Gottesdienste). Zeilen gibt es nur für Tage am üblichen Wochentag des Markts oder an einem Feiertag.
- Am genauesten arbeitet der Wächter, wenn in „Veranstalter-Website“ die Seite steht, auf der die Termine dieses Markts wirklich stehen (nicht die Startseite und keine Seite für einen einzelnen Tag).
- Der erste Lauf merkt sich nur den Stand und meldet nichts. Termine in Bildern, PDFs oder auf Facebook und Instagram erkennt der Wächter nicht.
- Sperrt ein Veranstalter automatische Abrufe (robots.txt), wird seine Seite nicht abgerufen und einmalig im Bericht genannt. Ist eine Seite drei Nächte in Folge nicht erreichbar, steht das ebenfalls einmal im Bericht.
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

## Website-Check vom 4. Oktober 2026

- **Symbole:** Browser-Tab, Lesezeichen, Startbildschirm (iPhone und Android) und Google bekommen eigene Symboldateien aus `src/`. Dazu gibt es ein kleines Web-Manifest (`/manifest.webmanifest`) mit Name und Farben.
- **Sicherheit (`.htaccess`, entsteht beim Bau):** Die Seite lädt Skripte, Stile und Schriften nur von sich selbst, Kartenbilder nur von OpenStreetMap. Sie lässt sich nicht in fremde Seiten einbetten und ist ein halbes Jahr lang nur verschlüsselt erreichbar (HSTS). **Wichtig:** Wer später etwas von außen einbindet (Video, Schrift, Statistik, Formular), muss die Quelle in `build.mjs` bei `const CSP` ergänzen, sonst blockiert der Browser sie. Außerdem müsste dann die Datenschutzerklärung angepasst werden.
- **Notbremse:** Ergibt die Tabelle plötzlich weniger als die Hälfte der Märkte (oder der Märkte mit Termin) oder weniger als 40 % der Termine der letzten Nacht, wird nichts veröffentlicht. Meist sind dann Zeilen gelöscht oder Spalten verrutscht. Der Lauf wird rot und sagt, was zu tun ist; die bisherige Website bleibt online. Termine werden nur verglichen, wenn „Tage im Voraus“ unverändert ist und der letzte Bau höchstens eine Woche zurückliegt. Ist der Rückgang gewollt: im Blatt Einstellungen eine Zeile `Notbremse` mit dem Wert `aus` eintragen, neu bauen, Zeile wieder löschen.
- **Seite von gestern:** Zwischen Mitternacht und dem nächtlichen Neubau (oder wenn ein Neubau ausfällt) blendet die Seite vergangene Tage selbst aus und zeigt oben einen schwarzen Hinweis mit dem Stand.
- **Ohne JavaScript** bleiben alle Inhalte lesbar; Bedienelemente, die nur mit JavaScript etwas tun (Filter, Karte, Suche, Designer-Felder), werden dann nicht angezeigt.
- **Versionskürzel** (`?v=…`) tragen jetzt auch die Icon-Sammlung, das Symbol und die Karte. Änderungen an Stil, Skript und Icons kommen dadurch sofort bei allen an. Das Kürzel des Stils berücksichtigt auch die Schriftdateien.
- **Bilder:** Hochgeladen wird nur, was auf mindestens einer Seite vorkommt. Übrige Dateien im Ordner `bilder` nennt der Bericht unter „Zur Kenntnis“.
- **Marktseiten mit fernem Termin** (weiter weg als „Tage im Voraus“) zeigen ihn jetzt überall einheitlich: Überschrift, Terminliste, häufige Fragen und Daten für Google.
