# Audit: Zuverlässigkeit im Livebetrieb

Siebter Durchgang, Stand 28.09.2026. Anders als die sechs davor
([`audit.html`](audit.html)) nur eine Frage: **Was lässt den Einlass unter
echten Bedingungen stehen?**

Die Annahmen dafür:

- Netz am Einlass: schwankender Mobilfunk, kein eigenes WLAN
- Geräte: private Handys, iOS und Android gemischt, verschiedene Alter
- Zeit bis zum Festival: mehr als zwei Wochen

Geprüft wurden App, Endpunkte, Migrationen und Betriebsdokumentation.
Die Kernlogik hält: Einlösung atomar, Warteschlange idempotent, geordnet und
verlustfrei, Abgleichszeiger korrekt. Die Befunde liegen am Rand, also dort,
wo Netz, Betriebssystem und Telefon mitreden.

## Behoben

### 1 · Hängende Anfrage legte die ganze Übertragung still (kritisch)

`fetch` hatte kein Zeitlimit. Im Mobilfunk bleibt eine Anfrage regelmäßig
hängen: gesendet, Funkzelle gewechselt, keine Antwort. Der Browser gibt erst
nach einer Minute (iOS) oder mehreren (Chrome) auf. Weil der Abgleich nur
einen Durchlauf zur Zeit erlaubt, ging in dieser Zeit **keine Einlösung raus
und keine fremde kam an**. Das Fenster für Doppeleinlass wuchs von acht
Sekunden auf Minuten, und die Statuszeile zeigte nur „3 warten".

Bei der Anmeldung um 6 Uhr war es noch deutlicher: „Einen Moment…" ohne Ende.
Der Rückfall auf die Anmeldung ohne Netz griff nie, weil nie ein Fehler kam.

**Fix:** `fetchMitFrist` in `web/src/lib/api.ts`, 20 Sekunden, für alle
Endpunkte und die Anmeldung. Abbrechen ist gefahrlos, weil Scans über die
`scanId` idempotent sind.

### 2 · Ab dem ersten Neustart kein Ton mehr (kritisch für iPhones)

Der Ton wurde ein einziges Mal freigeschaltet: beim Abschluss der
Kurzanleitung, also beim allerersten Start. iOS verwirft Web-Apps im
Hintergrund regelmäßig. Jeder spätere Start blieb **stumm**, und iPhones
können aus dem Browser heraus nicht vibrieren. Die Rückmeldung, „die man
nicht ansehen muss", fehlte damit auf jedem iPhone nach dem ersten Neustart.
Bemerkt hätte das niemand, weil die Einlasskraft aufs Ticket schaut.

**Fix:** `keepSoundUnlocked()` schaltet den Ton bei jeder Berührung frei. Das
heilt auch den Zustand „interrupted" nach Anruf oder Sperre. Wo Safari es
unterstützt, wird zusätzlich `navigator.audioSession.type = "playback"`
gesetzt, damit der Stummschalter den Ton nicht abdreht. Auf älteren iPhones
bleibt der Schalter maßgeblich, deshalb steht er in der Checkliste.

### 3 · Tote IndexedDB-Verbindung machte das Gerät taub (hoch)

Ein bekannter WebKit-Fehler: Nach Hintergrund oder Sperre meldet Safari
„Connection to Indexed Database server lost", und zwar bei jedem weiteren
Zugriff über dieselbe Verbindung. Die App hielt die Verbindung dauerhaft fest.
Danach ging nichts mehr: keine Entscheidung, keine Buchung, kein Abgleich,
nur „Das hat nicht geklappt". Helfen konnte nur ein Neustart, auf den niemand
kommt.

**Fix:** In `web/src/lib/store.ts` wird die Verbindung bei `close` und
`versionchange` verworfen. Jeder Zugriff baut bei `UnknownError` oder
`InvalidStateError` einmal neu auf. Das Wiederholen ist sicher, weil alle
Schreibvorgänge `put` oder `delete` über einen festen Schlüssel sind.

### 4 · Bildschirmsperre und schwarzes Kamerabild (hoch)

Zwischen zwei Gästen vergehen oft mehr als 30 Sekunden, also die übliche
Auto-Sperre. Danach heißt es entsperren. Als Home-Bildschirm-App beendet iOS
beim Sperren zudem den Kamerastrom. `play()` allein holt ihn nicht zurück,
das Bild bleibt schwarz, bis die App neu startet.

**Fix:** In `Scanner.tsx` hält die Screen-Wake-Lock-Schnittstelle den
Bildschirm wach, solange der Scanner offen ist. Ein beendeter Kamerastrom wird
bei der Rückkehr oder beim `ended`-Ereignis neu angefordert.

### 5 · Der Browser-Durchlauf war veraltet

