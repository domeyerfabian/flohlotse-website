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
- Schilder: Der Schildgenerator liegt unter /flohmarkt-schilder/. Die Texte der Vorlagen stehen in build.mjs im Abschnitt „Schilder“ (nicht im Sheet). Die Vorschaubilder entstehen beim Bau automatisch. Seit 28. Oktober gibt es 22 Vorlagen: Preisschilder, Alles 1 €, Handeln erwünscht, Bar & PayPal, Mengenrabatt, Reserviert, Zu verschenken, Hofflohmarkt (Wegweiser), Alles muss raus, Bin gleich zurück, Bitte nicht anfassen, Kinderflohmarkt, Lustige Sprüche, Mädelsflohmarkt (in Pink voreingestellt), Weihnachten, Vintage & Rarität, Guter Zweck, Kaffee & Kuchen, Getestet (Elektronik), Größen (4 pro Blatt), Kategorien und Kleidertausch (in Mint voreingestellt). Jedes Schild lässt sich mit Fläche in Gelb, Pink, Mint oder Schwarz drucken, mit eigener Schriftfarbe (Schwarz, Weiß, Gold, Pink; nur gut lesbare Paare sind wählbar, Gold druckt als Goldton) und in den Schriften Modern, Klar oder Elegant (Fraunces, liegt als `fonts/Fraunces-SemiBold.woff2` bei). Eine verspielte Schreibschrift erscheint automatisch, sobald die Datei von Pacifico (fonts.google.com, Open Font License) im Ordner `fonts` liegt. Die Schild-Schriften werden nur geladen, wenn jemand sie auswählt. Bedienung: Die Vorschau bleibt beim Bearbeiten oben stehen, darunter vier Reiter (Text, Stil, Symbol, Format). Formate (alle im Querformat): 1, 2, 4 oder 8 Schilder pro Blatt. Der QR-Code zu Flohlotse steht nur bei 1 und 2 pro Blatt (dort gedruckt 15 mm groß, sicher scanbar); bei 4 und 8 pro Blatt wäre er zu klein, dort steht nur die Adresse. Der PayPal-QR-Code bleibt in allen Formaten groß genug. Gedruckt wird immer auf A4 hoch; bei 1 und 4 pro Blatt liegt das Querformat-Blatt dabei um 90 Grad gedreht auf dem Papier und füllt es ganz aus. So klappt es auf jedem Gerät, auch dort, wo der Browser „quer“ nicht beachtet (z. B. Chrome auf Android). Im Druckfenster muss „Hochformat“ eingestellt bleiben; darauf weist der Designer hin. Formen der Farbfläche (Reiter „Form“): Klassisch, Wolke, Blume, Stern, Sprechblase, Etikett; der Text wird automatisch so eingepasst, dass er ganz innerhalb der Form bleibt; einige Vorlagen haben eine Form voreingestellt. Weiß und Gold sind auch auf Gelb, Pink und Mint wählbar und bekommen dort automatisch eine dunkle Kontur. Bei „Verspielt“ bleibt die kleine Zeile oben in der normalen Schrift, damit sie gut lesbar ist und mit einem von 46 Symbolen als rundem Aufkleber verzieren (Krone, Sektglas, Herz, Diamant …; Font Awesome Free, Lizenz CC BY 4.0, im Impressum genannt). Jede hat eine eigene Seite und ein Vorschaubild in der Bild-Sitemap. Die Vorschaubilder sind echte Aufnahmen des Designers und liegen im Ordner `src/schilder` (je ein WebP-Bild plus `vorschau.json`). Ändert sich der Text einer Vorlage, zeigt die Website so lange das einfache gezeichnete Bild und der Bericht meldet es, bis die Aufnahmen neu erzeugt sind. Pfeile (→ ← ↑ ↓) im Schildtext erscheinen als Grafik in Schriftstärke. Im Designer wählt man oben ein „Thema“ (jede Vorlage plus „Eigener Text“), darunter erscheinen alle Sprüche dieses Themas; das gilt auf der Übersicht und auf jeder Vorlagen-Seite.
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

## Schilder-Designer: Ideen zum Antippen

