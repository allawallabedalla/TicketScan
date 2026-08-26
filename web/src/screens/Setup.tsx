// Einrichten: Ticketliste holen und die Texterkennung vorbereiten.
//
// Beides einmalig und bewusst sichtbar, statt still im Hintergrund. Wer hier
// zusieht, weiß danach, dass das Gerät einsatzbereit ist — und wenn etwas
// fehlschlägt, fällt es am Vorabend auf und nicht am Eingang.

import { useCallback, useEffect, useState } from "react";
import * as store from "../lib/store";
import * as sync from "../lib/sync";
import { startOcr } from "../lib/ocr";
import * as Icon from "../onboarding/Icons";

type Phase = "tickets" | "ocr" | "fertig" | "fehler";

export function Setup({ session, onDone }: { session: store.Session; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("tickets");
  const [loaded, setLoaded] = useState(0);
  const [ocrRatio, setOcrRatio] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    try {
      setPhase("tickets");
      const total = await sync.bootstrap(session, setLoaded);

      // Stellenzahl und feste Vorsilbe aus den echten Daten ableiten, statt
      // sie im Code festzuschreiben: Die Tastatur blendet die Vorsilbe fest
      // ein, und jede Stelle weniger ist eine Fehlerquelle weniger.
      const codes = (await store.allTickets()).map((t) => t.code);
      const width = codes[0]?.length ?? 5;
      let prefix = codes.reduce((acc, code) => {
        let i = 0;
        while (i < acc.length && acc[i] === code[i]) i++;
        return acc.slice(0, i);
      }, codes[0] ?? "");
      prefix = prefix.slice(0, Math.max(0, width - 3));

      await store.set("codeWidth", width);
      await store.set("codePrefix", prefix);

      setPhase("ocr");
      await startOcr(setOcrRatio);

      await store.set("setupDone", true);
      setPhase("fertig");
      if (total === 0) setError("Die Ticketliste ist leer. Wurde sie schon importiert?");
    } catch (err) {
      setPhase("fehler");
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }, [session]);

  useEffect(() => { void run(); }, [run]);

  return (
    <div className="setup">
      <div className="hero-icon"><Icon.Install /></div>
      <h1>Gerät vorbereiten</h1>
      <p className="lead">
        Einmalig, am besten im WLAN. Danach arbeitet die App auch ohne Netz.
      </p>

      <ol className="steps">
        <li className={phase === "tickets" ? "on" : "done"}>
          <span className="steps-icon">{phase === "tickets" ? <Spinner /> : <Icon.Check />}</span>
          <span>
            <b>Ticketliste laden</b>
            <small>{loaded > 0 ? `${loaded} Tickets auf dem Gerät` : "wird geholt…"}</small>
          </span>
        </li>
        <li className={phase === "ocr" ? "on" : phase === "tickets" ? "" : "done"}>
          <span className="steps-icon">
            {phase === "ocr" ? <Spinner /> : phase === "tickets" ? <Icon.Camera /> : <Icon.Check />}
          </span>
          <span>
            <b>Texterkennung vorbereiten</b>
            <small>
              {phase === "ocr"
                ? `${Math.round(ocrRatio * 100)} % von 18 MB`
                : phase === "tickets" ? "danach" : "bereit"}
            </small>
          </span>
        </li>
      </ol>

      {error && <p className="error" role="alert">{error}</p>}

      {phase === "fertig" && !error && (
        <button type="button" className="btn primary wide" onClick={onDone}>
          Scanner öffnen
        </button>
      )}
      {phase === "fehler" && (
        <button type="button" className="btn primary wide" onClick={() => void run()}>
          Noch einmal versuchen
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
