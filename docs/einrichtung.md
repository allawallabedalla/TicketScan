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
siehe `supabase/migrations/README.md`.

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

Den **geheimen** Schlüssel holen: *Project Settings → API Keys*. Je nach Alter
des Projekts heißt er `sb_secret_...` oder `service_role`. Nicht zu verwechseln
mit dem öffentlichen (`sb_publishable_...` bzw. `anon`) — der darf nicht
schreiben.

Schlüssel im Browser kopieren, dann im Terminal:

```bash
export SUPABASE_URL="https://$REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="$(pbpaste)"   # aus der Zwischenablage

node scripts/import-tickets.mjs data/tickets.sample.csv            # nur prüfen
node scripts/import-tickets.mjs data/tickets.sample.csv --commit   # schreiben
```

`pbpaste` statt Einfügen in die Zeile ist kein Umstand, sondern Absicht:
Manche Terminals verfremden eingefügte Geheimnisse — der Wert sieht dann
richtig aus und ist es nicht. Außerdem landet er so nicht in der
Shell-History.

Der Importer prüft erst und schreibt nur mit `--commit`. Er bricht ab bei
Dubletten, uneinheitlicher Stellenzahl, verschobenen Spalten und einem
Schlüssel, der verfremdet wurde.

> **Zur echten Liste:** Excel entfernt führende Nullen — aus `00245` wird `245`.
> Am besten direkt aus dem Vorverkaufssystem exportieren und die Datei nicht in
> Excel öffnen. Der Importer erkennt es und bricht ab, aber gar nicht erst
> passieren zu lassen ist besser.

## 6 · Testlauf

```bash
export TICKETSCAN_API="https://$REF.supabase.co/functions/v1"
export TICKETSCAN_EVENT_PASSWORD='herzberg2027'
export TICKETSCAN_ANON_KEY='sb_publishable_...'   # der öffentliche, darf geteilt werden

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
  ok    offline_windows ist öffentlich nicht lesbar  401, kein Zugriff

Alles steht. Die App kann gegen dieses Backend arbeiten.
```

Der Testlauf bucht nichts und ändert nichts. Führ ihn ruhig noch einmal am
Vorabend des Festivals aus.

## 7 · App veröffentlichen

Die Adresse der Endpunkte steht bereits in `web/.env.production` — beim Bauen
ist nichts mehr zu setzen.

**Einmalig:** Repo → *Settings* → *Pages* → **Source: GitHub Actions**.

Danach baut und veröffentlicht `.github/workflows/deploy.yml` bei jedem Push,
der `web/` berührt. Von Hand auslösen geht über *Actions* → *App
veröffentlichen* → *Run workflow*. Die App liegt anschließend unter
`https://allawallabedalla.github.io/TicketScan/`.

Der Ablauf prüft dabei, dass die Texterkennung wirklich im Bundle liegt — ohne
diese Dateien liefe sie gegen ein fremdes CDN und ohne Netz gar nicht. Lieber
dort scheitern als am Eingang.

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
