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

```bash
npx supabase login
npx supabase link --project-ref $REF
npx supabase db push
```

`db push` spielt `supabase/migrations/0001_init.sql` ein: Tabellen, die atomare
Einlösefunktion und den Bericht über ungeprüfte Zeiträume.

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

Bis die echte Liste da ist, geht es mit der erzeugten Testliste. Den
Service-Role-Schlüssel findest du unter *Project Settings → API*.

```bash
export SUPABASE_URL="https://$REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY='...'   # niemals ins Repo

node scripts/import-tickets.mjs data/tickets.sample.csv            # nur prüfen
node scripts/import-tickets.mjs data/tickets.sample.csv --commit   # schreiben
```

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

Alles steht. Die App kann gegen dieses Backend arbeiten.
```

Der Testlauf bucht nichts und ändert nichts. Führ ihn ruhig noch einmal am
Vorabend des Festivals aus.

## 7 · App bauen

```bash
cd web
npm install
VITE_API_URL="https://$REF.supabase.co/functions/v1" npm run build
```

Das Ergebnis in `web/dist/` ist statisch und gehört auf GitHub Pages oder
Cloudflare Pages. Für GitHub Pages kommt der Unterpfad dazu:

```bash
VITE_BASE=/TicketScan/ VITE_API_URL="https://$REF.supabase.co/functions/v1" npm run build
```

---

## Was wohin gehört

| Wert | Wo er hingehört | Darf ins Repo |
|---|---|---|
| Eventpasswort | Supabase-Secret | **nein** |
| `TICKETSCAN_TOKEN_SECRET` | Supabase-Secret | **nein** |
| Service-Role-Schlüssel | nur lokal beim Import | **nein** |
| Datenbank-Passwort | Passwortverwaltung | **nein** |
| Echte Ticketliste | direkt in die Datenbank | **nein** |
| `VITE_API_URL` | Build-Umgebung | unkritisch, steht ohnehin im Bundle |

Das Repo ist öffentlich. `.gitignore` hält `.env` und `data/tickets.csv`
draußen, aber die Regel oben ist die eigentliche Absicherung.
