# TicketScan

Einlasskontrolle für das Festival: 2305 Papiertickets mit fünfstelligen,
fortlaufenden Nummern auf aufgeklebten Etiketten, erfasst per Handykamera,
bedient von bis zu zehn Geräten gleichzeitig, offlinefähig, mit einer
autoritativen Datenquelle im Hintergrund.

## Stand

Die App ist vollständig: Kurzanleitung, Anmeldung mit Offline-Rückfall,
Einrichtung, Kameraerfassung, Zifferntastatur, Bestätigungsschritt,
Ausgangswarteschlange, Abgleich, Verlauf mit Rücknahme, die vollständige
Ticketliste mit Suche über Nummer und Name, und eine Übersicht mit
Bändchenabgleich. Backend: vier Endpunkte, vier Migrationen.

Vor dem Livegang steht die Checkliste in
[`docs/einrichtung.md`](docs/einrichtung.md) — Passwort ersetzen, echte Liste
importieren, Geräte zurücksetzen, Veröffentlichung sperren.

- [`docs/konzept.html`](docs/konzept.html) — vollständiges Konzept: Risikoanalyse
  zu Erfassungsfehlern, Kamerapipeline, Architektur, Datenmodell, Sync-Protokoll,
  Oberfläche, Betriebskonzept und Umsetzungsplan.
- [`docs/audit.html`](docs/audit.html) — Audit und Backlog über sechs
  Durchgänge.
- [`docs/einrichtung.md`](docs/einrichtung.md) — Backend aufsetzen, in acht
  Schritten, mit Testlauf und Checkliste vor dem Livegang.
- [`docs/ticketliste-pflegen.md`](docs/ticketliste-pflegen.md) — Namen
  nachtragen und Tickets ergänzen, im Browser, ohne Terminal.
- [`docs/kurzanleitung-vorschau.html`](docs/kurzanleitung-vorschau.html) — die
  fünf Bildschirme der Kurzanleitung als Vorschau, umschaltbar zwischen iPhone
  und Android.
- [`scripts/reset-redemptions.mjs`](scripts/reset-redemptions.mjs) — setzt
  Einlösungen nach der Generalprobe zurück, mit Rückfrage.
- [`scripts/export-log.mjs`](scripts/export-log.mjs) — führt Ticketstand und
  Protokoll als CSV aus.
- [`data/generate-tickets.mjs`](data/generate-tickets.mjs) — erzeugt eine
  Ticketliste im Importformat. Platzhalter, bis die echte Liste vorliegt.

## Eckdaten

| | |
|---|---|
| Tickets | 2 305 |
| Nummern | `00001`–`02305`, fünfstellig, fortlaufend, bereits gedruckt |
| Aufdruck | weißes Etikett, schwarze Groteske, zweimal je Ticket |
| Erfassung | Handykamera (Texterkennung) + Zifferntastatur |
| Geräte | bis 10 gleichzeitig |
| Einlösung | einmalig, Ticket gegen Bändchen |
| Plattform | Progressive Web App |
| Offline | vollständig funktionsfähig |
| Backend | Postgres, atomare Einlösung, Realtime-Push |

## Die zwei bestimmenden Punkte

**Dichte Nummern.** 2305 fortlaufende Codes füllen ihren Zahlenraum nahezu
lückenlos, und die Tickets tragen keinen Namen. Rund 64 % aller einstelligen
Erfassungsfehler treffen deshalb ein anderes gültiges Ticket, ohne dass die App
das erkennen könnte. Dagegen wirken: verpflichtender Bestätigungsschritt,
doppelte Lesung beider Etiketten, der abgerissene Kontrollabschnitt als
körperlicher Nachweis, sowie eine Rückverfolgung, die bei einem abgewiesenen
Ticket den wahrscheinlichen Fehlscan benennt.

**Kameraerfassung im Browser.** Die Nummern sitzen als schwarze Groteske auf
weißen Etiketten — nahezu der Idealfall für Texterkennung — und stehen zweimal
je Ticket, was eine kostenlose Redundanzprüfung erlaubt. Die verbleibende
Schwäche der Web-App, kein Zugriff auf das Telefonlicht, löst eine Lampe am
Eingang. Schritt 0 des Umsetzungsplans bestätigt das durch Messung an einem
echten Ticket.

