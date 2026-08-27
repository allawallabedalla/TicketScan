# Ticketliste pflegen — ohne Terminal

Für alle, die Namen nachtragen, Tickets ergänzen oder einen Vermerk setzen
wollen, ohne sich mit Kommandozeile und Schlüsseln zu beschäftigen. Alles
passiert im Browser, im Supabase-Dashboard.

> **Vorher lesen:** Der Abschnitt „Was man nicht anfassen darf" weiter unten
> ist kein Kleingedrucktes. Eine falsch geleerte Spalte macht ein bereits
> benutztes Ticket wieder gültig.

## 1 · Zugang bekommen

Der Projektinhaber lädt ein:

**supabase.com/dashboard → oben links die Organisation → Team → Invite member**

E-Mail eintragen, Einladung verschicken. Der Eingeladene braucht ein
kostenloses Supabase-Konto und nimmt die Einladung per Mail an.

**Wichtig zu wissen:** Wer Zugang zum Dashboard hat, sieht dort auch die
geheimen Schlüssel und kann die Datenbank leeren. Eine Rolle „darf nur die
Ticketliste bearbeiten" gibt es in den kleinen Tarifen nicht. Also nur an
jemanden geben, dem man das Projekt insgesamt anvertraut.

## 2 · Die Tabelle öffnen

**Projekt → Table Editor (linke Leiste) → Tabelle `tickets`**

Das sieht aus wie eine Tabellenkalkulation und bedient sich auch so.

| Spalte | Was drinsteht | Bearbeiten? |
|---|---|---|
| `code` | die fünfstellige Nummer, z. B. `00425` | nur bei neuen Zeilen |
| `holder_name` | Name auf der Liste, darf leer sein | **ja** |
| `category` | „Festival-Ticket", „Crew", „Presse" … | **ja** |
| `note` | Vermerk, erscheint am Eingang gelb hinterlegt | **ja** |
| `redeemed_at` | wann eingelöst — leer heißt: noch nicht | **nein**, siehe unten |
| `redeemed_by_device` | welches Gerät | **nein** |
| `redeemed_scan_id` | welcher Vorgang | **nein** |
| `updated_at` | setzt die Datenbank selbst | **nein** |

**Eine Zelle ändern:** doppelklicken, tippen, Enter.

**Eine Zeile suchen:** oben auf *Filter* → `code` → `equals` → `00425`. Für
Namen `holder_name` → `ilike` → `%meier%`.

**Eine Zeile hinzufügen:** oben rechts *Insert* → *Insert row*. `code` und
`category` ausfüllen, der Rest darf leer bleiben. Die Nummer muss genau so
viele Stellen haben wie die anderen — `425` ist falsch, `00425` ist richtig.

**Eine Zeile löschen:** Zeile anhaken, *Delete row*. Nur bei Tickets, die noch
nicht eingelöst sind.

## 3 · Was am Eingang davon ankommt

Die Telefone gleichen alle acht Sekunden ab. Eine Änderung ist also nach
wenigen Sekunden auf allen Geräten — vorausgesetzt, sie haben Netz. Ohne Netz
sehen sie den Stand ihres letzten Abgleichs; das steht in der App auch so
unter der Liste.

Konkret:

- **Name geändert** → steht beim nächsten Scan unter der Nummer.
- **Ticket hinzugefügt** → wird von der Kamera erkannt, sobald die Geräte es
  gezogen haben (bis zu zehn Sekunden länger als der Abgleich).
- **Vermerk gesetzt** → erscheint im Bestätigungsschritt.

## 4 · Viele Zeilen auf einmal

Der Tabelleneditor ist für einzelne Änderungen gedacht. Für hundert Namen auf
einmal führt der Weg über den **SQL Editor** (linke Leiste). Dort einfügen,
anpassen, *Run*:

```sql
-- Einen Namen setzen
update tickets set holder_name = 'Anna Weber' where code = '00425';

-- Mehrere auf einmal
update tickets set holder_name = v.name
  from (values
    ('00425', 'Anna Weber'),
    ('00426', 'Ben Weber'),
    ('00427', 'Clara Meier')
  ) as v(code, name)
 where tickets.code = v.code;

-- Eine ganze Gruppe zur Crew erklären
update tickets set category = 'Crew' where code between '02200' and '02305';

-- Nachsehen, was drinsteht
select code, holder_name, category, note, redeemed_at
  from tickets where holder_name is not null order by code limit 50;
```

Vor jedem `update` lohnt sich derselbe Befehl als `select` — dann sieht man,
welche Zeilen betroffen wären, bevor man sie ändert.

**Nicht während des Einlasses.** Eine Änderung an allen 2305 Zeilen markiert
alle als geändert, und jedes Telefon zieht daraufhin den kompletten Bestand
neu. Das dauert und braucht Netz. Vormittags ja, Freitag um 19 Uhr nein.

## 5 · Was man nicht anfassen darf

**`redeemed_at` ist der Einlassstand, keine Notiz.**

- Wer den Wert einer Zeile **löscht**, macht ein Ticket wieder gültig. Die
  Person ist mit Bändchen drin, und das Ticket lässt jemand anderen erneut
  hinein.
- Wer einen Wert **einträgt**, sperrt einen Gast aus, der noch gar nicht da
  war. Er läuft am Eingang als „bereits eingelöst" auf.

Das Zurücknehmen einer Einlösung gehört in die App (*Verlauf → Zurücknehmen*)
oder in `scripts/reset-redemptions.mjs`. Beide hinterlassen eine Spur im
Protokoll; ein Klick im Tabelleneditor tut das nicht.

**Nicht in `scan_log` schreiben.** Das ist die Aufzeichnung, aus der sich
hinterher rekonstruieren lässt, wann welches Gerät was entschieden hat. Lesen
gern, ändern nie.

**Die Nummernstellen nicht ändern.** Die App leitet aus der Liste ab, wie
viele Stellen einzutippen sind und welche Vorsilbe feststeht. Kommt eine
vierstellige Nummer dazu, stimmt das für alle nicht mehr.

## 6 · Nachsehen, was passiert ist

Im SQL Editor:

```sql
-- Wer ist schon drin?
select code, holder_name, redeemed_at, redeemed_by_device
  from tickets where redeemed_at is not null order by redeemed_at desc;

-- Wie viele noch offen?
select count(*) filter (where redeemed_at is null) as offen,
       count(*) as gesamt
  from tickets;

-- Die letzten Vorgänge, auch die abgewiesenen
select server_ts, code, action, result, reason
  from scan_log order by server_ts desc limit 50;
```

Über *Download CSV* rechts über dem Ergebnis lässt sich alles mitnehmen.

Dasselbe sieht man auch in der App selbst — im Laptop-Browser öffnen, anmelden,
unten *Liste* und *Übersicht*. Dafür braucht es keinen Dashboard-Zugang,
sondern nur das Eventpasswort.
