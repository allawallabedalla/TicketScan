// Der Bildschirm, der im Betrieb zählt.
//
// Kamera mit Suchrahmen, Zifferntastatur als gleichberechtigter zweiter Weg,
// Bestätigungsschritt, ganzflächige Rückmeldung. Jede Entscheidung fällt
// lokal; der Server erfährt sie hinterher.

import { useCallback, useEffect, useRef, useState } from "react";
import { Consensus, hasFrame, prepareFrame, readFrame, startOcr, stopOcr } from "../lib/ocr";
import { decide, normalize, type Decision } from "../lib/decide";
import { feedback } from "../lib/feedback";
import * as store from "../lib/store";
import * as Icon from "../onboarding/Icons";
import { Recent } from "./Recent";
import { Tickets } from "./Tickets";
import { Dashboard } from "./Dashboard";
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
  const [showList, setShowList] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [loaded, setLoaded] = useState<number | null>(null);
  const lastSize = useRef<string | null>(null);
  const lastStamp = useRef(-1);
  const hidden = useRef(false);
  // Sperre gegen Doppeltippen: `redeem` ist asynchron, der Knopf hatte kein
  // disabled. Ein Doppeltipp im Gedränge buchte zweimal — zwei Einträge im
  // Verlauf, zwei in der Warteschlange, „2 warten" für eine Person.
  const booking = useRef(false);
  const [busyAction, setBusyAction] = useState(false);

  const refreshKnown = useCallback(async () => {
    // Einmal in den Arbeitsspeicher: Ein Nachschlagen je Einzelbild gegen die
    // Datenbank wäre bei drei Bildern je Sekunde spürbar.
    const codes = new Set((await store.allTickets()).map((t) => t.code));
    known.current = (code) => codes.has(code);
    setLoaded(codes.size);
  }, []);

  useEffect(() => {
    void (async () => {
      setWidth(await store.get<number>("codeWidth") ?? 5);
      setPrefix(await store.get<string>("codePrefix") ?? "");

      await refreshKnown();
    })();
  }, [refreshKnown]);

  // Nachträglich importierte Tickets waren für die Kamera unsichtbar.
  //
  // `known` ist der wirksamste Filter der Erkennung — angenommen wird nur, was
  // in der Liste steht. Wurde das Set einmal beim Öffnen des Scanners gebaut,
  // las die Kamera Nummern, die die Abendkasse um 21:30 nachgetragen hat,
  // nicht schlecht, sondern gar nicht, und ohne jede Meldung. Über die
  // Tastatur ging es weiter, aber niemand wusste das.
  //
  // Dieselbe Stelle fängt den umgekehrten Fall ab: Räumt iOS den Speicher im
  // laufenden Betrieb, fällt `loaded` auf 0 und die Warnung erscheint.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const n = await store.countTickets();
        if (n !== loaded) await refreshKnown();
      })();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loaded, refreshKnown]);

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
      // Abgeglichen wird alle acht Sekunden. Nach etwa drei ausgefallenen
      // Durchläufen ist der Kontakt weg und nicht bloß eine Runde ausgefallen.
      // Vorher standen hier 75 Sekunden — über eine Minute lang behauptete die
      // Zeile „alles gesendet", während längst nichts mehr ankam.
      setReachable(last !== undefined && Date.now() - Date.parse(last) < sync.CONTACT_WINDOW);
    };
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    return () => window.clearInterval(timer);
  }, []);

  // ------------------------------------------------------------- Entscheiden --

  const evaluate = useCallback(async (code: string) => {
    const ticket = await store.getTicket(code);
    const decision = decide(code, ticket);

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
      } catch (err) {
        setCamError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Die Kamera ist nicht freigegeben. Tippe unten auf Tastatur und gib die Nummer ein."
            : "Die Kamera lässt sich nicht öffnen. Die Tastatur funktioniert weiter.",
        );
        return;
      }

      // Getrennt vom Kamerafehler.
      //
      // startOcr baut eigens eine Meldung, die die fehlende Datei nennt —
      // genau das Szenario, für das vendor-ocr.mjs geschrieben wurde. Lag der
      // Aufruf im selben try, wurde daraus „Die Kamera lässt sich nicht
      // öffnen", obwohl das Kamerabild sichtbar war. Die Fehlersuche lief
      // damit in die falsche Richtung.
      try {
        await startOcr();
      } catch (err) {
        setCamError(err instanceof Error
          ? `Texterkennung nicht bereit: ${err.message} Die Tastatur funktioniert weiter.`
          : "Texterkennung nicht bereit. Die Tastatur funktioniert weiter.");
        return;
      }

      const tick = async () => {
        if (stopped) return;
        timer = window.setTimeout(() => void tick(), READ_INTERVAL);

        // Nur lesen, wenn gerade auch gescannt wird — nicht im
        // Bestätigungsschritt und nicht, während schon ein Bild läuft.
        if (paused.current || busy.current) return;
        if (!video.current || video.current.readyState < 2) return;
        if (!hasFrame(video.current)) return;
        // Nur ein tatsächlich neues Bild zählt. Steht das Video still — App im
        // Hintergrund, Bildschirm gesperrt —, ergäben zwei Lesungen desselben
        // Standbilds eine Bestätigung, und die Mehrfachbestätigung wäre genau
        // dann aufgehoben, wenn niemand hinsieht.
        if (video.current.currentTime === lastStamp.current) return;
        lastStamp.current = video.current.currentTime;
        busy.current = true;
        try {
          // Abwechselnd eingegrenzt und ganzflächig. Findet die Eingrenzung
          // einmal die falsche Stelle, fängt der nächste Durchgang es auf —
          // ein Erkenner, der danebenliegt, ist schlechter als gar keiner.
          narrow.current = !narrow.current;

          const frame = prepareFrame(video.current, ROI, canvas.current, narrow.current);
          // Nur die eingegrenzten Durchgänge liefern eine Fundstelle. Würde die
          // Anzeige auch den ganzflächigen übernehmen, verschwände der Kasten
          // jedes zweite Bild und flackerte mit knapp zwei Hertz.
          if (narrow.current) setBox(frame.box);
          setSource(frame.source);
          // Nur bei Änderung schreiben. Vorher lief das in jedem Bild, also
          // dreieinhalb Mal je Sekunde über den ganzen Abend — rund 77 000
          // Transaktionen auf demselben Speicher, in dem auch der Verlauf liegt.
          const size = frame.source.w ? `${frame.source.w}×${frame.source.h}` : null;
          if (size && size !== lastSize.current) {
            lastSize.current = size;
            void store.set("cameraSize", size);
          }

          const codes = await readFrame(frame.canvas, width, known.current);
          // Zwischen Anforderung und Antwort liegen 200 bis 400 Millisekunden.
          // In dieser Zeit kann jemand auf „Tastatur" getippt haben. Ohne diese
          // Prüfung öffnete das Ergebnis dann einen Bestätigungsschritt über
          // der Zifferntastatur — für ein Ticket, das gerade aufgegeben wurde.
          if (stopped || paused.current) return;
          setSighted(codes[0] ?? null);

          // Mehrere Treffer in einem Bild heißt: Es ist nicht eindeutig, welche
          // Nummer gemeint war. Dann lieber weiterlesen als raten.
          const hit = consensus.current.offer(codes.length === 1 ? codes[0] : null);
          if (hit) {
            consensus.current.reset();
            setSighted(null);
            await evaluate(hit);
          }
        } catch {
          // Ein einzelnes Bild darf scheitern — drawImage wirft, wenn die
          // Kamera nach der Rückkehr aus dem Hintergrund kurz 0×0 meldet.
          // Ohne diesen Zweig wurde daraus eine unbehandelte Ablehnung, und
          // zwar bei jedem folgenden Bild erneut.
        } finally {
          busy.current = false;
        }
      };
      void tick();
    })();

    // Kommt die App aus dem Hintergrund zurück, hat iOS das Video angehalten.
    //
    // Und: Im Hintergrund wird nicht gelesen. Vorher lief die Schleife auf dem
    // eingefrorenen letzten Bild weiter — beim Entsperren stand dann ein
    // Bestätigungsschritt offen für ein Ticket, das vor der Sperre in der Hand
    // lag. Ein Reflex-Tipp auf „Einlassen" hätte es gebucht.
    const wake = () => {
      hidden.current = document.hidden;
      if (document.hidden) return;
      consensus.current.reset();
      setSighted(null);
      setBox(null);
      void video.current?.play();
    };
    document.addEventListener("visibilitychange", wake);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", wake);
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      // Sonst lägen nach der Rückkehr von der Tastatur bis zu vier alte
      // Lesungen im Puffer: Eine einzelne frische Lesung derselben Nummer
      // erreichte sofort die geforderten zwei — die Mehrfachbestätigung wäre
      // für genau diesen Fall ausgehebelt.
      consensus.current.reset();
      // Der Worker samt WebAssembly-Speicher blieb sonst für die gesamte
      // Lebensdauer der Seite bestehen — auch während der Tastatureingabe, in
      // der Liste, in der Übersicht. Auf iOS ist genau das der Grund, warum
      // eine Web-App im Hintergrund verworfen wird und beim Zurückholen neu
      // lädt.
      if (keypad) void stopOcr();
    };
  }, [keypad, width, evaluate]);

  // Während Bestätigung und Ergebnis pausiert die Erkennung, damit nicht das
  // nächste Ticket dazwischenfunkt.
  useEffect(() => {
    // Auch offene Listen halten die Erkennung an: Sonst läuft im Hintergrund
    // ein Ticket durch, während jemand den Verlauf durchsieht.
    paused.current = view.at !== "scan" || showRecent || showList || showStats || hidden.current;
    if (view.at === "scan") { consensus.current.reset(); setSighted(null); setBox(null); }
  }, [view, showRecent, showList, showStats]);

  // ------------------------------------------------------------------ Buchen --

  async function redeem(decision: Decision) {
    // Doppeltipp und Doppelbuchung ausschließen.
    if (booking.current) return;
    booking.current = true;
    setBusyAction(true);
    try {
      await buche(decision);
    } finally {
      booking.current = false;
      setBusyAction(false);
    }
  }

  async function buche(decision: Decision) {
    const code = decision.code;
    const now = new Date().toISOString();

    // Frisch nachlesen statt der Kopie aus dem Scan.
    //
    // Zwischen Lesen und Bestätigen können Minuten liegen — jemand spricht den
    // Einlasser an, das Ticket liegt derweil auf dem Tresen. Löst in dieser
    // Zeit ein anderes Gerät dasselbe Ticket ein, hatte die App die
    // Doppeleinlösung längst im Speicher und warf sie mit der alten Kopie
    // wieder weg. Statt zu buchen wird deshalb erneut entschieden.
    const ticket = await store.getTicket(code);
    if (ticket?.redeemedAt) {
      setView({ at: "result", decision: decide(code, ticket) });
      feedback.duplicate();
      return;
    }

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

  /**
   * Gibt das vorgelegte Ticket frei UND lässt die Person ein.
   *
   * Der Knopf hieß von Anfang an „freigeben und einlassen", tat aber nur das
   * Erste. Die Person ging mit Bändchen hinein, und das Ticket stand danach
   * auf allen Geräten wieder auf offen — wer es weiterreichte oder fand, kam
   * ein zweites Mal rein. Zusätzlich zählte die Übersicht eine Einlösung zu
   * wenig, und der Bändchenabgleich schlug Alarm, obwohl alles richtig
   * gemacht worden war.
   */
  async function override(decision: Decision) {
    if (booking.current) return;
    booking.current = true;
    setBusyAction(true);
    try {
      await sync.undo(decision.code, "Ticket unversehrt, Einlösung freigegeben");
      await markiereZurueckgenommen(decision.code);
      const ticket = await store.getTicket(decision.code);
      await buche({ ...decision, verdict: "ok", ticket });
    } finally {
      booking.current = false;
      setBusyAction(false);
    }
  }

  /** Trägt die Rücknahme im Verlauf dieses Geräts nach. */
  async function markiereZurueckgenommen(code: string) {
    const eintrag = (await store.history()).find(
      (e) => e.code === code && e.verdict === "ok" && !e.undoneAt,
    );
    if (eintrag) {
      await store.amend(eintrag.scanId, { undoneAt: new Date().toISOString() });
    }
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

      <div className="scanner-foot">
        {/* Der Status hat eine eigene Zeile: In der Knopfreihe wurde er auf
            schmalen Telefonen abgeschnitten — ausgerechnet die Angabe, ob
            noch etwas ungesendet ist. */}
        <button
          type="button" className="scanner-state as-button"
          onClick={() => setShowStats(true)}
        >
          <span className="state-name">
            <Icon.Chart /><span className="state-label">{session.label}</span>
          </span>
          {pending > 0
            ? <em className="warn">{pending} {pending === 1 ? "wartet" : "warten"}</em>
            : reachable
              ? <em className="ok">alles gesendet</em>
              : <em className="warn">kein Kontakt</em>}
          <span className="state-more">Übersicht</span>
        </button>

        {/* Beschriftet, nicht nur bebildert: Am Eingang steht jemand, der die
            App zum ersten Mal in der Hand hat. Ein Symbol allein muss geraten
            werden, ein Wort daneben nicht. */}
        <div className="scanner-bar">
          <button
            type="button" className="btn"
            onClick={() => { setKeypad(!keypad); setTyped(""); }}
          >
            {keypad ? <><Icon.Camera /> Kamera</> : <><Icon.Keypad /> Tastatur</>}
          </button>
          <button type="button" className="btn" onClick={() => setShowList(true)}>
            <Icon.List /> Liste
          </button>
          <button type="button" className="btn" onClick={() => setShowRecent(true)}>
            <Icon.History /> Verlauf
          </button>
        </div>
      </div>

      {loaded === 0 && (
        <div className="sheet bad full overlay">
          <span className="sheet-big"><Icon.Warning /></span>
          <p className="sheet-label">Keine Ticketliste auf dem Gerät</p>
          <p className="sheet-meta">
            Jede Nummer würde jetzt als unbekannt abgewiesen. Das Gerät muss
            einmal neu eingerichtet werden — dafür braucht es Netz.
          </p>
          <div className="sheet-actions">
            <button
              type="button" className="btn primary wide"
              onClick={() => { void store.remove("setupDone").then(() => location.reload()); }}
            >
              Neu einrichten
            </button>
          </div>
        </div>
      )}
      {view.at === "confirm" && (
        <Confirm
          decision={view.decision} busy={busyAction}
          onYes={() => void redeem(view.decision)} onNo={backToScan}
        />
      )}
      {view.at === "result" && (
        <Result
          decision={view.decision}
          busy={busyAction}
          onDone={backToScan}
          onOverride={(decision) => void override(decision)}
        />
      )}
      {showRecent && <Recent onClose={() => setShowRecent(false)} />}
      {showStats && <Dashboard session={session} onClose={() => setShowStats(false)} />}
      {showList && (
        <Tickets
          onClose={() => setShowList(false)}
          onPick={(code) => { setShowList(false); void evaluate(code); }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------- Bestätigung --

// Der Name ist die zweite Probe neben der Nummer: Bei 2305 fortlaufenden
// Nummern trifft eine falsch gelesene Ziffer mit hoher Wahrscheinlichkeit ein
// anderes gültiges Ticket — der Name fällt dann auf, die Nummer nicht.
//
// Er ist aber nur eine Probe, kein Ausweis: Tickets ohne Namen sind normal
// (Abendkasse, Gästeliste, weitergegeben). Fehlt er, wird das ruhig gesagt,
// nicht als Warnung — sonst weist jemand aus Unsicherheit Gäste ab.
function Holder({ ticket }: { ticket?: store.Ticket }) {
  if (!ticket?.holderName) return <p className="sheet-name none">Kein Name hinterlegt</p>;
  return <p className="sheet-name">{ticket.holderName}</p>;
}

function Confirm({ decision, busy, onYes, onNo }: {
  decision: Decision; busy: boolean; onYes: () => void; onNo: () => void;
}) {
  return (
    <div className="sheet ok overlay">
      <p className="sheet-label">Gültig</p>
      <p className="sheet-code">{group(decision.code)}</p>
      <Holder ticket={decision.ticket} />
      <p className="sheet-meta">{decision.ticket?.category}</p>
      {decision.ticket?.note && <p className="sheet-note">{decision.ticket.note}</p>}
      <p className="sheet-ask">
        {decision.ticket?.holderName
          ? "Stimmt die Nummer mit dem Ticket überein?"
          : "Stimmt die Nummer mit dem Ticket überein? Ein Name ist zu diesem Ticket nicht hinterlegt — das ist kein Grund, jemanden abzuweisen."}
      </p>
      <div className="sheet-actions">
        <button type="button" className="btn" onClick={onNo}>Abbrechen</button>
        <button type="button" className="btn primary grow" disabled={busy} onClick={onYes}>
          {busy ? "…" : "Einlassen"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Ergebnis --

function Result({ decision, busy, onDone, onOverride }: {
  decision: Decision;
  busy: boolean;
  onDone: () => void;
  onOverride: (decision: Decision) => void;
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
        {decision.ticket?.holderName && (
          <p className="sheet-name">{decision.ticket.holderName}</p>
        )}
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
      <span className="sheet-big"><Icon.History /></span>
      <p className="sheet-label">Bereits eingelöst</p>
      <p className="sheet-code">{group(decision.code)}</p>
      {decision.ticket?.holderName && (
        <p className="sheet-name">{decision.ticket.holderName}</p>
      )}
      <p className="sheet-meta">
        {at ? `Eingelöst um ${time(at)} Uhr` : "Zeitpunkt unbekannt"}
      </p>

      <p className="sheet-ask">
        Ist das Ticket unversehrt und war die Person noch nicht drin, war es ein
        Erfassungsfehler — dann einlassen.
      </p>

      <div className="sheet-actions column">
        <button
          type="button" className="btn wide" disabled={busy}
          onClick={() => onOverride(decision)}
        >
          {busy ? "…" : "Trotzdem einlassen"}
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
      {prefix.length > 0 && (
        <p className="keypad-hint">
          {prefix.length === 1 ? "Die erste Ziffer steht fest" : `Die ersten ${prefix.length} Ziffern stehen fest`}
        </p>
      )}

      <div className="keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="key" onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className="key soft" aria-label="Letzte Ziffer löschen"
          onClick={() => { feedback.tick(); onChange(value.slice(0, -1)); }}>
          ←
        </button>
        <button type="button" className="key" onClick={() => press("0")}>0</button>
        <button
          type="button" className="key go" disabled={!full}
          aria-label="Nummer prüfen" onClick={onSubmit}
        >
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
