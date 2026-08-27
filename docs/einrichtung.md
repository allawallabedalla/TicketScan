# Einrichtung

Einmalig, etwa zwanzig Minuten. Am Ende sagt dir ein Testlauf, ob die ganze
Kette steht.

Was du brauchst: ein Supabase-Konto und Node auf dem Rechner.

---

## 1 · Projekt anlegen

Auf [supabase.com](https://supabase.com) ein neues Projekt anlegen.

- **Region: `Central EU (Frankfurt)`** — kürzeste Wege und die Daten bleiben in
  der EU. Falls die Ticketliste doch Namen enthält, ist das kein Nebenaspekt.
- Das Datenbank-Passwort, das dabei vergeben wird, gut aufheben. Du brauchst es
  gleich einmal und danach selten.

Aus der Projekt-URL brauchst du die Kennung — bei
`https://abcdefgh.supabase.co` ist das `abcdefgh`.

```bash
export REF=abcdefgh          # eure Projektkennung
```

## 2 · CLI anmelden

Alles ab hier — Geheimnisse, Endpunkte, Import, Testlauf — setzt eine
angemeldete und verknüpfte CLI voraus. Das steht sonst nur im Nebensatz eines
Zweigs, den man überspringt, wenn die GitHub-Verknüpfung läuft.

```bash
export REF=<projekt-ref>          # der Teil vor .supabase.co
npx supabase login
npx supabase link --project-ref $REF
```

## 3 · Schema einspielen

Ist die GitHub-Verknüpfung eingerichtet (*Project Settings → Integrations*),
spielt Supabase die Migrationen bei jedem Push auf den Produktionszweig selbst
ein — dann ist hier nichts zu tun außer nachzusehen, ob es geklappt hat.

Ohne Verknüpfung, oder um nachzuhelfen:

```bash
npx supabase db push
```

Was tatsächlich in der Datenbank steht, verrät der SQL-Editor:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

Es müssen **alle** Dateien aus `supabase/migrations/` dastehen — derzeit
`0001_init`, `0002_harden`, `0003_funktionen`, `0004_ruecknahme`. Vergleiche
mit `ls supabase/migrations/`, statt eine Zahl aus diesem Text abzuhaken; sonst
veraltet der Satz beim nächsten Mal wieder.

Was fehlt, wenn eine fehlt:

| Migration | Fehlt sie, dann … |
|---|---|
| `0002_harden` | ist die Sicht `offline_windows` über die Data API lesbar |
| `0003_funktionen` | fehlt `scan_log.offline`; **jeder Scan schlägt fehl**, und die Rücknahme ist nicht lauffähig |
| `0004_ruecknahme` | ist die Rücknahme nicht idempotent — eine doppelt zugestellte Rücknahme kann eine fremde, gültige Einlösung zunichtemachen |

## 4 · Geheimnisse setzen

```bash
npx supabase secrets set \
  TICKETSCAN_EVENT_PASSWORD='<euer-eventpasswort>' \
  TICKETSCAN_TOKEN_SECRET="$(openssl rand -base64 48)" \
  TICKETSCAN_TIMEZONE='Europe/Berlin' \
  TICKETSCAN_ALLOWED_ORIGIN='https://<eure-app-adresse>'
```

> **Diese Anleitung hat sich selbst widersprochen.** An beiden Stellen oben
> stand bis zum 27.08. das echte Passwort im Klartext — in einem öffentlichen
> Repository, samt der Adresse der Endpunkte in `web/.env.production`. Damit
> konnte jeder Leser ein Gerätetoken lösen und über `/scans` alle Tickets
> einlösen oder freigeben. Das Passwort ist hier entfernt, aber es steht
> weiterhin in der Git-Historie (`git log -S`). Es muss als verbrannt gelten:
> **vor dem Festival ein neues setzen**, dazu ein neues
> `TICKETSCAN_TOKEN_SECRET` (das meldet alle ausgegebenen Token ab), und
> anschließend `session_log` auf fremde Anmeldungen sowie `tickets` auf
> unerwartete Einlösungen prüfen.

- **Das Eventpasswort steht nirgends im Repo** und darf da auch nie hinein. Es
  lebt ausschließlich hier.
- `TICKETSCAN_TOKEN_SECRET` wird zufällig erzeugt. Ein Wechsel meldet alle
  Geräte ab — genau das will man, wenn ein Telefon verschwindet.
- **`TICKETSCAN_TIMEZONE` nicht weglassen.** Ohne die Angabe läge der
  Tageswechsel im Sommer auf 8 Uhr deutscher Zeit statt auf 6.
- `TICKETSCAN_ALLOWED_ORIGIN` kannst du zunächst leer lassen und nachtragen,
  sobald die App eine feste Adresse hat.

## 5 · Endpunkte veröffentlichen

Es sind **vier** — plus `verwaltung`, wenn jemand die Ticketliste pflegen
soll, ohne Zugang zum Dashboard zu bekommen (siehe „Ticketliste pflegen“). `stats` fehlte hier lange, und das fällt nicht auf: Die
Übersicht meldet dann „Kennzahlen brauchen Netz", obwohl der Endpunkt nur nie
veröffentlicht wurde — samt Bändchenabgleich, also dem zweiten, körperlichen
Zähler. Der Testlauf prüft es inzwischen mit.

```bash
npx supabase functions deploy session --no-verify-jwt
npx supabase functions deploy scans   --no-verify-jwt
npx supabase functions deploy changes --no-verify-jwt
npx supabase functions deploy stats   --no-verify-jwt

# Nur wenn jemand ohne Dashboard-Zugang die Liste pflegen soll:
npx supabase functions deploy verwaltung --no-verify-jwt
```

`--no-verify-jwt` ist hier richtig und kein Sicherheitsloch: Die Endpunkte
prüfen selbst — `session` das Eventpasswort, `scans` und `changes` das
Gerätetoken. Ohne den Schalter würde Supabase zusätzlich einen eigenen JWT
verlangen, den unsere Geräte gar nicht haben; das Ergebnis wäre ein 401, dessen
Ursache man lange sucht.

## 6 · Ticketliste importieren

Bis die echte Liste da ist, geht es mit der erzeugten Testliste.

```bash
export SUPABASE_URL="https://$REF.supabase.co"

node scripts/import-tickets.mjs data/tickets.sample.csv            # nur prüfen
node scripts/import-tickets.mjs data/tickets.sample.csv --commit   # schreiben
```

**Kein Schlüssel nötig.** Weil die CLI aus Schritt 3 angemeldet ist, holt sich
das Skript den geheimen Schlüssel selbst. Das ist Absicht: Das Dashboard zeigt
Schlüssel maskiert an, und wer den angezeigten Text markiert, kopiert
Aufzählungspunkte statt des Schlüssels — die fehleranfälligste Stelle der
ganzen Einrichtung.

Wer ihn doch von Hand setzen will, kann `SUPABASE_SERVICE_ROLE_KEY` angeben;
dann bitte über den Kopier-Knopf im Dashboard, nicht durch Markieren.

Der Importer prüft erst und schreibt nur mit `--commit`. Er bricht ab bei
Dubletten, uneinheitlicher Stellenzahl und verschobenen Spalten.

> **Zur echten Liste:** Excel entfernt führende Nullen — aus `00245` wird `245`.
> Am besten direkt aus dem Vorverkaufssystem exportieren und die Datei nicht in
> Excel öffnen. Der Importer erkennt es und bricht ab, aber gar nicht erst
> passieren zu lassen ist besser.

## 7 · Testlauf

```bash
export TICKETSCAN_API="https://$REF.supabase.co/functions/v1"
export TICKETSCAN_EVENT_PASSWORD='<euer-eventpasswort>'
export TICKETSCAN_ERWARTE=2305      # Sollzahl der Tickets
node scripts/smoke-test.mjs
```

Am Ende steht eine von drei Meldungen:

- **„Alles steht."** — alle Prüfungen gelaufen und grün, Rückgabewert 0.
- **„Alles Geprüfte steht — aber N Prüfungen liefen nicht."** — Rückgabewert 2.
  Das ist **kein** grünes Licht: Ohne öffentlichen Schlüssel entfallen genau
  die drei Prüfungen, die belegen, dass Ticketliste und Protokoll nicht
  öffentlich abfragbar sind.
- **„N von M Prüfungen fehlgeschlagen."** — Rückgabewert 1.

Zwei Dinge, an denen sich dieser Testlauf schon zweimal selbst getäuscht hat:

- **Ein `401` bei den drei Sichtbarkeitsprüfungen ist kein Erfolg.** Es kommt
  vom Gateway und bedeutet einen ungültigen öffentlichen Schlüssel — es sähe
  nur aus wie Sicherheit. Erfolg heißt hier `Rechte entzogen (42501)` oder
  `durchgelassen, aber leer`.
- **`TICKETSCAN_ERWARTE` setzen.** Ohne die Sollzahl prüft der Lauf nur auf
  „nicht leer". Ein bei Zeile 1500 abgebrochener Import meldet dann grün, und
  805 Gäste laufen am Eingang als unbekannt auf.

Der Lauf **bucht tatsächlich**: Er löst die höchste Nummer ein, prüft
Doppelerkennung, Idempotenz und Rücknahme und gibt sie am Ende wieder frei.
Bricht er dazwischen ab, sagt die letzte Zeile, welche Nummer von Hand
freizugeben ist.

Der Testlauf löst ein einzelnes freies Ticket ein und nimmt es am Ende wieder
zurück — der Bestand bleibt damit unverändert. Diese Runde ist der eigentliche
Zweck: Sie führt die Datenbankfunktionen tatsächlich aus, statt ihre Existenz
anzunehmen. Die Rücknahme war einmal nicht lauffähig, und das wäre nur hier
aufgefallen. Führ ihn ruhig noch einmal am
Vorabend des Festivals aus.

## 8 · App veröffentlichen

Die Adresse der Endpunkte steht bereits in `web/.env.production` — beim Bauen
ist nichts mehr zu setzen.

**Einmalig:** Repo → *Settings* → *Pages* → **Source: GitHub Actions**.

Danach baut und veröffentlicht `.github/workflows/deploy.yml` bei jedem Push,
der `web/` berührt. Von Hand auslösen geht über *Actions* → *App
veröffentlichen* → *Run workflow*. Die App liegt anschließend unter
`https://allawallabedalla.github.io/TicketScan/`.

Der Ablauf prüft dabei, dass alle Dateien der Texterkennung im Bundle liegen —
auch alle sechs Kern-Varianten. Welche davon ein Browser anfordert, entscheidet
sich erst auf dem Gerät; fehlt genau diese, bricht die Erkennung dort mit einem
404 ab. Lieber im Ablauf scheitern als am Eingang.

Lokal bauen geht weiterhin:

```bash
cd web && npm install && npm run build
```

---

## Was wohin gehört

| Wert | Wo er hingehört | Darf ins Repo |
|---|---|---|
| Eventpasswort | Supabase-Secret | **nein** |
| `TICKETSCAN_TOKEN_SECRET` | Supabase-Secret | **nein** |
| `sb_secret_...` / `service_role` | nur lokal beim Import | **nein** |
| `sb_publishable_...` / `anon` | darf überall stehen | unkritisch |
| Datenbank-Passwort | Passwortverwaltung | **nein** |
| Echte Ticketliste | direkt in die Datenbank | **nein** |
| `VITE_API_URL` | Build-Umgebung | unkritisch, steht ohnehin im Bundle |

Das Repo ist öffentlich. `.gitignore` hält `.env` und `data/tickets.csv`
draußen, aber die Regel oben ist die eigentliche Absicherung.

---

## Wenn die GitHub-Verknüpfung aktiv ist

Bequem, aber mit einer Folge, die man kennen muss: **Jeder Push auf den
Produktionszweig spielt Migrationen in die Produktionsdatenbank ein.**

- Solange nichts Echtes drinsteht, ist das genau richtig — eine Handbewegung
  weniger.
- **Vor dem Festival muss das aus.** Entweder die Verknüpfung trennen oder den
  Produktionszweig auf einen Zweig zeigen lassen, auf den niemand pusht. Sonst
  ändert ein beiläufiger Commit am Freitagabend das Schema unter laufendem
  Einlass.

Das ist dieselbe Regel wie der Deploy-Stopp für die App: Was am Donnerstag
läuft, läuft bis Sonntag unverändert.

## Veröffentlichung sperren

Ab dem Vortag darf kein neuer Stand mehr auf die Geräte. Ein fehlerhafter Build
verteilt sich über den Service Worker sonst auf alle zehn gleichzeitig.

```bash
echo "Gesperrt bis nach dem Festival — Stand vom Donnerstag" > DEPLOY-GESPERRT
git add DEPLOY-GESPERRT && git commit -m "Veröffentlichung sperren" && git push
```

Der Ablauf bricht dann mit einer klaren Meldung ab. Aufheben: Datei löschen und
pushen — `DEPLOY-GESPERRT` steht in den `paths` des Ablaufs, der Lauf startet
also von selbst. (Stünde sie dort nicht, löste das Löschen gar nichts aus und
man wartete auf eine Veröffentlichung, die nie kommt.)

Dieselbe Regel gilt für die GitHub-Verknüpfung von Supabase, die sonst
Schemaänderungen einspielt.

## Wenn eine kaputte Fassung draußen ist

Die Geräte ziehen neue Fassungen von selbst (`registerType: "autoUpdate"`).
Das gilt auch für den Rückweg:

```bash
git revert <commit> && git push          # zurück auf den letzten guten Stand
```

Liegt `DEPLOY-GESPERRT` schon, muss sie im selben Push kurz weg und danach
wieder hin. Die ausgelieferte Fassung steht unten auf dem Einrichtungs-
bildschirm und in jeder Rückmeldung — daran lässt sich ablesen, ob ein Gerät
den neuen Stand hat. Zieht eines nicht nach: App schließen und neu öffnen.

## Testgeräte aufräumen

Ältere Testläufe haben je Lauf vier Geräte namens „Smoke-Test" angelegt (seit
dieser Fassung nur noch eines, wiederverwendet). In der Übersicht stehen sie
ganz oben — genau dort, wo ein unerwartetes elftes Gerät auffallen soll. Vor
dem Festival einmal aufräumen, im SQL-Editor:

```sql
delete from session_log
 where device_id in (select device_id from devices where label = 'Smoke-Test');
delete from wristband_counts
 where device_id in (select device_id from devices where label = 'Smoke-Test');
delete from devices where label = 'Smoke-Test';
```

Das Scan-Protokoll bleibt unangetastet — es hat keinen Fremdschlüssel auf
`devices`, die Vorgänge der Testläufe bleiben also nachvollziehbar.

## Ein Gerät sperren

Telefon verloren oder liegengeblieben. Im SQL-Editor:

```sql
-- Kennung aus der Übersicht ablesen, oder über den Namen:
update devices set revoked_at = now() where label = 'Nordeingang 2';
```

Ab dem nächsten Aufruf bekommt es 403 — bei Einlösen, Abgleich **und**
Übersicht. Eine Neuanmeldung mit derselben Kennung wird ebenfalls abgewiesen;
das Gerät kann sich also nicht einfach neu anmelden.

Wer ganz sichergehen will, wechselt zusätzlich `TICKETSCAN_TOKEN_SECRET` — das
meldet **alle** Geräte sofort ab und macht eine Neuanmeldung aller zehn nötig.
Mitten im Einlass ist das die teurere Maßnahme.

## Passwort wechseln

```bash
npx supabase secrets set TICKETSCAN_EVENT_PASSWORD='<neues-passwort>'
```