- Oben im Designer stehen zwölf fertige Looks als kleine Bilder (zum Beispiel „Prickelnde Preise“ als pinke Wolke mit weißer Schreibschrift). Ein Tipp übernimmt Spruch, Farbe, Schriftfarbe, Schrift, Form und Symbol, danach kann man den Text ändern und drucken. Am Handy wischt man durch die Reihe, am Computer stehen sie in zwei Reihen.
- Darunter folgt „Alle Vorlagen nach Kategorie“ mit der gelben Auswahl. Der erste Reiter ist jetzt „Stil“ (Farben und Schriften), „Text“ ist der zweite.
- Welche Looks erscheinen, steht in `build.mjs` unter `IDEAS`. Die Bilder liegen in `src/schilder/ideen/` (echte Aufnahmen aus dem Designer). Fehlt ein Bild, zeigt die Karte nur Farbe und Namen. Ändert sich der Spruch einer Vorlage, sollte das Bild neu aufgenommen werden.
- Es wird nichts gespeichert: Die Ideen sind von uns, nicht von anderen Besucherinnen.

## Monatsseiten: Tipps und Zahlen von selbst (26. Oktober)
- Unter „Kurz gesagt“ stehen auf jeder Monatsseite **„Fabians Tipps für den …“**: drei Märkte, automatisch aus dem Kalender gewählt (im Winter zuerst überdacht, dann Kinderflohmarkt, abends, Frühaufsteher, großer Markt), nur Termine ab heute, jeder Markt nur einmal. Die Begründung ist ein fester Satz je Art, mit Foto bzw. Anfangsbuchstabe aus „Über mich“. Nichts zu pflegen.
- Darunter **„Das bringt der …“**: Zahl der Kinderflohmärkte, überdachten und abendlichen Märkte im Monat (zum Antippen) und der Tag mit den meisten Märkten.
- Ohne Namen (Zeile `Über mich: Vorname` leer) erscheinen nur die Zahlen.
- **So findet man die Tipps:** Auf der Startseite steht als erster Schnellzugriff „Tipps für November“ (ab dem 20. eines Monats schon der nächste Monat), er springt direkt zu den Tipps. Im Menü stehen unter „Wann?“ die nächsten drei Monate, ebenso oben auf der Seite Termine („Ganzer Monat mit Tipps und Zahlen“).

