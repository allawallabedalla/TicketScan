# Durchlauf gegen einen nachgestellten Server

Der Grund für dieses Verzeichnis steht in `docs/audit.html`: Von allen Befunden
kamen die folgenschwersten daher, dass etwas **tatsächlich ausgeführt** wurde —
nicht daher, dass jemand Code gelesen hat. Ein Durchlauf, der die gebaute App
im Browser fernsteuert, findet in zwei Minuten, was drei Leseläufe übersehen.

Gefunden hat dieser Aufbau unter anderem: dass ein Fehler in einem Bildschirm
die ganze App mitriss, dass „freigeben und einlassen" niemanden einließ, und
dass die Rückmeldung auf einem 320 Pixel breiten Gerät ihren Abweisen-Knopf
außerhalb des Bildschirms hatte.

## Was es tut

`server.mjs` ist ein nachgestelltes Backend: dieselben vier Endpunkte, 2305
Tickets im Speicher, echte Idempotenz über die `scanId`. Es liefert zugleich
die gebaute App aus. `run.mjs` steuert Chromium durch den ganzen Ablauf —
Anmeldung, Einrichtung, Einlösen, Doppelscan, unbekannte Nummer, Ticketliste,
Suche über Nummer und Name, Nachladen beim Blättern, Verlauf, Rücknahme,
Übersicht, Betrieb ohne Netz und das Leeren der Warteschlange danach.

Es ist **kein** Ersatz für `scripts/smoke-test.mjs`: Der prüft das echte
Backend, dieser hier die App.

## Aufrufen

```bash
cd scripts/e2e
npm install

# Prüf-Fassung der App bauen — gegen den nachgestellten Server statt Supabase
( cd ../../web && VITE_API_URL=http://127.0.0.1:8123/api VITE_BASE=/ \
    npx vite build --outDir ../scripts/e2e/dist --emptyOutDir )

node server.mjs dist 8123 &      # in einem zweiten Fenster
node run.mjs
```

Erwartet werden 24 Zeilen `ok` und `SEITENFEHLER: keine` — bis auf die eine
Meldung `ERR_INTERNET_DISCONNECTED`, die der Flugmodus-Test selbst auslöst.

## Anmeldung

`anmeldung.mjs` prüft die Wahl am Anfang — beide Wege, die Meldung beim
falschen Passwort, und dass der Verwaltungsweg auch dort landet.

```bash
node anmeldung.mjs
```

## Verwaltungsansicht

`verwaltung.mjs` prüft den zweiten Weg in die App — das Pflegen der
Ticketliste. Neun Prüfungen, darunter die wichtigste: dass ein Gerät mit dem
gewöhnlichen Eventpasswort die Verwaltung weder sieht noch benutzen kann.

```bash
node verwaltung.mjs
```

Der nachgestellte Server kennt dafür `nimda-test` als Verwaltungspasswort.

## Den Fehler absichtlich einbauen

Ein Test, der nur auf der heilen Fassung läuft, prüft nichts. `KAPUTT=1`
stellt einen behobenen Fehler nach: Der Endpunkt schnitt den Zeitstempel des
Abgleichszeigers auf Millisekunden zurück, Postgres arbeitet aber in
Mikrosekunden — der Zeiger lief damit bei jeder Antwort ein Stück rückwärts,
und die App blätterte endlos im Kreis.

```bash
KAPUTT=1 node server.mjs dist 8123
```

Erwartet wird, dass der Durchlauf **trotzdem** grün bleibt: Die App muss den
stehenden Zeiger bemerken und abbrechen, statt hängenzubleiben. Bleibt sie
hängen, ist der Schutz in `web/src/lib/sync.ts` weg.

Die Bildschirmfotos jedes Schritts liegen danach als `NN-*.png` daneben. Sie
sind der schnellste Weg zu sehen, ob eine Darstellung auf einem schmalen Gerät
noch passt.

## Grenzen

Die Kamera liefert in Chromium ein künstliches Bild, die Texterkennung wird
also nicht mitgeprüft — dafür gibt es keinen Ersatz für ein echtes Ticket vor
einer echten Handykamera. Alles, was über die Zifferntastatur erreichbar ist,
deckt der Durchlauf ab.
