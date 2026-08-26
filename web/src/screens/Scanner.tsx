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

/** Der Suchrahmen, in Anteilen der angezeigten Fläche. Flach wie das Etikett,
 *  aber großzügig: Je größer der Rahmen, desto weiter weg darf das Ticket
 *  gehalten werden — die Nummer muss ihn nicht ausfüllen, nur darin liegen. */
const ROI = { x: 0.07, y: 0.36, w: 0.86, h: 0.22 };

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
  // Was gerade gelesen, aber noch nicht bestätigt wurde. Ohne diese Rückmeldung
  // weiß niemand, ob die App überhaupt etwas sieht oder nur ins Leere schaut.
  const [sighted, setSighted] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setWidth(await store.get<number>("codeWidth") ?? 5);
      setPrefix(await store.get<string>("codePrefix") ?? "");
    })();
  }, []);

  // Die Warteschlange wird an anderer Stelle geleert, sobald wieder Netz da
  // ist. Ohne regelmäßiges Nachsehen zählte diese Anzeige nur hoch und blieb
  // dann stehen — sie zeigte offene Vorgänge an, die längst angekommen waren.
  useEffect(() => {
    const check = () => void store.queueSize().then(setPending);
    check();
    const timer = window.setInterval(check, 3000);
    return () => window.clearInterval(timer);
  }, []);

  // Ob gerade Verbindung besteht, gehört sichtbar in die Leiste: Offene
  // Vorgänge ohne Netz sind normal, offene Vorgänge mit Netz sind es nicht.
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
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
        // Aus der Entfernung lesen zu können ist vor allem eine Frage der
        // Auflösung: Je mehr Bildpunkte auf der Nummer liegen, desto weiter
        // weg darf das Ticket sein. Safari liefert, was das Gerät hergibt.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
        });

        // Dauerhafter Autofokus, wo verfügbar. Ohne ihn sucht die Kamera bei
        // jedem neuen Ticket neu.
        try {
          await stream.getVideoTracks()[0]?.applyConstraints({
            advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
          });
        } catch { /* Gerät kann es nicht — dann eben nicht. */ }
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
          const reading = await readFrame(frame, width);
          setSighted(reading);

          const hit = consensus.current.offer(reading);
          if (hit) {
            consensus.current.reset();
            setSighted(null);
            await evaluate(hit);
          }
        } finally {
          busy.current = false;
        }
      };
      void tick();
    })();

    // Kommt die App aus dem Hintergrund zurück, hat iOS das Video angehalten.
    const wake = () => { if (!document.hidden) void video.current?.play(); };
    document.addEventListener("visibilitychange", wake);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", wake);
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [keypad, width, evaluate]);

  // Während Bestätigung und Ergebnis pausiert die Erkennung, damit nicht das
  // nächste Ticket dazwischenfunkt.
  useEffect(() => {
    busy.current = view.at !== "scan";
    if (view.at === "scan") { consensus.current.reset(); setSighted(null); }
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

  return (
    <div className="scanner">
      {/* Das Videobild bleibt immer eingehängt. Wurde es beim Bestätigen
          ausgetauscht, kam danach ein neues, leeres Element zurück — und der
          Bildschirm blieb schwarz, weil der Kamerastrom noch am alten hing. */}
      <div className="cam" hidden={keypad}>
        <video ref={video} playsInline muted autoPlay />
        <div className="roi" style={{
          left: `${ROI.x * 100}%`, top: `${ROI.y * 100}%`,
          width: `${ROI.w * 100}%`, height: `${ROI.h * 100}%`,
        }} />
        <p className="cam-hint">
          {sighted
            ? <span className="cam-sighted">{group(sighted)}</span>
            : "Ticketnummer in den Rahmen halten"}
        </p>
        {camError && <p className="cam-error">{camError}</p>}
      </div>

      {keypad && (
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
          {!online
            ? <em className="warn">{pending > 0 ? `ohne Netz · ${pending} wartet` : "ohne Netz"}</em>
            : pending > 0
              ? <em>{pending} wird gesendet…</em>
              : <em className="ok">gesendet</em>}
        </span>
      </div>

      {view.at === "confirm" && (
        <Confirm decision={view.decision} onYes={() => void redeem(view.decision)} onNo={backToScan} />
      )}
      {view.at === "result" && <Result decision={view.decision} onDone={backToScan} />}
    </div>
  );
}

// ------------------------------------------------------------- Bestätigung --

function Confirm({ decision, onYes, onNo }: {
  decision: Decision; onYes: () => void; onNo: () => void;
}) {
  return (
    <div className="sheet ok overlay">
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
      <div className="sheet ok full overlay" onClick={onDone}>
        <span className="sheet-big"><Icon.Check /></span>
        <p className="sheet-label">Einlass frei</p>
        <p className="sheet-code">{group(decision.code)}</p>
        <p className="sheet-meta">Abschnitt abreißen, Bändchen anlegen</p>
      </div>
    );
  }

  if (decision.verdict === "unknown") {
    return (
      <div className="sheet bad full overlay">
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
    <div className="sheet warn full overlay">
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
