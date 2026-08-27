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

## 2 · Schema einspielen

Ist die GitHub-Verknüpfung eingerichtet (*Project Settings → Integrations*),
spielt Supabase die Migrationen bei jedem Push auf den Produktionszweig selbst
ein — dann ist hier nichts zu tun außer nachzusehen, ob es geklappt hat.

Ohne Verknüpfung, oder um nachzuhelfen:

```bash
npx supabase login
npx supabase link --project-ref $REF
npx supabase db push
```

Was tatsächlich in der Datenbank steht, verrät der SQL-Editor:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

Es müssen **beide** Migrationen dastehen, `0001_init` und `0002_harden`.
Fehlt die zweite, ist die Sicht `offline_windows` über die Data API lesbar —
siehe `docs/migrationen.md`.

## 3 · Geheimnisse setzen

```bash
npx supabase secrets set \
  TICKETSCAN_EVENT_PASSWORD='herzberg2027' \
  TICKETSCAN_TOKEN_SECRET="$(openssl rand -base64 48)" \
  TICKETSCAN_TIMEZONE='Europe/Berlin' \
  TICKETSCAN_ALLOWED_ORIGIN='https://<eure-app-adresse>'
```

- **Das Eventpasswort steht nirgends im Repo** und darf da auch nie hinein. Es
  lebt ausschließlich hier.
- `TICKETSCAN_TOKEN_SECRET` wird zufällig erzeugt. Ein Wechsel meldet alle
  Geräte ab — genau das will man, wenn ein Telefon verschwindet.
- **`TICKETSCAN_TIMEZONE` nicht weglassen.** Ohne die Angabe läge der
  Tageswechsel im Sommer auf 8 Uhr deutscher Zeit statt auf 6.
- `TICKETSCAN_ALLOWED_ORIGIN` kannst du zunächst leer lassen und nachtragen,
  sobald die App eine feste Adresse hat.

## 4 · Endpunkte veröffentlichen

```bash
npx supabase functions deploy session --no-verify-jwt
npx supabase functions deploy scans   --no-verify-jwt
npx supabase functions deploy changes --no-verify-jwt
```

`--no-verify-jwt` ist hier richtig und kein Sicherheitsloch: Die Endpunkte
prüfen selbst — `session` das Eventpasswort, `scans` und `changes` das
Gerätetoken. Ohne den Schalter würde Supabase zusätzlich einen eigenen JWT
verlangen, den unsere Geräte gar nicht haben; das Ergebnis wäre ein 401, dessen
Ursache man lange sucht.

## 5 · Ticketliste importieren

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

## 6 · Testlauf

```bash
export TICKETSCAN_API="https://$REF.supabase.co/functions/v1"
export TICKETSCAN_EVENT_PASSWORD='herzberg2027'
node scripts/smoke-test.mjs
```

Erwartete Ausgabe:

```
  ok    Falsches Passwort wird abgelehnt            401 wie erwartet
  ok    Anmeldung mit dem echten Passwort           Gerätekennung 3f9a1c02…
  ok    Tagesgrenze liegt in deutscher Ortszeit     31.7.2026, 06:00:00 Ortszeit
  ok    Ticketliste abrufbar                        2305 Tickets, 00001 – 02305, 2305 noch nicht eingelöst
  ok    Abgelaufenes Token wird abgewiesen          401 wie erwartet
  ok    tickets ist öffentlich nicht lesbar          leer, kein Zugriff
  ok    scan_log ist öffentlich nicht lesbar         401, kein Zugriff
  ok    offline_windows ist öffentlich nicht lesbar  Rechte entzogen (42501)
  ok    Einlösen wird gebucht                        02305 eingelöst
  ok    Zweites Einlösen wird als doppelt erkannt    duplicate wie erwartet
  ok    Derselbe Scan zweimal bucht nicht doppelt    Antwort wiederholt statt neu gebucht
  ok    Markierung ohne Abgleich wird angenommen     Parameter p_offline vorhanden
  ok    Rücknahme gibt das Ticket wieder frei        02305 wieder frei — Bestand unverändert

Alles steht. Die App kann gegen dieses Backend arbeiten.
```

Der Testlauf löst ein einzelnes freies Ticket ein und nimmt es am Ende wieder
zurück — der Bestand bleibt damit unverändert. Diese Runde ist der eigentliche
Zweck: Sie führt die Datenbankfunktionen tatsächlich aus, statt ihre Existenz
anzunehmen. Die Rücknahme war einmal nicht lauffähig, und das wäre nur hier
aufgefallen. Führ ihn ruhig noch einmal am
Vorabend des Festivals aus.

## 7 · App veröffentlichen

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
pushen. Dieselbe Regel gilt für die GitHub-Verknüpfung von Supabase, die sonst
Schemaänderungen einspielt.

## Nach der Generalprobe

Der Bestand steht danach voller Testeinlösungen. Zurücksetzen, ohne die
Ticketliste anzurühren:

```bash
node scripts/reset-redemptions.mjs                       # nur zeigen
node scripts/reset-redemptions.mjs --commit              # ausführen
node scripts/reset-redemptions.mjs --commit --auch-protokoll
```

Ausgeführt wird erst nach einer Rückfrage, die man nicht versehentlich
wegtippt — das Skript löscht die Arbeit eines ganzen Abends, wenn man sich im
Zeitpunkt irrt. Die Geräte ziehen den Stand beim nächsten Abgleich nach.

## Listen am Laptop ansehen

Drei Wege, je nachdem, was gebraucht wird.

**Währenddessen, ohne Werkzeug:** Die App im Laptop-Browser öffnen
(<https://allawallabedalla.github.io/TicketScan/>), mit demselben Passwort
anmelden, unten rechts *Übersicht* antippen. Das ist derselbe Stand, den die
Telefone sehen — Anzahl eingelöst, Geräte, Konflikte. Ein Laptop zählt dabei
als weiteres Gerät; scannen muss er nicht.

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

## Rückmeldung geben

In der App: Gerätenamen unten rechts antippen, dann *Rückmeldung geben*. Die
Angaben vom Gerät — Fassung, Kameraauflösung, Zahl der Tickets, Warteschlange,
letzter Serverkontakt — sammelt die App selbst ein.

Zwei Wege, weil zwei verschiedene Leute das benutzen:

- **Als Eintrag im Repo.** Öffnet einen fertig ausgefüllten Entwurf auf GitHub,
  abgeschickt wird erst dort. Braucht ein GitHub-Konto.
- **Alles kopieren.** Geht immer, auch ohne Konto — am Eingang der einzig
  realistische Weg.
