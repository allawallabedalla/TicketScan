# TicketScan — digitale Einlasskontrolle für den Festivaleinlass

**Ein Satz:** TicketScan macht aus 2 305 Papiertickets mit dichten, namenlosen
Nummern eine zuverlässige Einlasskontrolle auf den privaten Handys der
Einlasskräfte — auch wenn das Netz am Eingang schwankt.

## Das Problem

- 2 305 Tickets tragen fünfstellige, fortlaufende Nummern (00001–02305) ohne
  Namen. Ein einziger Zahlendreher oder Lesefehler trifft dadurch fast immer
  ein anderes, echtes Ticket — nicht einfach eine ungültige Zahl. Nach eigener
  Rechnung landen rund 64 % aller einstelligen Erfassungsfehler auf einem
  gültigen Nachbarticket.
- Am Eingang gibt es kein eigenes WLAN, nur schwankenden Mobilfunk.
- Ohne gemeinsamen digitalen Stand kann niemand über mehrere Einlassstellen
  hinweg sehen, welches Ticket schon benutzt wurde — das Risiko: derselbe
  Gast kommt an zwei Geräten durch.

## Die Lösung

- Erfassung per Handykamera (Texterkennung, läuft vollständig im Browser,
  ohne Internetzugriff) oder über eine Zifferntastatur.
- Bis zu zehn private Handys gleichzeitig, iOS und Android gemischt, als
  Progressive Web App auf dem Home-Bildschirm — ohne App-Store-Vertrieb.
- Vollständig offlinefähig: Die Entscheidung „schon eingelöst?“ fällt sofort
  auf dem Gerät. Jede Einlösung geht sofort an eine zentrale Datenquelle,
  und alle Geräte gleichen sich zusätzlich alle acht Sekunden ab.
- Verpflichtender Bestätigungsschritt mit Nummer und Namen vor jedem Einlass,
  dazu Rücknahme, Suche und eine Übersicht mit Bändchenabgleich je Gerät.
- Listenpflege (Namen nachtragen, Tickets ergänzen, ein Ticket sperren)
  direkt in der App, ohne Terminal und ohne Zugang zur Datenbank.

## Warum das trägt

Offlinefähigkeit hält den Einlass am Laufen, wenn das Netz aussetzt: Die
Entscheidung passiert lokal, nichts wartet auf eine Antwort vom Server. Der
verpflichtende Bestätigungsschritt lässt die Einlasskraft jede erfasste
Nummer noch einmal gegen das Ticket in der Hand prüfen, bevor eingelassen
wird. Das Bändchen bleibt zusätzlich als zweiter, körperlicher Zähler
bestehen und wird je Gerät gegen die digitale Zahl abgeglichen. Jede
Ticketänderung und jeder Scan steht im Protokoll und lässt sich hinterher
nachvollziehen.

## Was es braucht

Läuft auf vorhandenen privaten Handys, ohne App-Store-Vertrieb und ohne
Anschaffung. Das Backend liegt bei Supabase und läuft derzeit im kostenlosen
Tarif. Ob dessen Kontingent für das Festivalwochenende reicht, wird vorher
geprüft (zehn Geräte erzeugen rund 4 500 Abrufe je Stunde); außerdem pausiert
der kostenlose Tarif nach einer Woche ohne Aktivität und muss vor dem
Festival wieder aktiv sein.

## Stand

Die App ist vollständig gebaut: Anmeldung, Kameraerfassung, Zifferntastatur,
Bestätigungsschritt, Verlauf mit Rücknahme, vollständige Ticketliste mit
Suche und eine Übersicht mit Bändchenabgleich. Sieben Audit-Durchgänge sind
gelaufen. Offen ist noch die Generalprobe mit echten Tickets an echten
Geräten.

## Nächster Schritt

Termin für die Generalprobe festlegen — der Testplan dafür liegt vor
([`docs/generalprobe.md`](generalprobe.md)). Danach: Geheimnisse wechseln und
die App für das Festival freigeben.
