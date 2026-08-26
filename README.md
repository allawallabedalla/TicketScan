# TicketScan

Einlasskontrolle für Festivals: rund 2000 Papiertickets mit festen Zahlencodes,
bedient von bis zu zehn Geräten gleichzeitig, offlinefähig, mit einer
autoritativen Datenquelle im Hintergrund.

## Stand

Detailkonzept liegt vor, Implementierung noch nicht begonnen.

- [`docs/konzept.html`](docs/konzept.html) — vollständiges Konzept: Risikoanalyse
  zu Fehleingaben, Architektur, Datenmodell, Sync-Protokoll, Oberfläche,
  Betriebskonzept und Umsetzungsplan.

## Eckdaten

| | |
|---|---|
| Tickets | ~2 000 |
| Geräte | bis 10 gleichzeitig |
| Plattform | Progressive Web App (iOS/Android) |
| Codes | numerisch, bereits gedruckt, keine Prüfziffer |
| Offline | vollständig funktionsfähig |
| Backend | Postgres, atomare Einlösung, Realtime-Push |

## Offene Punkte vor Implementierungsbeginn

1. Konkretes Codeformat (fortlaufend oder gestreut, Stellenzahl)
2. Sind die Tickets personalisiert?
3. Gibt es Wiedereinlass?
4. Gibt es eine Abendkasse?