`scripts/e2e/run.mjs` kannte den Auswahlbildschirm „Einlass scannen / Liste
pflegen" noch nicht und scheiterte seit Commit `4bf3366` schon bei der
Anmeldung. Die Checklistenzeile „Durchlauf grün, 24 von 24" war damit nicht
erfüllbar. Der Durchlauf ist repariert: **24 von 24 grün**, dazu
`anmeldung.mjs` 4 von 4, jeweils mit allen Fixes oben.

### 6 · Checkliste unvollständig

In `docs/einrichtung.md` stand „Migrationen 0001 bis 0004", es gibt aber
0005. Neu dazugekommen sind: Supabase-Projekt am Einschlafen hindern,
Einrichtung höchstens ein paar Tage vorher und auf dem Home-Bildschirm,
Stummschalter, Auto-Sperre, Geheimnisse vor dem Einrichten wechseln.

## Offen, mit Empfehlung

| Punkt | Risiko | Empfehlung |
|---|---|---|
| Supabase im kostenlosen Tarif | Pausiert nach 7 Tagen ohne Aktivität. Dann fallen Anmeldung, Einrichtung und Abgleich aus (Scannen läuft lokal weiter). | Am Vortag Dashboard prüfen, Testlauf starten. Kontingent prüfen: rund 4 500 Aufrufe je Stunde bei 10 Geräten. |
| Anmeldung ohne Netz | Das Gerät arbeitet mit dem abgelaufenen Token weiter. Beim ersten Kontakt schickt der Server 401, und das Gerät springt mitten in der Schicht auf den Anmeldebildschirm. So ist es gewollt, aber es überrascht. | In der Einweisung sagen: „Fragt die App nach dem Passwort, einfach eingeben. Nichts geht verloren." |
| Doppeleinlass im Funkloch | Zwei Geräte ohne Kontakt können dasselbe Ticket einlösen. Das ist durch das Konzept bedingt und nicht zu verhindern. | Bleibt sichtbar über Konfliktliste, ungeprüfte Zeiträume und Bändchenabgleich in der Übersicht. Bändchenstand je Schicht eintragen. |
| Zifferntastatur bei Speicherfehler | `evaluate` aus der Tastatur heraus meldet einen Fehler nicht. Durch Fix 3 wird das selten. | Niedrig, nicht angefasst. |
| Wake Lock auf älteren iPhones | Als Home-Bildschirm-App erst ab iOS 18.4 zuverlässig, im Stromsparmodus oft verweigert. | Auto-Sperre in den Einstellungen, siehe Checkliste. |

## In der Generalprobe gezielt prüfen

1. **Ton nach Neustart:** App auf einem iPhone ganz schließen, neu öffnen,
   einmal tippen, scannen. Es muss piepen.
2. **Sperre:** iPhone sperren, 1 Minute warten, entsperren. Das Kamerabild
   muss zurückkommen, ohne dass die App neu startet.
3. **Funkloch:** Ein Gerät in den Flugmodus, 5 Tickets scannen, Flugmodus aus.
   Die Statuszeile muss innerhalb von etwa 30 Sekunden auf „alles gesendet"
   gehen.
4. **Anmeldung im schlechten Netz:** Um 6 Uhr oder nach dem Wechsel der
   Geheimnisse anmelden. Spätestens nach 20 Sekunden muss die App eine
   Antwort geben oder ohne Netz weiterarbeiten.
5. **Langer Betrieb:** Ein Gerät zwei Stunden ohne Neustart im Scanner lassen,
   mit Sperre und App-Wechseln dazwischen. Danach muss es noch buchen und
   abgleichen.

---

# Zweiter Teil: was der erste Durchgang nicht geprüft hatte

Der erste Teil hatte „Livebetrieb" als Netz, Gerät und Betriebssystem
gelesen. Die Verwaltung, der Verlauf, die Übersicht, die Skripte und die
Texterkennung auf Altgeräten blieben ungelesen. Ausgelöst hat die Nachprüfung
eine Frage aus dem Betrieb: ob sich die Namen in der Liste überschreiben
lassen. Das ging, und es ging schlimmer als gedacht.

Fünf Prüfer liefen parallel, jeder auf einem Bereich; einer prüfte gezielt die
Fixes aus dem ersten Teil. Rund 55 Befunde. Jeder übernommene wurde am Code
nachvollzogen. Einer wurde verworfen: Das angebliche automatische Neuladen
mitten in der Schicht gibt es nicht, das gebaute `registerSW.js` registriert
nur.

## Behoben — konnte zu Doppeleinlass oder falschen Namen führen

