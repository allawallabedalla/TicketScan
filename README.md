# TicketScan

Einlasskontrolle für Festivals: rund 2000 Papiertickets mit fünfstelligen,
fortlaufenden Zahlencodes, erfasst per Handykamera, bedient von bis zu zehn
Geräten gleichzeitig, offlinefähig, mit einer autoritativen Datenquelle im
Hintergrund.

## Stand

Detailkonzept liegt vor, Implementierung noch nicht begonnen.

- [`docs/konzept.html`](docs/konzept.html) — vollständiges Konzept: Risikoanalyse
  zu Erfassungsfehlern, Kamerapipeline, Architektur, Datenmodell, Sync-Protokoll,
  Oberfläche, Betriebskonzept und Umsetzungsplan.

## Eckdaten

| | |
|---|---|
| Tickets | ~2 000 |
| Codes | 5-stellig, fortlaufend, bereits gedruckt, keine Prüfziffer |
| Erfassung | Handykamera (Texterkennung) + Zifferntastatur |
| Geräte | bis 10 gleichzeitig |
| Plattform | Progressive Web App — bestätigungsbedürftig, siehe unten |
| Offline | vollständig funktionsfähig |
| Backend | Postgres, atomare Einlösung, Realtime-Push |

## Die zwei kritischen Punkte

**Dichte Nummern.** 2000 fortlaufende Codes füllen ihren Zahlenraum nahezu
lückenlos. Rund 62 % aller einstelligen Erfassungsfehler treffen deshalb ein
anderes gültiges Ticket, ohne dass die App das erkennen könnte. Gegenmaßnahmen:
verpflichtender Bestätigungsschritt, Namensabgleich, Rückgängig-Funktion und
eine Rückverfolgung, die bei einem abgewiesenen Ticket den wahrscheinlichen
Fehlscan benennt.

**Kameraerfassung im Browser.** Die Tickets tragen Klartextzahlen, keine
Barcodes — es braucht also Texterkennung. Safari gibt einer Web-App weder
Zugriff auf Apples System-Erkennung noch auf das Licht des Telefons, was
abends am Einlass wiegt. Schritt 0 des Umsetzungsplans ist deshalb ein Spike,
der Trefferquote und Zeit je Ticket gegen echte Tickets misst und die
Plattformfrage entscheidet.

## Offene Punkte vor Implementierungsbeginn

1. Genauer Nummernbereich (erste und letzte Nummer)
2. **Fotos echter Tickets** — Grundlage für den Spike zur Texterkennung
3. Sind die Tickets personalisiert?
4. Gibt es Wiedereinlass?
5. Gibt es eine Abendkasse?
