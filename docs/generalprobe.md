# Generalprobe — Testplan

Vollständiger Testplan für den letzten Praxistest vor dem Festival.
Ausdruckbar, zum Abhaken vor Ort.

## 1 · Ziel, Dauer, Rollen, Material

**Ziel:** Den gesamten Einlassbetrieb — Anmeldung, Erfassung, Bestätigung,
Funkloch, Verwaltung, Übersicht, Notfall — einmal vollständig mit echten
Geräten und echten Tickets durchspielen, bevor es am Festivaltag zählt.

**Dauer:** realistisch **3 bis 4 Stunden**, davon **2 Stunden** als
Dauerbetrieb (Block H), der parallel zu den übrigen Testfällen auf einem
gesondert dafür eingeteilten Gerät läuft.

**Rollen:**

- **Testleitung** — führt die Testfälle der Reihe nach durch, trägt OK/Fehler
  ein, entscheidet am Ende über Go/No-Go.
- **3–4 Einlasskräfte** — mit gemischten Geräten: mindestens ein iPhone und
  mindestens ein Android-Gerät müssen dabei sein.
- **1 Verwaltung** — mit dem Verwaltungspasswort, für Block F.
- **1 „Gast“-Darsteller** — bringt Tickets vor, spielt Doppeleinlass- und
  Funkloch-Szenen nach.

**Material:**

- Echte Tickets oder Testtickets, genug für alle Testfälle inklusive der
  absichtlichen Doppelscans (mehrere Nummern doppelt vorbereiten).
- Bändchen zum tatsächlichen Anlegen.
- Powerbank je Gerät.
- Eine Lampe für den Bereich, in dem die Tickets gehalten werden — ohne
  Licht liest die Kamera nicht zuverlässig.
- Eine ausgedruckte Papierliste (`node scripts/export-log.mjs > einlass.csv`)
  für Block I.
- Geräte, die sich in den Flugmodus versetzen lassen.

## 2 · Vorbereitung

- [ ] **Geheimnisse gewechselt** (Eventpasswort, Verwaltungspasswort,
      `TICKETSCAN_TOKEN_SECRET`) — siehe GitHub-Issue #2.
- [ ] Backend aktuell: alle Migrationen eingespielt, alle Endpunkte
      ausgerollt.
- [ ] App aktuell und auf **allen** Geräten dieselbe Fassung (steht unten im
      Einrichtungsbildschirm und in jeder Rückmeldung).
- [ ] Alle Geräte auf dem Home-Bildschirm eingerichtet, nicht im
      Browser-Tab.
- [ ] Stummschalter aus, Lautstärke hoch (iPhone).
- [ ] Auto-Sperre auf „Nie“ oder 5 Minuten gestellt.
- [ ] Bändchenstand auf allen Geräten einmal auf 0 eingetragen, damit die
      Gegenrechnung von Beginn an eine Grundlage hat.

## 3 · Testfälle

### A · Einrichten / Anmelden

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| A1 | Gerät zum ersten Mal öffnen, Kurzanleitung durchtippen, „Einlass scannen“ wählen, Eventpasswort und Gerätenamen eingeben | Anmeldung gelingt, Einrichtung lädt Ticketliste und Texterkennung, danach „Scanner öffnen“ | |
| A2 | App schließen und am selben Tag erneut öffnen | Keine erneute Passwortabfrage — das Gerätetoken gilt bis 6 Uhr | |
| A3 | Gerät in den Flugmodus versetzen, App öffnen, ohne gültiges Netz anmelden | Offline-Rückfall greift: Anmeldung mit dem zuletzt erfolgreich geprüften Passwort funktioniert auch ohne Netz | |
| A4 | Verwaltungsgerät: Verwaltungspasswort statt Eventpasswort eingeben | Es öffnet sich die Verwaltung, nicht der Scanner | |

### B · Normaler Einlass

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| B1 | Ticket mit der Kamera erfassen | Nummer erscheint groß in Zweiergruppen, Name und Kategorie darunter | |
| B2 | Dieselbe Nummer über die Zifferntastatur eingeben | Gleiches Ergebnis wie über die Kamera | |
| B3 | Bestätigungsschritt beobachten | Nummer **und Name** sind sichtbar; die Buchung erfolgt erst nach Tippen auf „Einlassen“ | |
| B4 | iPhone: App vollständig aus dem Multitasking entfernen, neu öffnen, einmal auf den Bildschirm tippen, dann scannen | Es ertönt ein Ton | |
| B5 | Nach dem Einlass den Verlauf öffnen | Der Vorgang steht dort mit Nummer, Uhrzeit und „eingelassen“ | |