| Befund | Fix |
|---|---|
| Eine abgelehnte Rücknahme ließ das Ticket auf dem Gerät **dauerhaft frei**. Eine Kopie des Tickets ging dort grün durch. | `scans` liefert nach jeder Rücknahme den tatsächlichen Stand, das Gerät übernimmt ihn. Der Verlauf zeigt „Rücknahme abgelehnt". |
| Der Abgleich konnte Einlösungen und Namensänderungen **dauerhaft verpassen** (Zeitstempel = Transaktionsbeginn, nicht Sichtbarkeit). Die früheren Durchgänge hielten den Zeiger für dicht. | Jede Abfrage greift eine Minute hinter den Zeiger zurück. |
| „Trotzdem einlassen" markierte den **falschen Verlaufseintrag** als zurückgenommen. | Die neue Einlösung ist ausgenommen. |
| Beim Einfügen einer Liste wurde **„Müller, Hans" zerlegt**, leere Felder **löschten Namen**, doppelte Nummern fielen nicht auf. Das Import-Skript löschte genauso. | Ein Trennzeichen je Liste, Anführungszeichen wie CSV. Neuer Schreibweg `stammdaten_schreiben` (Migration 0006): ein fehlendes Feld bleibt stehen, Probelauf vor dem Schreiben, Dubletten und Stellenzahl werden geprüft, neue Nummern nur mit Freigabe, Änderungsprotokoll `ticket_changes`. |
| Die Einrichtung schrieb die **Testliste mit erfundenen Namen** auf die echten Nummern. | Die Testliste hat keine Namen mehr. |
| Das Zeitlimit aus Teil 1 deckte den **Antwortinhalt nicht** ab. Ein hängendes Senden blockierte auch das Holen. | Die Frist umfasst den Inhalt. Das Holen läuft auch, wenn das Senden scheitert. Bündel werden kleiner, wenn der Server langsam ist. |

## Behoben — Aufsicht und Betrieb

- **Bändchenabgleich:** Bisher galt nur die global letzte Meldung, was Fehlalarme gab. Jetzt zählt die jüngste Meldung je Gerät, summiert und mit Zeitpunkt angezeigt.
- **Ungeprüfte Zeiträume:** Sie richten sich nach der Uhrzeit auf dem Gerät statt nach dem Upload, werden je Gerät getrennt und zählen doppelte Einlösungen je Zeitraum.
- **Übersicht ohne Netz:** Abmelden, Rückmeldung und Listenpflege sind trotzdem erreichbar. Die Zahlen tragen „Stand HH:MM". Das Eintragen der Bändchen meldet Erfolg oder Fehler.
- **Texterkennung:**
  - Ein hängender Erkennungsdurchlauf wird nach 6 s verworfen und neu gestartet.
  - Die Erkennung startet regelmäßig neu.
  - Der ganzflächige Durchgang ist auf 1600 px begrenzt.
  - Es gibt eine Taschenlampe, wo der Browser sie steuern lässt (Android).
  - Die Kamera versucht es nach einem Fehler erneut.
- **Verlauf:** eigener Speicherbereich, ohne Wettlauf beim Schreiben und ohne Grenze von 200.
- **`reset-redemptions.mjs`:** braucht `--gesichert`. Es warnt, wenn die letzte Einlösung jünger als 2 Stunden ist, scheitert laut bei falschem Projekt und nennt das Löschen des Protokolls ausdrücklich.
- **Backend ohne Terminal:** Es gibt den Ablauf „Backend veröffentlichen" (GitHub Actions, nur von Hand, standardmäßig als Probelauf).
- **Doku, `.env.example`, README:**
  - Migrationen und Endpunkte sind vollständig aufgeführt.
  - Die Doku zeigt, wie Passwörter gesetzt werden, ohne in der Shell-History zu landen.
  - Es gibt einen Notfallabschnitt für einen Ausfall des Backends und zum Nachbuchen von Papier-Einlässen.
  - Der Testlauf legt kein neues Gerät mehr an.

## Reihenfolge beim Ausrollen

**Erst das Backend, dann die App.** Der alte Endpunkt `verwaltung` kennt keinen
Probelauf. Ein „Prüfen" aus der neuen App würde dort schreiben, mit der alten
Logik, bei der leere Felder Namen löschen. Die neue Backend-Fassung verträgt die
alte App dagegen.

## Geprüft

- Migrationen 0001–0006 gegen Postgres 16 eingespielt, 0006 zweimal. `stammdaten_schreiben` in acht Fällen getestet: Probelauf, Änderung, fehlende Freigabe, Dubletten, Stellenzahl, bewusstes Leeren, Länge und unberührter Einlassstand.
- Die Browser-Durchläufe gegen den nachgestellten Server sind grün: `run` 24/24, `anmeldung` 4/4, `verwaltung` 13/13 (davon 5 neue Prüfungen zu Stammdaten), `verwaltung-filter` 5/5. `verwaltung.mjs` war wie `run.mjs` seit der Wahl am Anfang veraltet und ist nachgezogen.
- Die Edge Functions wurden nur auf Syntax geprüft (esbuild), nicht gegen echtes Supabase. Das übernimmt der Testlauf `smoke-test.mjs` nach dem Ausrollen.
