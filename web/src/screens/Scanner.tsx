// Der Bildschirm, der im Betrieb zählt.
//
// Kamera mit Suchrahmen, Zifferntastatur als gleichberechtigter zweiter Weg,
// Bestätigungsschritt, ganzflächige Rückmeldung. Jede Entscheidung fällt
// lokal; der Server erfährt sie hinterher.

import { useCallback, useEffect, useRef, useState } from "react";
import { Consensus, prepareFrame, readFrame, startOcr } from "../lib/ocr";
import { decide, findLikelyMistype, normalize, type Decision } from "../lib/decide";
import { feedback } from "../lib/feedback";
import * as store from "../lib/store";
import * as Icon from "../onboarding/Icons";

/** Der Suchrahmen, in Anteilen des Bildes. Flach wie das Etikett. */
const ROI = { x: 0.12, y: 0.42, w: 0.76, h: 0.16 };

/** Zwischen zwei Leseversuchen. Schneller bringt nichts — die Hand braucht
 *  ohnehin länger, um das Ticket ruhig zu halten. */
const READ_INTERVAL = 280;

type View =
  | { at: "scan" }
  | { at: "confirm"; decision: Decision }
  | { at: "result"; decision: Decision };

export function Scanner({ session }: { session: store.Session }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const consensus = useRef(new Consensus());
  const busy = useRef(false);

  const [view, setView] = useState<View>({ at: "scan" });
  const [keypad, setKeypad] = useState(false);
  const [typed, setTyped] = useState("");
  const [camError, setCamError] = useState<string | null>(null);
  const [width, setWidth] = useState(5);
  const [prefix, setPrefix] = useState("0");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void (async () => {
      setWidth(await store.get<number>("codeWidth") ?? 5);
      setPrefix(await store.get<string>("codePrefix") ?? "");
      setPending(await store.queueSize());
    })();
  }, []);

  // ------------------------------------------------------------- Entscheiden --

  const evaluate = useCallback(async (code: string) => {
    const ticket = await store.getTicket(code);
    const decision = decide(code, ticket);

    if (decision.verdict === "duplicate") {
      // Bei fortlaufenden Nummern lässt sich ein Vertipper sehr genau
      // lokalisieren — siehe Konzept, Abschnitt 01.
      decision.likelyMistype = findLikelyMistype(
        code, await store.allTickets(), session.deviceId,
      );
    }

    if (decision.verdict === "ok") {
      // Grün heißt hier noch nicht eingelöst: erst der Bestätigungsschritt
      // bucht. Dieser Blick aufs Ticket ist die wirksamste Absicherung gegen
      // Erfassungsfehler und deshalb nicht abschaltbar.
      setView({ at: "confirm", decision });
      feedback.tick();
    } else {
      setView({ at: "result", decision });
      decision.verdict === "duplicate" ? feedback.duplicate() : feedback.unknown();
    }
  }, [session.deviceId]);

  // ------------------------------------------------------------------ Kamera --

  useEffect(() => {
    if (keypad) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        await startOcr();
      } catch (err) {
        setCamError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Die Kamera ist nicht freigegeben. Tippe unten auf Tastatur und gib die Nummer ein."
            : "Die Kamera lässt sich nicht öffnen. Die Tastatur funktioniert weiter.",
        );
        return;
      }

      const tick = async () => {
        if (stopped) return;
        timer = window.setTimeout(() => void tick(), READ_INTERVAL);

        // Nur lesen, wenn gerade auch gescannt wird — nicht im
        // Bestätigungsschritt und nicht, während schon ein Bild läuft.
        if (busy.current || !video.current || video.current.readyState < 2) return;
        busy.current = true;
        try {
          const frame = prepareFrame(video.current, ROI, canvas.current);
          const hit = consensus.current.offer(await readFrame(frame, width));
          if (hit) {
            consensus.current.reset();
            await evaluate(hit);
          }
        } finally {
          busy.current = false;
        }
      };
      void tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [keypad, width, evaluate]);

  // Während Bestätigung und Ergebnis pausiert die Erkennung, damit nicht das
  // nächste Ticket dazwischenfunkt.
  useEffect(() => {
    busy.current = view.at !== "scan";
    if (view.at === "scan") consensus.current.reset();
  }, [view]);

  // ------------------------------------------------------------------ Buchen --

  async function redeem(decision: Decision) {
    const code = decision.code;
    const now = new Date().toISOString();

    const ticket = decision.ticket;
    if (ticket) {
      await store.putTickets([{
        ...ticket, redeemedAt: now, redeemedByDevice: session.deviceId, pending: true,
      }]);
    }

    await store.enqueue({
      scanId: crypto.randomUUID(),
      code, clientTs: now, action: "redeem",
      offline: !navigator.onLine,
      attempts: 0,
    });

    setPending(await store.queueSize());
    setView({ at: "result", decision: { ...decision, verdict: "ok" } });
    feedback.ok();
  }

  function backToScan() {
    setTyped("");
    setView({ at: "scan" });
  }

  // --------------------------------------------------------------- Darstellung --

  if (view.at === "confirm") {
    return <Confirm decision={view.decision} onYes={() => void redeem(view.decision)} onNo={backToScan} />;
  }
  if (view.at === "result") {
    return <Result decision={view.decision} onDone={backToScan} />;
  }

  return (
    <div className="scanner">
      {!keypad ? (
        <div className="cam">
          <video ref={video} playsInline muted autoPlay />
          <div className="roi" style={{
            left: `${ROI.x * 100}%`, top: `${ROI.y * 100}%`,
            width: `${ROI.w * 100}%`, height: `${ROI.h * 100}%`,
          }} />
          <p className="cam-hint">Ticketnummer in den Rahmen halten</p>
          {camError && <p className="cam-error">{camError}</p>}
        </div>
      ) : (
        <Keypad
          value={typed} width={width} prefix={prefix}
          onChange={setTyped}
          onSubmit={() => {
            const code = normalize(prefix + typed, width);
            if (code) void evaluate(code);
          }}
        />
      )}

      <div className="scanner-bar">
        <button type="button" className="btn" onClick={() => { setKeypad(!keypad); setTyped(""); }}>
          {keypad ? <><Icon.Camera /> Kamera</> : <><Icon.Keypad /> Tastatur</>}
        </button>
        <span className="scanner-state">
          {session.label}
          {pending > 0 && <em>{pending} offen</em>}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Bestätigung --

function Confirm({ decision, onYes, onNo }: {
  decision: Decision; onYes: () => void; onNo: () => void;
}) {
  return (
    <div className="sheet ok">
      <p className="sheet-label">Gültig</p>
      <p className="sheet-code">{group(decision.code)}</p>
      <p className="sheet-meta">{decision.ticket?.category}</p>
      {decision.ticket?.note && <p className="sheet-note">{decision.ticket.note}</p>}
      <p className="sheet-ask">Stimmt die Nummer mit dem Ticket überein?</p>
      <div className="sheet-actions">
        <button type="button" className="btn" onClick={onNo}>Abbrechen</button>
        <button type="button" className="btn primary grow" onClick={onYes}>Einlassen</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Ergebnis --

function Result({ decision, onDone }: { decision: Decision; onDone: () => void }) {
  // Grün verschwindet von selbst — bei den anderen beiden soll jemand
  // hinsehen und entscheiden.
  useEffect(() => {
    if (decision.verdict !== "ok") return;
    const timer = window.setTimeout(onDone, 1400);
    return () => window.clearTimeout(timer);
  }, [decision, onDone]);

  if (decision.verdict === "ok") {
    return (
      <div className="sheet ok full" onClick={onDone}>
        <span className="sheet-big"><Icon.Check /></span>
        <p className="sheet-label">Einlass frei</p>
        <p className="sheet-code">{group(decision.code)}</p>
        <p className="sheet-meta">Abschnitt abreißen, Bändchen anlegen</p>
      </div>
    );
  }

  if (decision.verdict === "unknown") {
    return (
      <div className="sheet bad full">
        <span className="sheet-big"><Icon.Warning /></span>
        <p className="sheet-label">Unbekannte Nummer</p>
        <p className="sheet-code">{group(decision.code)}</p>
        <p className="sheet-meta">
          Diese Nummer steht nicht in der Ticketliste. Nummer noch einmal prüfen —
          stimmt sie, an die Einlassleitung verweisen.
        </p>
        <div className="sheet-actions">
          <button type="button" className="btn primary wide" onClick={onDone}>Weiter</button>
        </div>
      </div>
    );
  }

  const at = decision.ticket?.redeemedAt;
  return (
    <div className="sheet warn full">
      <p className="sheet-label">Bereits eingelöst</p>
      <p className="sheet-code">{group(decision.code)}</p>
      <p className="sheet-meta">
        {at ? `Eingelöst um ${time(at)} Uhr` : "Zeitpunkt unbekannt"}
      </p>

      {decision.likelyMistype && (
        <div className="trace">
          <p className="trace-label">Möglicher Erfassungsfehler</p>
          <p>
            Um {time(decision.likelyMistype.at)} wurde an diesem Gerät{" "}
            <b>{group(decision.likelyMistype.code)}</b> erfasst — eine Ziffer
            Unterschied. Wahrscheinlich war dieses Ticket gemeint.
          </p>
        </div>
      )}

      <p className="sheet-ask">
        Ist das Ticket unversehrt, war die Person noch nicht drin — dann ist es
        ein Erfassungsfehler.
      </p>
      <div className="sheet-actions">
        <button type="button" className="btn primary grow" onClick={onDone}>Weiter</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Tastatur --

function Keypad({ value, width, prefix, onChange, onSubmit }: {
  value: string; width: number; prefix: string;
  onChange: (v: string) => void; onSubmit: () => void;
}) {
  const free = width - prefix.length;
  const full = value.length === free;

  const press = (digit: string) => {
    if (value.length >= free) return;
    feedback.tick();
    onChange(value + digit);
  };

  return (
    <div className="keypad">
      <p className="keypad-echo">
        <span className="fixed">{prefix}</span>
        {value.padEnd(free, "·").split("").map((c, i) => (
          <span key={i} className={c === "·" ? "slot" : ""}>{c}</span>
        ))}
      </p>
      <p className="keypad-hint">Die erste Ziffer steht fest</p>

      <div className="keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="key" onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className="key soft"
          onClick={() => { feedback.tick(); onChange(value.slice(0, -1)); }}>
          ←
        </button>
        <button type="button" className="key" onClick={() => press("0")}>0</button>
        <button type="button" className="key go" disabled={!full} onClick={onSubmit}>
          <Icon.Check />
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Hilfsmittel --

/** Zweiergruppen sind deutlich schneller mit dem Papier zu vergleichen als
 *  eine durchgehende Ziffernfolge. */
function group(code: string): string {
  return code.replace(/(\d{2})(?=\d)/g, "$1 ");
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