### C · Fehlbedienung

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| C1 | Ein bereits eingelöstes Ticket am selben Gerät erneut scannen | Meldung „Bereits eingelöst“ mit der Uhrzeit der ersten Einlösung | |
| C2 | Ticket an Gerät A einlösen, etwa 10 Sekunden warten, dieselbe Nummer an Gerät B scannen | Gerät B zeigt ebenfalls „Bereits eingelöst“ mit der Uhrzeit von Gerät A | |
| C3 | Eine Nummer eingeben, die nicht auf der Liste steht | Meldung „unbekannt“, kein Einlass möglich | |
| C4 | Eine Einlösung im Verlauf zurücknehmen, danach dieselbe Nummer erneut scannen | Ticket ist wieder frei und lässt sich normal einlösen | |
| C5 | Ein bereits eingelöstes, aber unversehrtes Ticket vorlegen (Erfassungsfehler-Fall) und „Trotzdem einlassen“ wählen | Einlass wird gebucht, Vorgang ist im Verlauf und Protokoll nachvollziehbar | |

### D · Funkloch

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| D1 | Ein Gerät in den Flugmodus versetzen, 5 Tickets scannen | Alle 5 werden lokal sofort grün angezeigt, die Statuszeile zeigt die Anzahl wartender Vorgänge | |
| D2 | Flugmodus wieder ausschalten | Die Warteschlange leert sich binnen etwa 30 Sekunden, die Statuszeile zeigt „alles gesendet“ (oder gleichwertig) | |
| D3 | Zwei Geräte beide in den Flugmodus versetzen, dasselbe Ticket auf **beiden** einlösen, danach beide wieder online bringen | Nach dem Abgleich taucht der Fall in der Übersicht unter **Konflikte** auf | |

### E · Gerät / Betriebssystem

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| E1 | iPhone sperren, 1 Minute warten, entsperren | Kamerabild kommt zurück, ohne dass die App neu startet | |
| E2 | Während des Scannens kurz eine andere App öffnen und zurückkehren | Scanner funktioniert danach normal weiter | |
| E3 | Während des Scannens einen Anruf annehmen und wieder beenden | Kamera und Ton funktionieren danach wieder — kein dauerhaft schwarzes Bild, kein dauerhaft stummer Zustand | |
| E4 | Android: Taschenlampe im Scanner ein- und ausschalten | Licht reagiert, der Knopf zeigt den Zustand | |
| E5 | Gerät mit mehreren Kameras: Knopf „Andere Kamera“ nutzen | Ansicht wechselt auf die andere Kamera; der Knopf erscheint nur, wenn das Gerät mehrere Kameras hat — gedacht für Android-Geräte, deren Standardkamera nicht scharf stellt | |

### F · Verwaltung

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| F1 | Verwaltung → Einzeln: Namen bei einem Ticket ändern, speichern | Einlassgeräte zeigen den neuen Namen binnen weniger Sekunden im Bestätigungsschritt | |
| F2 | Verwaltung → Liste einfügen: eine kleine Testliste einfügen | Vor dem Übernehmen zeigt die App einen Probelauf (Anzahl neu / geändert / unverändert); geschrieben wird erst nach ausdrücklicher Bestätigung | |
| F3 | Verwaltung → Einzeln → Feld „Sperrvermerk“ bei einem Ticket setzen, Grund eintragen, speichern | An allen Einlassgeräten wird das Ticket binnen etwa 1 Minute rot als „Gesperrt“ mit Grund angezeigt, kein Einlass möglich | |
| F4 | Denselben Sperrvermerk wieder entfernen | Ticket lässt sich an allen Geräten binnen etwa 1 Minute wieder normal einlösen | |

