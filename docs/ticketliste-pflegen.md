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

Gesetzt wird es einmalig vom Projektinhaber. Nicht als Klartext in den Befehl
schreiben — sonst steht das Passwort danach in der Shell-History:

```bash
read -rs PW
npx supabase secrets set TICKETSCAN_ADMIN_PASSWORD="$PW"
unset PW

npx supabase functions deploy session     --no-verify-jwt --use-api
npx supabase functions deploy verwaltung  --no-verify-jwt --use-api
```

Ohne Terminal geht das Setzen des Passworts auch im Dashboard unter *Project
Settings → Edge Functions → Secrets* — dort steht es ohnehin nur verdeckt.
Das Ausrollen der beiden Funktionen selbst braucht dann noch die CLI, oder
den Ablauf „Backend veröffentlichen“ aus docs/einrichtung.md.

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

Eine Zeile je Ticket, Nummer zuerst. Getrennt wird **an einem einzigen
Trennzeichen für die ganze Liste** — die App erkennt es selbst: zuerst wird
nach Tabulator gesucht (der Normalfall beim Einfügen aus Excel oder Numbers),
sonst nach Semikolon, sonst nach Komma. Eine Liste mischt also nicht mehrere
Trennzeichen durcheinander:

```
00425	Anna Weber
00426	Ben Weber
00427	"Müller, Hans"
00428		Crew
00429
```

Ein Name wie `Müller, Hans` in Anführungszeichen bleibt dabei ein Name und
reißt die Zeile nicht auseinander — genau wie beim CSV-Import.

Dritte Spalte ist die Kategorie, vierte ein Vermerk — beide dürfen fehlen.
Eine Zeile nur mit Nummer legt ein Ticket ohne Namen an. Eine Kopfzeile
(`code,name`) wird übersprungen.

**Eine leere Spalte überschreibt nichts.** In Zeile `00428` oben ist der Name
leer — das ändert einen vorher eingetragenen Namen bei `00428` nicht, es lässt
ihn stehen. Nur die Kategorie wird auf `Crew` gesetzt. Wer einen Namen
tatsächlich löschen will, macht das einzeln über **Ändern** (Abschnitt
„Einzeln ändern") — dort lässt sich das Feld gezielt leeren.

Aus Excel oder Numbers: die Spalten markieren, kopieren, hier einfügen. Die
Spalten kommen als Tabulator an, das passt.

**Vor dem Übernehmen zeigt die App, was sich ändern würde** — wie viele
Zeilen neu sind, wie viele sich ändern und wie viele unverändert bleiben,
dazu die Namensänderungen einzeln als alt → neu. Das ist ein echter
Probelauf gegen den Bestand, keine reine Textprüfung mehr: Stehen dort zwei
verschiedene Stellenzahlen, sind beim Export die führenden Nullen
verlorengegangen (`425` statt `00425`); das ist der häufigste Fehler auf dem
Weg über eine Tabellenkalkulation.

**Neue Nummern müssen ausdrücklich freigegeben werden.** Enthält die Liste
Nummern, die es im Bestand noch nicht gibt, zeigt die App das gesondert an —
übernommen werden sie erst nach einer zusätzlichen Bestätigung. Das fängt
den Fall ab, dass eine vertauschte Spalte oder ein falscher Nummernbereich
sonst stillschweigend hunderte neue Tickets anlegen würde.

**Jede tatsächliche Änderung steht im Änderungsprotokoll** (Tabelle
`ticket_changes`) — wer wann welches Feld bei welcher Nummer geändert hat.
Ansehen geht im SQL-Editor:

```sql
select * from ticket_changes order by at desc limit 50;
```

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
einen Knopf, den man versehentlich trifft — weder hier noch in
`scripts/import-tickets.mjs`: Der Importer kann nur anlegen und ändern, nie
löschen. Löschen geht ausschließlich über das Supabase-Dashboard.

## Nachsehen, was drin ist

Dieselbe App, unten **Liste**: alle Tickets, umschaltbar zwischen *Alle*,
*Offen* und *Eingelöst*, durchsuchbar nach Nummer und Name. Am Laptop
genauso wie am Telefon.
