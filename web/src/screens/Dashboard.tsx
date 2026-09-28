// Übersicht für die Einlassleitung.
//
// Beantwortet die vier Fragen, die während des Einlasses tatsächlich gestellt
// werden: Wie viele sind drin? Melden sich alle Geräte? Gab es Zeiträume ohne
// Abgleich? Und passt die Zahl der ausgegebenen Bändchen dazu?

import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import { Unauthorized } from "../lib/api";
import * as store from "../lib/store";
import type { Session } from "../lib/store";
import { Feedback } from "./Feedback";
import { Verwaltung } from "./Verwaltung";

interface Stats {
  eingeloest: number;
  gesamt: number;
  geraete: Array<{ device_id: string; label: string; last_seen_at: string | null; revoked_at: string | null }>;
  konflikte: Array<{ code: string; server_ts: string }>;
  /** Gesamtzahl, weil die Liste oben auf 25 gekappt ist. */
  konflikteGesamt?: number;
  ungeprueft: Array<{ geraet?: string; von: string; bis: string; anzahl: number; doppelt?: number }>;
  baendchen: number | null;
  baendchenMeldungen?: Array<{ device_id: string; counted: number; noted_at: string }>;
  abweichung: number | null;
  serverTime?: string;
}

export function Dashboard({ session, onClose }: { session: Session; onClose: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Wann die angezeigten Zahlen geholt wurden. Fällt das Netz weg, bleiben
  // sie stehen — dann muss dabeistehen, wie alt sie sind.
  const [stand, setStand] = useState<number | null>(null);
  // Versatz der Geräteuhr gegenüber dem Server. Private Telefone gehen
  // manchmal Minuten falsch; „meldet sich nicht" rechnete gegen diese Uhr.
  const [versatz, setVersatz] = useState(0);
  const [bands, setBands] = useState("");
  const [bandsBusy, setBandsBusy] = useState(false);
  const [bandsMeldung, setBandsMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showVerwaltung, setShowVerwaltung] = useState(false);

  const load = useCallback(async () => {
    try {
      const neu = await api.fetchStats<Stats>(session);
      setStats(neu);
      setStand(Date.now());
      if (neu.serverTime) setVersatz(Date.parse(neu.serverTime) - Date.now());
      setError(null);
    } catch (err) {
      // Nicht jeder Fehler ist fehlendes Netz. Ein 404 heißt: der Endpunkt
      // `stats` wurde nie ausgerollt — wer das für ein Netzproblem hält,
      // sucht am falschen Ende.
      setError(
        err instanceof Unauthorized
          ? "Anmeldung abgelaufen oder Gerät gesperrt. Bitte neu anmelden."
          : err instanceof Error && /: 404$|not found/i.test(err.message)
            ? "Der Endpunkt „stats“ ist nicht veröffentlicht. Siehe docs/einrichtung.md, Schritt 4."
            : "Kennzahlen brauchen Netz — gerade nicht erreichbar.",
      );
    }
  }, [session]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function submitBands() {
    const digits = bands.replace(/\D/g, "");
    // Leer heißt leer, nicht null. Number("") ist 0 und Number.isInteger(0)
    // ist wahr — ein Fehltipp auf den Knopf setzte den Bändchenstand damit
    // auf 0 und ließ die Übersicht „alle nicht erfasst" melden.
    if (!digits || bandsBusy) return;
    setBandsBusy(true);
    setBandsMeldung(null);
    try {
      await api.reportWristbands(session, Number(digits));
      setBands("");
      setBandsMeldung({ ok: true, text: `${digits} Bändchen eingetragen.` });
      await load();
    } catch {
      // Vorher lief ein Fehler hier still ins Leere — die Schichtleitung
      // hielt den Stand für gespeichert.
      setBandsMeldung({ ok: false, text: "Nicht gespeichert — kein Netz? Bitte noch einmal eintragen." });
    } finally {
      setBandsBusy(false);
    }
  }

  const stale = (at: string | null) =>
    at === null || Date.now() + versatz - Date.parse(at) > 5 * 60_000;

  const label = (id: string) =>
    stats?.geraete.find((d) => d.device_id === id)?.label ?? id.slice(0, 8);

  return (
    <div className="sheet overlay list">
      <header className="list-head">
        <h1>Übersicht</h1>
        <button type="button" className="btn" onClick={onClose}>Schließen</button>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}{stats && stand ? ` Die Zahlen unten sind von ${time(new Date(stand).toISOString())} Uhr.` : ""}
        </p>
      )}
      {showVerwaltung && (
        <Verwaltung session={session} onClose={() => setShowVerwaltung(false)} />
      )}
      {showFeedback && <Feedback onClose={() => setShowFeedback(false)} />}

      {stats && (
        <>
          <div className="tiles">
            <div className="tile">
              <span className="tile-value">{stats.eingeloest}</span>
              <span className="tile-label">eingelöst</span>
            </div>
            <div className="tile">
              <span className="tile-value">{stats.gesamt - stats.eingeloest}</span>
              <span className="tile-label">stehen noch aus</span>
            </div>
            <div className="tile">
              <span className="tile-value">
                {stats.gesamt > 0 ? Math.round((stats.eingeloest / stats.gesamt) * 100) : 0}&thinsp;%
              </span>
              <span className="tile-label">von {stats.gesamt}</span>
            </div>
          </div>

          <section className="block">
            <h2>Bändchen abgleichen</h2>
            <p className="aside">
              Der zweite, körperliche Zähler. Läuft er auseinander, ist etwas im
              Argen — bevor es an der Tür auffällt.
            </p>
            {stats.abweichung !== null && (
              <p className={stats.abweichung === 0 ? "verdict ok" : "verdict warn"}>
                {stats.abweichung === 0
                  ? `Stimmt überein — ${stats.baendchen} Bändchen, ${stats.eingeloest} Einlösungen.`
                  : `${stats.baendchen} Bändchen gegen ${stats.eingeloest} Einlösungen — ` +
                    `${Math.abs(stats.abweichung)} ${stats.abweichung > 0 ? "zu viel ausgegeben" : "nicht erfasst"}.`}
              </p>
            )}
            {(stats.baendchenMeldungen?.length ?? 0) > 0 && (
              <p className="aside tight">
                Summe der jüngsten Meldung je Gerät:{" "}
                {stats.baendchenMeldungen!.map((m) =>
                  `${label(m.device_id)} ${m.counted} (${time(m.noted_at)})`).join(" · ")}.
                {" "}Eine ältere Meldung gegen die laufende Zahl ergibt eine
                wachsende Abweichung — dann neu zählen und eintragen.
              </p>
            )}
            {/* Als .field, sonst greift keine der Eingabefeld-Regeln: Das
                Feld war 21 Pixel hoch, der Knopf darin 13, und ohne die
                17-Pixel-Schrift zoomt iOS beim Antippen hinein. */}
            <div className="field field-with-button">
              <input
                type="text" inputMode="numeric" value={bands}
                onChange={(e) => setBands(e.target.value)}
                placeholder="Ausgegebene Bändchen"
                aria-label="Ausgegebene Bändchen"
              />
              <button
                type="button" className="field-button wide-label" disabled={bandsBusy}
                onClick={() => void submitBands()}
              >
                {bandsBusy ? "…" : "Eintragen"}
              </button>
            </div>
            {bandsMeldung && (
              <p className={bandsMeldung.ok ? "verdict ok" : "error"} role="status">{bandsMeldung.text}</p>
            )}
          </section>

          <section className="block">
            <h2>Geräte</h2>
            <ul className="entries">
              {stats.geraete.map((d) => (
                <li key={d.device_id} className={d.revoked_at ? "unknown" : stale(d.last_seen_at) ? "duplicate" : "ok"}>
                  <span className="entry-code small-code">{d.label}</span>
                  <span className="entry-meta">
                    {d.revoked_at ? "gesperrt"
                      : d.last_seen_at
                        ? `zuletzt ${time(d.last_seen_at)}${stale(d.last_seen_at) ? " · meldet sich nicht" : ""}`
                      : "noch nie gemeldet"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="aside">
              Ein Gerät, das sich fünf Minuten nicht gemeldet hat, ist gelb —
              Akku leer, verlegt, oder ohne Netz.
            </p>
          </section>

          {stats.ungeprueft.length > 0 && (
            <section className="block">
              <h2>Ungeprüfte Zeiträume</h2>
              <ul className="entries">
                {stats.ungeprueft.map((w) => (
                  <li key={`${w.geraet ?? ""}-${w.von}`} className={w.doppelt ? "unknown" : "duplicate"}>
                    <span className="entry-code small-code">{time(w.von)}–{time(w.bis)}</span>
                    <span className="entry-meta">
                      {w.geraet ? `${label(w.geraet)} · ` : ""}
                      {w.anzahl} ohne Abgleich eingelöst
                      {w.doppelt ? ` · ${w.doppelt} davon doppelt` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="aside">
                In diesen Minuten konnte das Gerät nicht gegen die anderen
                prüfen. Rot heißt: Dabei wurde ein Ticket eingelöst, das
                anderswo schon eingelöst war.
              </p>
            </section>
          )}

          {stats.konflikte.length > 0 && (
            <section className="block">
              <h2>Doppelte Einlösungen</h2>
              <ul className="entries">
                {stats.konflikte.map((c) => (
                  <li key={`${c.code}-${c.server_ts}`} className="unknown">
                    <span className="entry-code">{group(c.code)}</span>
                    <span className="entry-meta">{time(c.server_ts)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Unabhängig von den Kennzahlen. Vorher stand all das im selben
          Block wie die Zahlen — ohne Netz oder ohne ausgerollten Endpunkt
          gab es weder Abmelden noch Rückmeldung noch die Listenpflege. */}
      {/* Nur mit dem Verwaltungspasswort. Wer sich am Eingang mit dem
          Eventpasswort anmeldet, sieht diesen Abschnitt nicht. */}
      {session.admin && (
        <section className="block">
          <h2>Ticketliste pflegen</h2>
          <p className="aside">
            Namen nachtragen, Tickets ergänzen, Vermerke setzen — einzeln
            oder eine ganze Liste auf einmal einfügen.
          </p>
          <button
            type="button" className="btn wide"
            onClick={() => setShowVerwaltung(true)}
          >
            Liste bearbeiten
          </button>
        </section>
      )}

      {/* Ohne diesen Knopf kam niemand mehr an den Passwort-Bildschirm
          zurück: Die Anmeldung gilt bis 6 Uhr morgens, und wer das
          Verwaltungspasswort eingeben wollte, hatte schlicht keine
          Möglichkeit dazu. Aufgefallen ist das beim ersten Versuch, die
          Ticketliste zu pflegen. */}
      <section className="block">
        <h2>Abmelden</h2>
        <p className="aside">
          Nur nötig, um mit einem anderen Passwort neu anzumelden. Die
          Ticketliste und alles, was noch nicht gesendet ist, bleiben auf
          dem Gerät — es geht nichts verloren.
        </p>
        <button
          type="button" className="btn wide"
          onClick={() => { void store.remove("session").then(() => location.reload()); }}
        >
          Abmelden
        </button>
      </section>

      <section className="block">
        <h2>Etwas stimmt nicht?</h2>
        <p className="aside">
          Sammelt Fassung, Kameraauflösung und Stand des Geräts von selbst
          ein — die Angaben, nach denen sonst jede Fehlersuche zuerst fragt.
        </p>
        <button type="button" className="btn wide" onClick={() => setShowFeedback(true)}>
          Rückmeldung geben
        </button>
      </section>

    </div>
  );
}

function group(code: string): string {
  return code.replace(/(\d{2})(?=\d)/g, "$1 ");
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
