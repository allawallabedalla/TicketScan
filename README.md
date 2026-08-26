# TicketScan

Einlasskontrolle für das Festival: 2305 Papiertickets mit fünfstelligen,
fortlaufenden Nummern auf aufgeklebten Etiketten, erfasst per Handykamera,
bedient von bis zu zehn Geräten gleichzeitig, offlinefähig, mit einer
autoritativen Datenquelle im Hintergrund.

## Stand

Detailkonzept liegt vor, Implementierung noch nicht begonnen.

- [`docs/konzept.html`](docs/konzept.html) — vollständiges Konzept: Risikoanalyse
  zu Erfassungsfehlern, Kamerapipeline, Architektur, Datenmodell, Sync-Protokoll,
  Oberfläche, Betriebskonzept und Umsetzungsplan.
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

## Testdaten

```
node data/generate-tickets.mjs --from 1 --to 2305 > data/tickets.sample.csv
```

Erzeugt 2305 Zeilen im Importformat (`code,holder_name,category,note`) und
meldet die feste Vorsilbe der Nummern — hier `0`, weshalb die Tastatureingabe
mit vier statt fünf Stellen auskommt.

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
