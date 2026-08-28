# Ticketliste pflegen — ohne Terminal, ohne Supabase-Zugang

Für alle, die Namen nachtragen, Tickets ergänzen oder einen Vermerk setzen
sollen. Es braucht nichts weiter als die App im Browser und ein Passwort.

## Der Zugang

Es gibt **zwei Passwörter**, beide gehen durch dasselbe Feld auf dem
Anmeldebildschirm:

| Passwort | Was es öffnet |
|---|---|
| das Eventpasswort | den Scanner — das kennen am Wochenende alle am Eingang |
| das **Verwaltungspasswort** | zusätzlich das Pflegen der Ticketliste |

Auf dem Anmeldebildschirm steht von der zweiten Möglichkeit nichts. Wer sie
braucht, weiß davon; am Eingang soll niemand danach suchen.

Gesetzt wird es einmalig vom Projektinhaber:

```bash
npx supabase secrets set TICKETSCAN_ADMIN_PASSWORD='<das-verwaltungspasswort>'
npx supabase functions deploy session     --no-verify-jwt --use-api
npx supabase functions deploy verwaltung  --no-verify-jwt --use-api
```

`--use-api` baut serverseitig. Ohne den Schalter braucht die CLI Docker und
wartet endlos ohne Meldung, wenn Docker Desktop nicht läuft.

Ist die Variable nicht gesetzt, gibt es die Verwaltung nicht — sie ist dann
nicht etwa offen, sondern abgeschaltet.

## So kommt man hin

1. App öffnen: <https://allawallabedalla.github.io/TicketScan/>
   — geht am Telefon wie am Laptop.
2. Beim ersten Bildschirm auf **Ticketliste pflegen** tippen (der andere Knopf
   ist für die Leute am Eingang).
3. Verwaltungspasswort eingeben, Gerätename beliebig, etwa „Laptop Büro“.

Danach öffnet sich die Verwaltung von selbst. Später kommt man auch über die
**Liste** dorthin — oben rechts steht dann *Bearbeiten*.

Wer sich mit dem Einlasspasswort anmeldet, sagt die App das direkt. Und ein
Gerät am Eingang bekommt den Knopf gar nicht erst zu sehen; der Server weist
es zusätzlich ab, falls es das doch versucht.

**Passwort wechseln:** Übersicht → ganz unten *Abmelden*, dann neu anmelden.

## Einzeln ändern

Der Reiter **Einzeln**. Das Feld oben ist ein Filter, kein Suchschlitz: Ohne
Eingabe steht die ganze Liste da, jede Ziffer und jeder Buchstabe engt sie
ein. Beim gesuchten Ticket auf *Ändern*. Zu ändern sind:

- **Name** — steht nach dem Scan groß unter der Nummer. Darf leer bleiben.
- **Kategorie** — „Festival-Ticket“, „Crew“, „Presse“ …
- **Vermerk** — erscheint am Eingang gelb hinterlegt.

*Speichern*, fertig. Die Telefone am Eingang haben die Änderung nach wenigen
Sekunden.

## Eine ganze Liste einfügen

Der Reiter **Liste einfügen**. Dafür ist der Bildschirm eigentlich da: Der
Organisator schickt eine Tabelle, und die kommt hier per Zwischenablage rein —
2305 Zeilen einzeln zu tippen macht niemand.

Eine Zeile je Ticket, Nummer zuerst, getrennt durch **Komma, Semikolon oder
Tabulator**:

```
00425, Anna Weber
00426; Ben Weber
00427	Clara Meier
00428, , Crew
00429
```

Dritte Spalte ist die Kategorie, vierte ein Vermerk — beide dürfen fehlen.
Eine Zeile nur mit Nummer legt ein Ticket ohne Namen an. Eine Kopfzeile
(`code,name`) wird übersprungen.

Aus Excel oder Numbers: die beiden Spalten markieren, kopieren, hier einfügen.
Die Spalten kommen als Tabulator an, das passt.

**Vor dem Übernehmen zeigt die App, was sie gelesen hat** — Anzahl der Zeilen,
wie viele davon einen Namen haben, und wie viele Stellen die Nummern haben.
Stehen dort zwei verschiedene Stellenzahlen, sind beim Export die führenden
Nullen verlorengegangen (`425` statt `00425`); dann ist der Knopf gesperrt.
Das ist der häufigste Fehler auf dem Weg über eine Tabellenkalkulation.

**Nicht während des Einlasses.** Eine Änderung an vielen Zeilen lässt jedes
Telefon den Bestand neu ziehen. Vormittags ja, Freitagabend nicht.

## Was hier absichtlich nicht geht

**Den Einlassstand ändern.** Weder setzen noch löschen — der Server nimmt das
Feld gar nicht entgegen.

- Wer eine Einlösung **löschen** könnte, würde ein benutztes Ticket wieder
  gültig machen. Die Person ist mit Bändchen drin, und das Ticket ließe
  jemand anderen erneut hinein.
- Wer eine **eintragen** könnte, würde einen Gast aussperren, der noch gar
  nicht da war.

Eine Einlösung nimmt man in der App unter **Verlauf → Zurücknehmen** zurück.
Das hinterlässt eine Spur im Protokoll; ein überschriebenes Feld nicht.

**Tickets löschen.** Eine Nummer, die auf einem Papierticket steht, aus der
Liste zu nehmen heißt, jemanden an der Tür abzuweisen. Das gehört nicht hinter
einen Knopf, den man versehentlich trifft — dafür bleibt der Weg über das
Supabase-Dashboard oder `scripts/import-tickets.mjs`.

## Nachsehen, was drin ist

Dieselbe App, unten **Liste**: alle Tickets, umschaltbar zwischen *Alle*,
*Offen* und *Eingelöst*, durchsuchbar nach Nummer und Name. Am Laptop
genauso wie am Telefon.