### G · Übersicht

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| G1 | Übersicht öffnen, Zähler „eingelöst“ prüfen | Zahl stimmt mit den tatsächlich durchgeführten Einlässen überein | |
| G2 | Geräteliste in der Übersicht prüfen | Alle beteiligten Testgeräte sind aufgeführt | |
| G3 | Bändchenstand je Gerät eintragen | Eintrag wird bestätigt (Erfolgsmeldung), die Summe erscheint in der Gegenrechnung | |
| G4 | Abweichung zwischen digital eingelöst und Bändchen ansehen | Abweichung lässt sich durch bekannte Fälle erklären (Konflikte, noch wartende Vorgänge) | |

### H · Last / Dauer

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| H1 | Ein Gerät 2 Stunden durchgehend im Scanner-Bildschirm lassen, dabei zwischendurch sperren und die App wechseln, weiter normal Tickets scannen | Gerät bucht und gleicht am Ende weiterhin korrekt ab; Akkustand am Anfang und am Ende notieren | |

### I · Notfall

| Nr | Was tun | Erwartet | OK/Fehler |
|---|---|---|---|
| I1 | Backend-Ausfall simulieren: **alle** Geräte in den Flugmodus versetzen | Geräte scannen lokal normal weiter, nichts blockiert | |
| I2 | Für einige Gäste die ausgedruckte Papierliste (`einlass.csv`) von Hand abhaken | Abhaken funktioniert ohne App | |
| I3 | Sobald mindestens ein Gerät wieder online ist: die abgehakten Papier-Nummern **an einem einzigen Gerät** über die Zifferntastatur nachbuchen | Meldet die App „bereits eingelöst“, wird das **abgewiesen** — nicht „Trotzdem einlassen“ gewählt | |

## 4 · Abbruchkriterien / Go-No-Go

**No-Go — sofort abbrechen, Ursache klären, betroffenen Testfall nach dem
Fix wiederholen:**

- Ein Doppeleinlass aus Testfall D3 bleibt unbemerkt, das heißt: kein
  Eintrag in den Konflikten der Übersicht.
- Die Warteschlange leert sich nach Rückkehr aus dem Flugmodus nicht binnen
  etwa 1 Minute (deutlich über den in Testfall D2 erwarteten 30 Sekunden).
- Der Bestätigungsschritt zeigt eine falsche oder keine Nummer/keinen
  Namen.
- Der Ton bleibt auf einem iPhone nach dem Neustart aus Testfall B4 stumm.
- Ein Sperrvermerk aus Testfall F3 erscheint nicht an allen Geräten oder
  verhindert den Einlass nicht.
- Die Kamera bleibt nach Sperre oder Anruf (Testfall E1/E3) dauerhaft
  schwarz, ohne dass ein einfacher Neustart hilft.

**Go:** Alle Testfälle A–I durchgeführt, kein offener Fall aus der Liste
oben. Einzelne kleinere Befunde (z. B. Bedienkomfort) blockieren das
Festival nicht, gehören aber als Issue festgehalten (Abschnitt 5).

Die Testleitung entscheidet unmittelbar im Anschluss anhand des
ausgefüllten Protokolls.

## 5 · Nach der Probe

1. **Protokoll sichern**, bevor irgendetwas zurückgesetzt wird:

   ```bash
   export SUPABASE_URL="https://$REF.supabase.co"
   node scripts/export-log.mjs --protokoll > protokoll-generalprobe.csv
   ```

2. **Einlösungen zurücksetzen**, Ticketliste bleibt dabei unangetastet:

   ```bash
   node scripts/reset-redemptions.mjs                       # nur zeigen
   node scripts/reset-redemptions.mjs --commit --gesichert  # ausführen
   ```

3. **Geräte neu einrichten.** Zwingend nötig ist das nur, wenn zwischen
   Test- und echter Ticketliste gewechselt wurde: Dann auf jedem Gerät die
   App vom Home-Bildschirm löschen und neu installieren — „Neu einrichten“
   in der App reicht dafür nicht, weil der Abgleich nur neue und geänderte
   Zeilen holt, nie löscht.

4. **Befunde als GitHub-Issue festhalten.** In der App: Gerätenamen unten
   rechts antippen, dann „Rückmeldung geben“ — Fassung, Kamera, Ticketzahl
   und Warteschlange werden automatisch mitgeschickt. Für jeden Testfall mit
   „Fehler“ aus Abschnitt 3 ein eigenes Issue anlegen.