## Zugang

Die App ist durch ein gemeinsames Eventpasswort gesperrt. Es wird **einmal je
Gerät und Festivaltag** abgefragt, beim ersten Öffnen am Morgen — beim Scannen
nie. Das Gerät erhält dafür ein Token, das bis zum Tageswechsel um 6 Uhr gilt;
die Grenze liegt bewusst dort und nicht 24 Stunden nach der Anmeldung, damit
sie keine Nachtschicht unterbricht.

Geprüft wird das Passwort **ausschließlich serverseitig** in der Edge Function
`session`. Ein Vergleich im Browser wäre wirkungslos: Das ausgelieferte Bundle
kann jeder lesen, ein Hashwert darin ebenso. Der Wert liegt als Secret beim
Backend und steht weder im Repo noch im Bundle — `.env.example` dokumentiert
nur die Variablennamen.

## Aufbau

```
supabase/migrations/  Schema, atomare Einlösung, Rücknahme
supabase/functions/   session · scans · changes · stats
scripts/              Import der Ticketliste mit Vorabprüfung
web/                  Progressive Web App (Vite, React, TypeScript)
data/                 Testliste und ihr Generator
docs/                 Konzept, Einrichtung, Migrationsregeln, Audit, Kurzanleitung
```

### App bauen

```
cd web && npm install && npm run build
```

Der Build holt die 18 MB der Texterkennung vorher aus `node_modules` nach
`public/tesseract/` (`npm run vendor:ocr`, läuft automatisch). Sie liegen
bewusst nicht im Repo, sind aber im fertigen Bundle enthalten — die App lädt
zur Laufzeit nichts von fremden Servern nach.

Für GitHub Pages liegt die App unter einem Unterpfad, der auch in
Service-Worker-Scope und Manifest landen muss:

```
VITE_BASE=/TicketScan/ npm run build
```

## Testdaten

```
node data/generate-tickets.mjs --from 1 --to 2305 > data/tickets.sample.csv
```

Erzeugt 2305 Zeilen im Importformat (`code,holder_name,category,note`) und
meldet die feste Vorsilbe der Nummern — hier `0`, weshalb die Tastatureingabe
mit vier statt fünf Stellen auskommt.

Die Namen darin sind erfunden und dienen der Vorführung; `--ohne-namen` lässt
sie weg. Etwa jedes neunte Ticket bleibt bewusst namenlos, damit der Fall in
der App auch tatsächlich vorkommt: Ein fehlender Name ist kein Verdachtsfall
und darf niemanden den Einlass kosten. Die Namen hängen allein an der Nummer,
zweimal erzeugt ergibt also dieselbe Datei. Folgenlos macht das einen zweiten
Import allerdings nicht: Der Trigger `tickets_touch` setzt `updated_at` bei
jedem UPDATE neu, auch wenn sich kein Wert ändert. Ein erneuter Import löst
deshalb trotzdem auf allen Geräten einen vollständigen Neuabgleich aus —
ungefährlich für die Einlösungen, aber nichts für die Einlasszeit.

## Einlösemodell

Das Ticket wird genau einmal gegen ein Bändchen getauscht, danach regelt das
Bändchen den Zutritt. Die App zählt also Einlösungen, keine Betretungen, und
beantwortet genau eine Frage: Hat diese Nummer schon ein Bändchen bekommen?

Praktische Folge: Ein Vorgang dauert wegen des Bändchens ohnehin fünfzehn bis
fünfundzwanzig Sekunden. Die Erfassung ist damit nie der Engpass, und der
verpflichtende Bestätigungsschritt kostet effektiv nichts.

## Offene Punkte

Keiner davon blockiert den Baubeginn.

1. Wird der Kontrollabschnitt abgerissen?
2. Ein echtes Ticket für den Spike zur Texterkennung
3. Gibt es eine Abendkasse, und aus welchem Nummernkreis?
4. Gibt es weitere Ticketarten neben dem Festival-Ticket?
5. Wie viele Eingänge, wie viele Geräte je Eingang?
