// Einrichten: Ticketliste holen und die Texterkennung vorbereiten.
//
// Beides einmalig und bewusst sichtbar, statt still im Hintergrund. Wer hier
// zusieht, weiß danach, dass das Gerät einsatzbereit ist — und wenn etwas
// fehlschlägt, fällt es am Vorabend auf und nicht am Eingang.

import { type ReactNode, useCallback, useEffect, useState } from "react";
import * as store from "../lib/store";
import * as sync from "../lib/sync";
import { startOcr } from "../lib/ocr";
import * as Icon from "../onboarding/Icons";
import { Logo } from "../onboarding/Logo";

type Phase = "tickets" | "ocr" | "fertig" | "fehler";
type Step = "tickets" | "ocr";

/** Zustand eines Schrittes für die Anzeige. */
function stateOf(step: Step, phase: Phase, failedAt: Step | null) {
  if (failedAt === step) return "fehlt";
  if (phase === step) return "on";
  const order: Step[] = ["tickets", "ocr"];
  const done = failedAt
    ? order.indexOf(step) < order.indexOf(failedAt)
    : phase === "fertig" || order.indexOf(step) < order.indexOf(phase as Step);
  return done ? "done" : "";
}

export function Setup({ session, onDone }: { session: store.Session; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("tickets");
  const [loaded, setLoaded] = useState(0);
  const [ocrRatio, setOcrRatio] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Ohne diese Angabe zeigte die Liste im Fehlerfall beide Schritte als
  // erledigt an — mit grünem Haken, obwohl gerade einer gescheitert war.
  const [failedAt, setFailedAt] = useState<Step | null>(null);
  // Liegt schon eine Ticketliste auf dem Gerät? Dann ist ein gescheiterter
  // Abgleich kein Grund, den Einlass stillzulegen.
  const [onDevice, setOnDevice] = useState(0);

  const run = useCallback(async () => {
    setError(null);
    setFailedAt(null);
    let at: Step = "tickets";
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

      at = "ocr";
      setPhase("ocr");
      await startOcr(setOcrRatio);

      await store.set("setupDone", true);
      setPhase("fertig");
      if (total === 0) setError("Die Ticketliste ist leer. Wurde sie schon importiert?");
    } catch (err) {
      setPhase("fehler");
      setFailedAt(at);
      setOnDevice(await store.countTickets().catch(() => 0));
      // Lieber eine hässliche technische Meldung als „Unbekannter Fehler“ —
      // die Einrichtung passiert am Vorabend, da darf man etwas nachschlagen.
      setError(
        err instanceof Error
          ? `${err.message}${err.cause ? ` (${String(err.cause)})` : ""}`
          : String(err),
      );
    }
  }, [session]);

  useEffect(() => { void run(); }, [run]);

  return (
    <div className="setup">
      <Logo className="logo-lead" label="Herzberg Festival" />
      <h1>Gerät vorbereiten</h1>
      <p className="lead">
        Einmalig, am besten im WLAN. Danach arbeitet die App auch ohne Netz.
      </p>

      <ol className="steps">
        <StepRow
          state={stateOf("tickets", phase, failedAt)}
          title="Ticketliste laden"
          detail={loaded > 0 ? `${loaded} Tickets auf dem Gerät` : "wird geholt…"}
          idle={<Icon.Install />}
        />
        <StepRow
          state={stateOf("ocr", phase, failedAt)}
          title="Texterkennung vorbereiten"
          detail={
            phase === "ocr"
              ? `${Math.round(ocrRatio * 100)} % von rund 14 MB`
              : failedAt === "ocr" ? "nicht geladen"
              : phase === "tickets" ? "danach" : "bereit"
          }
          idle={<Icon.Camera />}
        />
      </ol>

      {error && <p className="error" role="alert">{error}</p>}

      {phase === "fertig" && !error && (
        <button type="button" className="btn primary wide" onClick={onDone}>
          Scanner öffnen
        </button>
      )}
      {phase === "fehler" && (
        <>
          <button type="button" className="btn primary wide" onClick={() => void run()}>
            Noch einmal versuchen
          </button>
          {/* Der Ausweg, der vorher fehlte.
              Ohne ihn strandete ein Gerät mit vollständiger Ticketliste,
              fertiger Texterkennung und gültigem Passwort auf diesem
              Bildschirm, sobald der Abgleich kein Netz fand — und es gab
              keinen Weg daran vorbei. Eines von zehn Geräten fiel damit für
              den Rest der Nacht aus. */}
          {onDevice > 0 && (
            <button
              type="button" className="btn wide"
              onClick={() => { void store.set("setupDone", true).then(onDone); }}
            >
              Mit den {onDevice} Tickets von zuletzt weiterarbeiten
            </button>
          )}
        </>
      )}

      <p className="build">Fassung {__BUILD__}</p>
    </div>
  );
}

function StepRow({ state, title, detail, idle }: {
  state: string; title: string; detail: string; idle: ReactNode;
}) {
  return (
    <li className={state}>
      <span className="steps-icon">
        {state === "on" ? <Spinner />
          : state === "done" ? <Icon.Check />
          : state === "fehlt" ? <Icon.Warning />
          : idle}
      </span>
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
    </li>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
