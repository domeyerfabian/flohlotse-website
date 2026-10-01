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
- Auf /veranstalter/ können Veranstalter einen **Link-Code** für ihre eigene Website kopieren. Jeder eingebaute Link hilft beim Ranking.

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