Zwei Dinge, die dabei nicht offensichtlich sind:

- **Bereits ausgegebene Tokens laufen weiter.** Sie tragen das Passwort nicht
  in sich, nur eine Signatur und eine Frist. Der Wechsel wirkt also erst zur
  nächsten Anmeldung, spätestens um 06:00.
- **Der Offline-Rückfall akzeptiert weiter das alte Passwort.** Ein Gerät, das
  seit dem Wechsel kein Netz hatte, prüft gegen den Hash der letzten
  erfolgreichen Anmeldung. Bei einem verlorenen Gerät zählt deshalb die Sperre
  oben, nicht der Passwortwechsel.

## Nach der Generalprobe

Der Bestand steht danach voller Testeinlösungen. Zurücksetzen, ohne die
Ticketliste anzurühren:

**Vorher sichern.** Das Protokoll ist die einzige Aufzeichnung, aus der sich
eine versehentlich gelöschte Einlösung rekonstruieren lässt:

```bash
export SUPABASE_URL="https://$REF.supabase.co"
node scripts/export-log.mjs --protokoll > protokoll-vor-reset.csv
```

```bash
node scripts/reset-redemptions.mjs                       # nur zeigen
node scripts/reset-redemptions.mjs --commit              # ausführen
node scripts/reset-redemptions.mjs --commit --auch-protokoll
```

