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
import { Recent } from "./Recent";
import * as sync from "../lib/sync";

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
  // Getrennt vom Arbeitszustand: Endet ein laufendes Einzelbild, während der
  // Bestätigungsschritt offen ist, setzte `busy` die Erkennung sonst wieder in
  // Gang und das nächste Ticket funkte dazwischen.
  const paused = useRef(false);
  const narrow = useRef(true);

  // Nur Nummern annehmen, die tatsächlich verkauft wurden. Diese Prüfung schon
  // während der Erkennung vorzunehmen ist der wirksamste Filter überhaupt: Von
  // allem, was die Kamera sonst noch aufschnappt — Preis, Datum, Hotline,
  // Schriftzug — bleibt nichts übrig.
  const known = useRef<(code: string) => boolean>(() => false);

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
  // Wo die App das Etikett gefunden hat, und mit welcher Auflösung die Kamera
  // liefert. Beides gehört sichtbar auf den Bildschirm: Man sieht sofort, ob
  // die Erkennung greift oder ins Leere schaut.
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [source, setSource] = useState<{ w: number; h: number } | null>(null);
  const [reachable, setReachable] = useState(false);
  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    void (async () => {
      setWidth(await store.get<number>("codeWidth") ?? 5);
      setPrefix(await store.get<string>("codePrefix") ?? "");

      // Einmal in den Arbeitsspeicher: Ein Nachschlagen je Einzelbild gegen die
      // Datenbank wäre bei drei Bildern je Sekunde spürbar.
      const codes = new Set((await store.allTickets()).map((t) => t.code));
      known.current = (code) => codes.has(code);
    })();
  }, []);

  // Zustand der Übertragung.
  //
  // Abgeleitet ausschließlich daraus, wann zuletzt wirklich Kontakt zum Server
  // bestand. navigator.onLine taugt dafür nicht: Es meldet nur, ob eine
  // Netzwerkschnittstelle existiert, und steht im Flugmodus mit eingeschaltetem
  // WLAN weiterhin auf online. Ob Daten ankommen, weiß man erst, wenn sie
  // angekommen sind.
  useEffect(() => {
    const check = async () => {
      const [queued, last] = await Promise.all([
        store.queueSize(),
        store.get<string>("lastSyncAt"),
      ]);
      setPending(queued);
      // Abgeglichen wird alle 20 Sekunden. Nach drei ausgefallenen Durchläufen
      // ist der Kontakt weg und nicht bloß eine Runde ausgefallen.
      setReachable(last !== undefined && Date.now() - Date.parse(last) < 75_000);
    };
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    return () => window.clearInterval(timer);
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

    if (decision.verdict !== "ok") {
      // Auch das Abgewiesene gehört ins Protokoll: Wer später klärt, muss
      // sehen, dass hier jemand stand.
      void store.remember({
        scanId: crypto.randomUUID(), code, at: new Date().toISOString(),
        verdict: decision.verdict,
      });
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
        if (paused.current || busy.current) return;
        if (!video.current || video.current.readyState < 2) return;
        busy.current = true;
        try {
          // Abwechselnd eingegrenzt und ganzflächig. Findet die Eingrenzung
          // einmal die falsche Stelle, fängt der nächste Durchgang es auf —
          // ein Erkenner, der danebenliegt, ist schlechter als gar keiner.
          narrow.current = !narrow.current;

          const frame = prepareFrame(video.current, ROI, canvas.current, narrow.current);
          setBox(frame.box);
          setSource(frame.source);

          const codes = await readFrame(frame.canvas, width, known.current);
          setSighted(codes[0] ?? null);

          // Mehrere Treffer in einem Bild heißt: Es ist nicht eindeutig, welche
          // Nummer gemeint war. Dann lieber weiterlesen als raten.
          const hit = consensus.current.offer(codes.length === 1 ? codes[0] : null);
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
    paused.current = view.at !== "scan";
    if (view.at === "scan") { consensus.current.reset(); setSighted(null); setBox(null); }
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

    const scanId = crypto.randomUUID();
    await store.remember({ scanId, code, at: now, verdict: "ok" });

    await store.enqueue({
      scanId,
      code, clientTs: now, action: "redeem",
      // Auch hier gilt: Maßstab ist der letzte echte Serverkontakt, nicht das,
      // was der Browser über seine Netzwerkschnittstelle meint.
      offline: !reachable,
      attempts: 0,
    });

    setPending(await store.queueSize());

    setView({ at: "result", decision: { ...decision, verdict: "ok" } });
    feedback.ok();
  }

  // Als useCallback, damit die Zeitschaltung in der Ergebnisanzeige nicht bei
  // jedem Neuzeichnen der Leiste von vorn beginnt.
  const backToScan = useCallback(() => {
    setTyped("");
    setView({ at: "scan" });
  }, []);

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
        {box && (
          <div className="lock" style={{
            left: `${box.x * 100}%`, top: `${box.y * 100}%`,
            width: `${box.w * 100}%`, height: `${box.h * 100}%`,
          }} />
        )}
        <p className="cam-hint">
          {sighted
            ? <span className="cam-sighted">{group(sighted)}</span>
            : "Ticketnummer in den Rahmen halten"}
        </p>
        {source && (
          <p className="cam-source">
            {source.w}&times;{source.h}{box ? " · Text erkannt" : ""}
          </p>
        )}
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
        <button
          type="button" className="btn"
          onClick={() => setShowRecent(true)}
          aria-label="Letzte Vorgänge"
        >
          <Icon.Tear />
        </button>
        <span className="scanner-state">
          {session.label}
          {pending > 0
            ? <em className="warn">{pending} {pending === 1 ? "wartet" : "warten"}</em>
            : reachable
              ? <em className="ok">alles gesendet</em>
              : <em className="warn">kein Kontakt</em>}
        </span>
      </div>

      {view.at === "confirm" && (
        <Confirm decision={view.decision} onYes={() => void redeem(view.decision)} onNo={backToScan} />
      )}
      {view.at === "result" && (
        <Result
          decision={view.decision}
          onDone={backToScan}
          onRelease={async (code, reason) => {
            await sync.undo(code, reason);
            backToScan();
          }}
        />
      )}
      {showRecent && <Recent onClose={() => setShowRecent(false)} />}
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

function Result({ decision, onDone, onRelease }: {
  decision: Decision;
  onDone: () => void;
  onRelease: (code: string, reason: string) => Promise<void>;
}) {
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
  const trace = decision.likelyMistype;

  return (
    <div className="sheet warn full overlay">
      <p className="sheet-label">Bereits eingelöst</p>
      <p className="sheet-code">{group(decision.code)}</p>
      <p className="sheet-meta">
        {at ? `Eingelöst um ${time(at)} Uhr` : "Zeitpunkt unbekannt"}
      </p>

      {trace && (
        <div className="trace">
          <p className="trace-label">Möglicher Erfassungsfehler</p>
          <p>
            Um {time(trace.at)} wurde an diesem Gerät{" "}
            <b>{group(trace.code)}</b> erfasst — eine Ziffer Unterschied.
            Wahrscheinlich war dieses Ticket gemeint.
          </p>
        </div>
      )}

      <p className="sheet-ask">
        Ist das Ticket unversehrt, war die Person noch nicht drin — dann ist es
        ein Erfassungsfehler.
      </p>

      <div className="sheet-actions column">
        {trace && (
          <button
            type="button" className="btn primary wide"
            onClick={() => void onRelease(trace.code, `Fehlbuchung, gemeint war ${decision.code}`)}
          >
            {group(trace.code)} zurücknehmen
          </button>
        )}
        <button
          type="button" className="btn wide"
          onClick={() => void onRelease(decision.code, "Ticket unversehrt, Einlösung freigegeben")}
        >
          {group(decision.code)} freigeben und einlassen
        </button>
        <button type="button" className="btn wide" onClick={onDone}>Abweisen</button>
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