## Persönlicher Kasten „Hallo, ich bin …“ (24. Oktober)
- Auf der Startseite steht nach „Die nächsten Flohmärkte“ ein Kasten mit einer kurzen Vorstellung, auf „Über Flohlotse“ die ganze Geschichte (Abschnitt „Warum es Flohlotse gibt“, Sprungmarke #warum). Titel und Adresse der Seite sind unverändert.
- **Foto:** eine quadratische Datei `bilder/ich.webp` (oder `bilder/ich.jpg`), mindestens 240 × 240 Pixel. Ohne Foto steht dort der Anfangsbuchstabe im gelben Kreis.
- **Name:** Blatt Einstellungen, Zeile `Über mich: Vorname` (ohne Zeile: „Fabian“). Steht die Zeile da und ist leer, verschwinden beide Kästen.

## Menü und Stand (24. Oktober)
- **WhatsApp an drei Stellen, die zum Folgen einladen:** der gelbe Kasten auf der Startseite („Flohmarkt-Tipps direkt aufs Handy“, Instagram als zweiter Link), eine Zeile „Flohmarkt-Tipps direkt aufs Handy“ unter den Terminen auf Heute, Morgen, Wochenende, Samstag und Sonntag, und einmalig beim Merken ein kurzer Hinweis unten (kam vorher der Kalender-Hinweis, beim nächsten Merken; gemerkt im Browser unter „flohlotse-wa-tipp“). Ohne WhatsApp-Link zeigt der gelbe Kasten wieder Instagram.
- **WhatsApp:** Zeile `WhatsApp` im Blatt Einstellungen (ohne Zeile: der Flohlotse-Kanal https://whatsapp.com/channel/0029Vb97whOB4hdY2z4Vf11D). Erlaubt ist ein Kanal-Link (`https://whatsapp.com/channel/…`, Beschriftung „WhatsApp-Kanal“) ein Community-Link (`https://chat.whatsapp.com/…`, „WhatsApp-Community“) oder ein Chat-Link (`https://wa.me/49…`, „WhatsApp-Chat“). Im Plus-Menü stehen seit 24.10. nur noch WhatsApp, Termine, Schilder, Kauf-Check und Ratgeber („Wischen & merken“ steht weiter im Menü und auf der Startseite). Dann steht WhatsApp oben im Plus-Menü (grünes Symbol), bei „Folge Flohlotse“ im Menü und in der Fußzeile, in den Angaben für Google und in der Datenschutzerklärung. Leer = überall weg. Ein ungültiger Link erscheint im Bau-Bericht.
- **Folge Flohlotse:** Ganz unten im Menü und in der Fußzeile stehen runde Knöpfe für Instagram und TikTok. Die Adressen kommen aus dem Blatt Einstellungen, Zeilen `Instagram` und `TikTok` (z. B. `https://www.tiktok.com/@flohlotse`). Leere Zeile = kein Knopf. Beide Profile stehen auch in den Angaben für Google (sameAs), und die Datenschutzerklärung nennt sie als einfache Links.
- **Menü in vier Fragen:** „Wann?“ (Heute, Morgen, Wochenende als gelbe Felder, darunter Alle Termine, Unter der Woche, Alle Märkte A–Z, Wischen & merken), „Was für ein Markt?“ (alle Arten als Chips mit Symbol), „Wo?“ (Bezirke und Umland zum Aufklappen) und „Für deinen Flohmarkt“ (Schilder, Kauf-Check, Ratgeber). Seltenes steht klein darunter: Standgebühren, Tipps & Vorlagen, Für Veranstalter, Über Flohlotse, Instagram, Impressum, Datenschutz. Am Computer stehen die Bereiche in drei Spalten.
- Samstag, Sonntag und die Ratgeber-Themen sind nicht mehr im Menü, aber weiter in der Fußzeile und auf den Seiten verlinkt. Suche und Merkliste sind oben als Symbole. Keine Adresse hat sich geändert.
- Bei offenem Menü ist der Plus-Knopf unten rechts ausgeblendet. Das Menü ist genau so hoch wie der sichtbare Bereich (auch mit Browserleiste am Handy) und scrollt für sich; am Ende scrollt die Seite dahinter nicht mit.
- **Kein Hinweis „Wird aktualisiert“ mehr:** Nach Mitternacht bis zum nächsten Bau verschwinden vergangene Termine still. Den Stand nennt die letzte Zeile der Fußzeile („Stand der Termine: …“).

## Termine gehören ins Blatt Termine, nicht in Texte

- **Regel:** Konkrete Daten („11. Oktober“, „4.10.“) nur ins Blatt **Termine** (oder **Serien**) eintragen. Texte im Blatt **Märkte** (Einleitung, Kurzbeschreibung, Hinweis, Tipps, SEO-Beschreibung) ohne festes Datum schreiben, zum Beispiel „mehrmals im Jahr“ oder „zweiter Sonntag im Monat“. Saisonangaben wie „im Juni“ oder „März bis Oktober“ sind in Ordnung.
- **Google-Beschreibung:** Der nächste Termin steht automatisch vorne in der Beschreibung jeder Marktseite („nächster Termin Sa., 31. Oktober, 8 bis 16 Uhr“). Enthält die SEO-Beschreibung im Blatt ein festes Datum, nimmt der Bau sie nicht und rechnet selbst eine aus. Ein veraltetes Datum landet so nie bei Google.
- **Bericht:** Nennt ein Text im Blatt Märkte ein Datum, das schon vorbei ist, steht das jede Nacht im Baubericht unter „Zur Kenntnis“, mit Markt, Spalte und Datum. Diese Stellen einfach nach und nach umformulieren. Der Bau bleibt dabei grün.

## Termin melden (Briefumschlag)

- In der Kopfzeile jeder Seite steht ein Briefumschlag. Er öffnet ein kleines Fenster mit zwei vorbereiteten E-Mails: „Neuen Termin melden“ und „Änderung oder Absage“. Auf jeder Marktseite steht unter „Nächste Termine“ zusätzlich „Termin fehlt oder stimmt nicht? Melden“, dort ist der Marktname samt Link schon in der E-Mail eingetragen.
- Die E-Mails gehen an die Adresse aus **Einstellungen → Impressum: E-Mail**. Ist dort ein **Formular-Link** eingetragen, führt der Briefumschlag direkt zum Formular.
- „E-Mail-Adresse kopieren“ hilft allen, deren Handy kein Mail-Programm eingerichtet hat. Es gibt kein Formular auf der Website und nichts wird gespeichert, die Datenschutzerklärung (Abschnitt „Kontakt per E-Mail“) deckt das ab.
- Damit am Handy alles in die Kopfzeile passt, zeigt der Menü-Knopf dort nur noch das Symbol ☰ (für Screenreader heißt er weiter „Menü“). Am Computer steht „Menü“ wie bisher.

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

Auf der Startseite steht oben eine Neuigkeiten-Zeile. Sie wechselt alle 4,5 Sekunden zwischen drei Meldungen, jede mit eigenem Knopf: Instagram („Folgen“), Kauf-Check („Prüfen“) und Schilder („Gestalten“). Beim Drüberfahren oder mit der Tastatur bleibt die Meldung stehen; ist am Gerät „Bewegung reduzieren“ eingestellt, bleibt die erste stehen. Ohne Instagram-Adresse entfällt die Zeile.

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

## Neu seit dem letzten Besuch (28. Oktober)

Wer öfter reinschaut, sieht neue Märkte sofort, ganz ohne Pflege:

- **Rote Zahl am Menü-Knopf:** zeigt, wie viele Märkte seit dem letzten Besuch dazugekommen sind. Beim Öffnen des Menüs gilt alles als gesehen, die Zahl verschwindet.
- **Im Menü ganz oben „Neu im Kalender“:** die bis zu sechs neuesten Märkte mit nächstem Termin und Stadtteil. Noch nicht gesehene haben einen roten Punkt.

Wie es funktioniert: Der nächtliche Bau merkt sich, an welchem Tag ein Markt zum ersten Mal da war (im Merkzettel `seiten-stand.json`, 21 Tage lang), und schreibt die Liste nach `/assets/neu.json`. Was schon gesehen wurde, speichert nur der Browser des Besuchers, es wird nichts übertragen. Beim allerersten Besuch gilt alles als gesehen, es gibt also keine rote Zahl für Neulinge. Das „Neu“-Schild an den Märkten bleibt wie bisher drei Tage.

Du musst nichts tun: Einfach wie immer Märkte in die Tabelle eintragen.

## Schilder-Designer: neue Vorlagen und Sprüche (28. Oktober)

Aus der Recherche (im Projekt: `claude/schild-designer-recherche-2026-10-28.md`): Ordnung verkauft, und Kleidertausch wächst.

- **Drei neue Vorlagen** mit eigener Seite: **Größen** (`/flohmarkt-schilder/groessenschilder/`, Kindergrößen 50 bis 152, Damen S bis L und 38–40, Herren, Schuhe; 4 pro Blatt), **Kategorien** (`/flohmarkt-schilder/kategorien/`, Bücher, Damen, Herren, Kinder, Haushalt, Deko, Spielzeug, Schmuck, Schuhe & Taschen, Platten & CDs) und **Kleidertausch** (`/flohmarkt-schilder/kleidertausch/`, Bring eins nimm eins, Annahme, Max. 10 Teile, Umkleide und mehr).
- **Neue Sprüche** in bestehenden Vorlagen: Mädelsflohmarkt (Einmal getragen, zweimal geliebt; Second Hand, first Love; Nur mit Anprobieren; Probier mich an!; Mein Kleiderschrank macht Diät; Taschen-Glück ab 5 €), Kinderflohmarkt (Rausgewachsen, nicht rausgeliebt; Schnell gewachsen; Der Chef persönlich), Lustige Sprüche (Gebraucht, aber nicht verbraucht; Kein Ramsch, nur Schätze; Mit Liebe aussortiert). Sie stehen jeweils hinten, damit die vorhandenen Vorschaubilder gültig bleiben.
- **Ideen zum Antippen:** 18 statt 12 Looks, die sechs neuen stehen vorn.
- Neue Bilder: `src/schilder/flohmarkt-groessenschilder-vorlage.webp`, `-kategorien-`, `-kleidertausch-`, dazu `src/schilder/vorschau.json` und sechs Bilder in `src/schilder/ideen/`. Alle mit hochladen.
- Die Liste „Alle Vorlagen“ zeigt nie nur zwei Spalten, damit die Vorschaubilder nicht riesig werden.

## Schilder-Designer: fertige Looks (28. Oktober, abends)

- Im Reiter **„Stil“** steht oben die Zeile **„Look“**: Ein Tipp setzt Fläche, Schriftfarbe, Schrift und Form auf einmal. Danach lässt sich alles wie gewohnt einzeln ändern, und der Look bleibt beim Wechsel der Vorlage erhalten.
  - **Flohlotse:** Gelb, moderne Schrift (der bisherige Standard)
  - **Retro 70er:** Karamell, elegante Serifenschrift, Form „Blume“
  - **Kassenbon:** Papierton, Schreibmaschinenschrift (DM Mono), neue Form „Kassenbon“ mit Zackenrand. Spart Farbe beim Drucken.
  - **Schleife:** Rosé, elegante Serifenschrift, neues Symbol „Schleife“
  - **Natur:** Salbeigrün, klare Schrift, Form „Wolke“, neues Symbol „Blatt“
- **Vier neue Flächenfarben:** Karamell, Salbei, Rosé und Papier (jetzt acht). Die Farbfelder brechen am Handy in eine zweite Reihe um.
- **Neue Schrift „Bon“** (DM Mono) für den Kassenbon-Look. Sie nutzt die Datei `fonts/DMMono-Medium.ttf`, die schon im Ordner `fonts` liegt. Fehlt die Datei, erscheinen Schrift und Kassenbon-Look einfach nicht.
- **Neue Form „Kassenbon“** und **zwei neue Symbole** (Schleife, Blatt; eigene Zeichnungen, im Lizenzhinweis vermerkt).
- **Ideen zum Antippen:** vier neue Karten mit den Looks (Retro 70er, Kassenbon, Schleife, Natur). Dafür sind Anprobieren erwünscht, Halber Preis, Fehlkauf und Rarität aus der Reihe raus (die Sprüche gibt es weiter in den Vorlagen). Es bleiben 18 Karten. Neue Bilder in `src/schilder/ideen/` mit hochladen.

## Schilder-Designer: Looks wie auf Pinterest (28. Oktober, spät)

Fünf neue Looks, die das ganze Schild gestalten, nicht nur die Farbfläche (inspiriert von Schildern auf Mädelsflohmärkten und in Second-Hand-Läden):
- **Poster:** weißes Blatt, große schmale Großbuchstaben in Schwarz und Pink, Funkelsterne
- **Rosa Plakat:** ganzes Blatt rosa, Rot in Großbuchstaben, unten eine Zeile in Schreibschrift wie eine Unterschrift
- **Coquette:** zarte rosa Streifen, weiße Blumenform mit roter Kontur, rote Schleife
- **Tafel:** schwarze Fläche mit rosa Rahmen, weiße und rosa Schrift, Herzen (viel Farbe beim Drucken, Sparmodus druckt nur die Schrift)
- **Letterboard:** hellgraue Rillen, dunkler Rahmen, letzte Zeile in Rot

Technik: Die Looks setzen zusätzlich eine Klasse `deco-…` am Blatt. Wer danach selbst eine Fläche oder Form wählt, bekommt wieder das normale Schild. Neue Schrift **„Plakat“**: eine schmale, extra fette Fassung von Bricolage (Datei `fonts/BricolageCondensed-ExtraBold.woff`, Open Font License, in `fonts/OFL.txt` genannt). **Diese Datei in den Ordner `fonts` hochladen**, sonst fehlen Poster, Rosa Plakat, Tafel und Letterboard.

Neue Sprüche im Mädelsflohmarkt: „Du siehst aus wie meine nächste Kundin“, „Gib Kleidung eine zweite Chance. Nicht deinem Ex.“, „Hot People shoppen Second Hand“, „Coole Leute kaufen Second Hand“, „Kauf jetzt oder heul später“, „Muss nicht neu sein, um toll zu sein“, „Second Hand ist sexy“, „Shopping war nie günstiger“, „Wir haben süße Klamotten. Du hast einen Schrank. Lass uns reden.“

Ideen zum Antippen: Die fünf neuen Looks stehen vorn. Dafür sind Prickelnde Preise, Mir zu klein (Mint), Neu mit Etikett, Glitzer-Ecke und Moin aus der Reihe raus (die Sprüche bleiben in den Vorlagen). Es bleiben 18 Karten.

## Schilder-Designer aufgeräumt (28. Oktober, nachts)

- **Reiter „Stil“:** Jede Gruppe (Look, Fläche, Schriftfarbe, Schrift) hat eine kleine Überschrift und genau eine Reihe. Am Handy wischt man die Reihe seitlich, nichts bricht mehr um.
- **Looks als kleine Vorschau-Kacheln** statt Text-Knöpfe: Man sieht Farbe und Stil, bevor man tippt. Die Kacheln nutzen nur Schriften, die schon geladen sind, damit die Seite schnell bleibt.
- **Vorschau am Handy:** Die stehende Vorschau ist ein Band über die ganze Kartenbreite, das Blatt sitzt mittig mit etwas Luft. Hochformat-Blätter (2 und 8 pro Blatt, Preisschilder) werden auf höchstens 42 % der Bildschirmhöhe verkleinert. So rutschen beim Bearbeiten keine Knöpfe mehr seitlich an der Vorschau vorbei.

## Farben frei kombinierbar, Gold flach (28. Oktober, nachts)

- **Jede Schriftfarbe passt jetzt zu jeder Fläche**, es ist nichts mehr ausgegraut. Standard bleibt Schwarz (auf schwarzer Fläche Weiß).
- **Gold ist eine flache Farbe** (#C9A13B), ohne Farbverlauf und ohne Rand. Weiß auf heller Fläche behält eine dünne dunkle Kontur, damit man es überhaupt lesen kann.
- Die Ideen-Bilder „Königliche Preise“ und „Bar & PayPal“ sind mit dem neuen Gold neu aufgenommen.