Ausgeführt wird erst nach einer Rückfrage, die man nicht versehentlich
wegtippt — das Skript löscht die Arbeit eines ganzen Abends, wenn man sich im
Zeitpunkt irrt. Die Geräte ziehen den Stand beim nächsten Abgleich nach.

> **Nach dem Wechsel von der Test- auf die echte Liste müssen die Geräte
> zurückgesetzt werden.** Der Abgleich holt nur neue und geänderte Zeilen; er
> **löscht nie**. Deckt die echte Liste einen anderen Nummernbereich ab,
> bleiben die überzähligen Testnummern auf allen zehn Telefonen gültig — und
> die Entscheidung fällt lokal. Auf jedem Gerät: App vom Home-Bildschirm
> löschen und neu installieren, dann neu einrichten. „Neu einrichten" in der
> App genügt dafür **nicht**.

Ein zweiter Import derselben Datei ist dagegen ungefährlich: Er schreibt nur
Stammdaten und rührt `redeemed_at` nicht an. Er markiert aber alle Zeilen als
geändert und löst damit auf allen Geräten einen vollständigen Neuabgleich aus
— also nicht während des Einlasses.

## Ticketliste pflegen — in der App

Namen nachtragen, Tickets ergänzen, Vermerke setzen: Das geht in der App
selbst, ohne Terminal und **ohne Zugang zum Supabase-Dashboard**. Wer das
übernehmen soll, bekommt nur ein Passwort.

```bash
npx supabase secrets set TICKETSCAN_ADMIN_PASSWORD='<das-verwaltungspasswort>'
npx supabase functions deploy session     --no-verify-jwt
npx supabase functions deploy verwaltung  --no-verify-jwt
```

Dieses Passwort geht durch dasselbe Feld wie das Eventpasswort. Wer es
eingibt, findet unter *Übersicht* zusätzlich den Abschnitt **Ticketliste
pflegen** — einzelne Änderungen und ein Feld, in das sich eine ganze Liste
einfügen lässt. Wer sich mit dem Eventpasswort anmeldet, sieht davon nichts,
und der Server weist ihn ab, falls er es doch versucht.

Der Einlassstand lässt sich dort nicht ändern und Tickets nicht löschen — der
Endpunkt nimmt beides gar nicht entgegen.

Anleitung zum Weitergeben: [`docs/ticketliste-pflegen.md`](ticketliste-pflegen.md).

Ist `TICKETSCAN_ADMIN_PASSWORD` nicht gesetzt, ist die Verwaltung
abgeschaltet — nicht offen.

## Listen am Laptop ansehen

Drei Wege, je nachdem, was gebraucht wird.

**Währenddessen, ohne Werkzeug:** Die App im Laptop-Browser öffnen
(<https://allawallabedalla.github.io/TicketScan/>), mit demselben Passwort
anmelden. Unten steht *Liste* — dort stehen alle 2305 Tickets, umschaltbar
zwischen *Alle*, *Offen* und *Eingelöst*, durchsuchbar nach Nummer und Name.
Über die Statuszeile darüber öffnet sich die *Übersicht* mit den Kennzahlen:
Anzahl eingelöst, Geräte, Konflikte, Bändchenabgleich. Ein Laptop zählt dabei
als weiteres Gerät; scannen muss er nicht.

Dieselbe Liste hat auch jedes Telefon am Eingang — sie zeigt den Stand des
letzten Abgleichs, also auch dann etwas, wenn gerade kein Netz da ist.

**Als Tabelle, zum Weiterverarbeiten:**

```bash
export SUPABASE_URL=https://<projekt>.supabase.co
npx supabase login                                    # einmalig

node scripts/export-log.mjs --eingeloest > drin.csv   # nur die Eingelösten,
                                                      # in Einlassreihenfolge
node scripts/export-log.mjs             > einlass.csv # alle 2305 mit Stand
node scripts/export-log.mjs --protokoll > protokoll.csv
```

`drin.csv` und `einlass.csv` führen Nummer, Name, Kategorie, Vermerk,
Einlösezeitpunkt und Gerät. `protokoll.csv` enthält jeden einzelnen Vorgang —
auch die abgewiesenen, die zurückgenommenen und die ohne Abgleich
entstandenen. Alle drei blättern über die 1000-Zeilen-Grenze der Data API
hinweg, es fehlt also nichts.

**Ohne Terminal:** Im Supabase-Dashboard *SQL Editor* öffnen und abfragen,
etwa:

```sql
select code, holder_name, redeemed_at, redeemed_by_device
from tickets
where redeemed_at is not null
order by redeemed_at;
```

Über *Download CSV* rechts über dem Ergebnis lässt sich das Ergebnis
mitnehmen. Wer nur nachsehen will, kommt hiermit am schnellsten ans Ziel.

## Nach dem Festival

Die Ausgaben oben sind auch die Abrechnungsgrundlage. `protokoll.csv`
aufbewahren: Es ist die einzige Aufzeichnung, aus der sich hinterher noch
rekonstruieren lässt, wann welches Gerät was entschieden hat.

## Die App selbst prüfen

`scripts/smoke-test.mjs` prüft das Backend. Für die App gibt es einen zweiten
Durchlauf, der sie im Browser tatsächlich bedient — Anmeldung, Einlösen,
Doppelscan, Liste, Rücknahme, Betrieb ohne Netz:

```bash
cd scripts/e2e && npm install
( cd ../../web && VITE_API_URL=http://127.0.0.1:8123/api VITE_BASE=/ \
    npx vite build --outDir ../scripts/e2e/dist --emptyOutDir )
node server.mjs dist 8123 &
node run.mjs
```

Erwartet werden 21 Zeilen `ok`. Das Verzeichnis hat ein eigenes README mit den
Einzelheiten und den Grenzen (die Kamera lässt sich damit nicht prüfen).

## Checkliste vor dem Livegang

Der Reihe nach. Jeder Punkt hat oben einen Abschnitt.

- [ ] **Alle vier Endpunkte ausgerollt** — `session`, `scans`, `changes`,
      `stats`. Der letzte wurde am häufigsten vergessen (Abschnitt 5).
- [ ] **Alle Migrationen eingespielt**, `0001` bis `0004` (Abschnitt 3).
- [ ] **Eventpasswort ersetzt.** Das alte stand im Klartext in diesem Dokument
      und ist damit öffentlich gewesen — es gilt als verbrannt (Abschnitt 4).
- [ ] **`TICKETSCAN_TOKEN_SECRET` neu gewürfelt**, aus demselben Grund.
- [ ] **`TICKETSCAN_ALLOWED_ORIGIN` gesetzt** auf die Adresse der App. Ohne den
      Wert antworten die Endpunkte jeder Herkunft (Abschnitt 4).
- [ ] **Service-Role-Schlüssel rotiert**, falls er je in einem Chat, einer
      Mail oder einem Terminalprotokoll stand.
- [ ] **Echte Ticketliste importiert** und der Testlauf mit
      `TICKETSCAN_ERWARTE=<anzahl>` grün (Abschnitte 6 und 7).
- [ ] **Alle Geräte zurückgesetzt und neu eingerichtet**, wenn vorher mit der
      Testliste gearbeitet wurde (Abschnitt „Nach der Generalprobe").
- [ ] **Durchlauf `scripts/e2e` grün**, 24 von 24.
- [ ] **Testgeräte aufgeräumt** (Abschnitt „Testgeräte aufräumen").
- [ ] **Generalprobe** mit echten Tickets an echten Geräten, im Dunkeln.
- [ ] **Bändchenstand einmal eingetragen**, damit die Gegenrechnung von Beginn
      an eine Grundlage hat.
- [ ] **Papier-Rückfallebene gedruckt**: die Nummernliste zum Abhaken, falls
      alles ausfällt. `node scripts/export-log.mjs > einlass.csv`
- [ ] **Protokoll gesichert** (`--protokoll`), bevor irgendetwas zurückgesetzt
      wird.
- [ ] **Supabase-GitHub-Verknüpfung getrennt** (Abschnitt „Wenn die
      GitHub-Verknüpfung aktiv ist").
- [ ] **`DEPLOY-GESPERRT` angelegt und gepusht** (Abschnitt „Veröffentlichung
      sperren").
- [ ] **Powerbanks, Lampe je Eingang, WLAN-Router** — die App löst kein
      leeres Telefon.

## Rückmeldung geben

In der App: Gerätenamen unten rechts antippen, dann *Rückmeldung geben*. Die
Angaben vom Gerät — Fassung, Kameraauflösung, Zahl der Tickets, Warteschlange,
letzter Serverkontakt — sammelt die App selbst ein.

Zwei Wege, weil zwei verschiedene Leute das benutzen:

- **Als Eintrag im Repo.** Öffnet einen fertig ausgefüllten Entwurf auf GitHub,
  abgeschickt wird erst dort. Braucht ein GitHub-Konto.
- **Alles kopieren.** Geht immer, auch ohne Konto — am Eingang der einzig
  realistische Weg.
