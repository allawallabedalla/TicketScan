// Ticketliste pflegen — aus der App heraus, ohne Dashboard und ohne Terminal.
//
// Zwei Wege, weil es zwei Aufgaben sind:
//
//   Einzeln — eine Nummer suchen, Namen eintippen, fertig. Für den Anruf
//   „bei 00425 fehlt der Name“.
//
//   Als Liste einfügen — der Organisator schickt eine Tabelle, die kommt hier
//   per Zwischenablage rein. Das ist der eigentliche Grund für diesen
//   Bildschirm: 2305 Zeilen einzeln zu tippen macht niemand.
//
// Was hier NICHT geht, und zwar mit Absicht: den Einlassstand ändern und
// Tickets löschen. Der Endpunkt nimmt beides gar nicht entgegen. Wer eine
// Einlösung zurücknehmen will, tut das im Verlauf — das hinterlässt eine Spur
// im Protokoll, ein überschriebenes Feld nicht.

import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/api";
import * as store from "../lib/store";
import * as sync from "../lib/sync";
import * as Icon from "../onboarding/Icons";

/** Der Endpunkt nimmt 500 Zeilen je Anfrage. 2305 sind damit fünf Anfragen. */
const BLOCK = 500;

/** Wie viele Zeilen auf einmal in den Baum gehen, und wie viele beim
 *  Weiterblättern dazukommen. 2305 gleichzeitig machen das Blättern auf einem
 *  älteren Gerät spürbar zäh. */
const STEP = 80;

type Zeile = {
  code: string; holderName: string | null; category: string; note: string | null;
  gesperrt: string | null;
};

export function Verwaltung({ session, onClose }: {
  session: store.Session;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"einzeln" | "liste">("einzeln");
  const scroller = useRef<HTMLDivElement>(null);

  return (
    <div className="sheet overlay list" ref={scroller}>
      <header className="list-head">
        <h1>Ticketliste pflegen</h1>
        <button type="button" className="btn" onClick={onClose}>Schließen</button>
      </header>

      <div className="tabs" role="group" aria-label="Art der Änderung">
        <button
          type="button" aria-pressed={tab === "einzeln"}
          className={tab === "einzeln" ? "tab on" : "tab"}
          onClick={() => setTab("einzeln")}
        >
          Einzeln
        </button>
        <button
          type="button" aria-pressed={tab === "liste"}
          className={tab === "liste" ? "tab on" : "tab"}
          onClick={() => setTab("liste")}
        >
          Liste einfügen
        </button>
      </div>

      {tab === "einzeln"
        ? <Einzeln session={session} scroller={scroller} />
        : <AlsListe session={session} />}

      <p className="aside">
        Der Einlassstand lässt sich hier nicht ändern — weder setzen noch
        löschen. Eine Einlösung nimmt man im <b>Verlauf</b> zurück; das steht
        dann auch im Protokoll.
      </p>
    </div>
  );
}

// --------------------------------------------------------------- Einzeln --

function Einzeln({ session, scroller }: {
  session: store.Session;
  scroller: React.RefObject<HTMLDivElement>;
}) {
  const [alle, setAlle] = useState<store.Ticket[]>([]);
  const [query, setQuery] = useState("");
  const [offen, setOffen] = useState<Zeile | null>(null);
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [limit, setLimit] = useState(STEP);

  useEffect(() => { void store.allTickets().then(setAlle); }, [meldung]);

  /**
   * Ein leeres Feld heißt „alles", nicht „nichts".
   *
   * Vorher zeigte die Suche erst ab zwei Zeichen etwas an — davor eine leere
   * Fläche, auf der nicht zu erkennen war, ob überhaupt Tickets da sind. Das
   * hier ist ein Filter, kein Suchschlitz: Ohne Eingabe steht die ganze Liste
   * da, und jede Eingabe engt sie ein.
   */
  const treffer = useMemo(() => {
    const ziffern = query.replace(/\D/g, "");
    const text = query.trim().toLowerCase();
    // Ziffern schlagen Buchstaben: Wer eine Nummer eintippt, sucht eine Nummer.
    if (ziffern.length >= 1) return alle.filter((t) => t.code.includes(ziffern));
    if (text.length >= 1) {
      return alle.filter((t) => t.holderName?.toLowerCase().includes(text));
    }
    return alle;
  }, [alle, query]);

  // Jede neue Eingabe fängt oben an — sonst bliebe die Liste an der Stelle
  // stehen, an der man vorher war.
  useEffect(() => {
    setLimit(STEP);
    scroller.current?.scrollTo({ top: 0 });
  }, [query, scroller]);

  // Nachladen beim Blättern, am Scrollbereich der ganzen Fläche.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 500) {
        setLimit((n) => n + STEP);
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [scroller]);

  const sichtbar = treffer.slice(0, limit);

  async function speichern() {
    if (!offen) return;
    setBusy(true);
    setFehler(null);
    try {
      // Nur senden, was sich gegenüber dem Stand beim Öffnen geändert hat.
      // Vorher ging der ganze Datensatz aus der lokalen Kopie raus — hatte
      // ein zweites Verwaltungsgerät inzwischen den Namen eingetragen, war er
      // mit dem Vermerk von hier wieder weg.
      const vorher = alle.find((t) => t.code === offen.code);
      const zeile: api.Stammdaten = { code: offen.code };
      if ((offen.holderName ?? null) !== (vorher?.holderName ?? null)) zeile.holderName = offen.holderName;
      if (offen.category !== vorher?.category) zeile.category = offen.category || null;
      if ((offen.note ?? null) !== (vorher?.note ?? null)) zeile.note = offen.note;
      if ((offen.gesperrt ?? null) !== (vorher?.gesperrt ?? null)) zeile.gesperrt = offen.gesperrt;
      if (Object.keys(zeile).length === 1) {
        setMeldung(`${offen.code}: nichts geändert.`);
        setOffen(null);
        return;
      }
      await api.saveTickets(session, [zeile]);
      // Sofort auch lokal, damit die Änderung nicht erst beim nächsten
      // Abgleich sichtbar wird.
      const vorhanden = await store.getTicket(offen.code);
      await store.putTickets([{
        code: offen.code,
        holderName: offen.holderName,
        category: offen.category,
        note: offen.note,
        gesperrt: offen.gesperrt,
        redeemedAt: vorhanden?.redeemedAt ?? null,
        redeemedByDevice: vorhanden?.redeemedByDevice ?? null,
        pending: vorhanden?.pending,
      }]);
      setMeldung(`${offen.code} gespeichert.`);
      setOffen(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (offen) {
    return (
      <>
        <p className="lead">Ticket {group(offen.code)}</p>

        <label className="field">
          <span>Name</span>
          <input
            type="text" value={offen.holderName ?? ""} autoFocus maxLength={120}
            onChange={(e) => setOffen({ ...offen, holderName: e.target.value || null })}
            placeholder="leer lassen, wenn keiner hinterlegt ist"
          />
        </label>

        <label className="field">
          <span>Kategorie</span>
          <input
            type="text" value={offen.category} maxLength={60}
            onChange={(e) => setOffen({ ...offen, category: e.target.value })}
            placeholder="Festival-Ticket"
          />
        </label>

        <label className="field">
          <span>Vermerk</span>
          <input
            type="text" value={offen.note ?? ""} maxLength={300}
            onChange={(e) => setOffen({ ...offen, note: e.target.value || null })}
            placeholder="erscheint am Eingang gelb hinterlegt"
          />
        </label>

        {/* Statt Löschen. Ein gelöschtes Ticket erreicht die Geräte nie —
            der Abgleich überträgt nur Änderungen —, ein gesperrtes schon:
            Binnen etwa einer Minute weist jedes Gerät es ab. */}
        <label className="field">
          <span>Sperrvermerk</span>
          <input
            type="text" value={offen.gesperrt ?? ""} maxLength={200}
            onChange={(e) => setOffen({ ...offen, gesperrt: e.target.value || null })}
            placeholder="leer = gültig. Grund eintragen, um zu sperren"
          />
          <small>
            Ein Grund hier sperrt das Ticket auf allen Geräten, etwa „doppelt
            verkauft“. Feld leeren hebt die Sperre auf.
          </small>
        </label>

        {fehler && <p className="error" role="alert">{fehler}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={() => setOffen(null)}>Zurück</button>
          <button
            type="button" className="btn primary grow" disabled={busy}
            onClick={() => void speichern()}
          >
            {busy ? "…" : "Speichern"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="searchbox">
        <Icon.Search className="searchbox-icon" />
        <input
          type="text" value={query} autoFocus
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => { setQuery(e.target.value); setMeldung(null); }}
          placeholder="Nummer oder Name suchen"
          aria-label="Nummer oder Name suchen"
        />
      </div>

      {meldung && <p className="verdict ok">{meldung}</p>}

      <p className="aside tight">
        {query.trim()
          ? `${treffer.length} ${treffer.length === 1 ? "Treffer" : "Treffer"}`
          : `${alle.length} Tickets`}
        {limit < treffer.length && ` · ${sichtbar.length} angezeigt, weiterblättern lädt nach`}
      </p>

      <ul className="entries roster">
        {sichtbar.map((t) => (
          <li key={t.code} className={t.redeemedAt ? "done" : "open"}>
            <span className="mark" aria-hidden>
              {t.redeemedAt ? <Icon.Check /> : <span className="mark-open" />}
            </span>
            <span className="entry-lines">
              <span className="entry-code">{group(t.code)}</span>
              <span className={t.holderName ? "entry-name" : "entry-name none"}>
                {t.holderName ?? "ohne Namen"}
              </span>
              <span className="entry-meta">
                {t.gesperrt ? `GESPERRT: ${t.gesperrt} · ` : ""}{t.category}{t.note ? ` · ${t.note}` : ""}
              </span>
            </span>
            <button
              type="button" className="btn small"
              onClick={() => setOffen({
                code: t.code, holderName: t.holderName,
                category: t.category, note: t.note, gesperrt: t.gesperrt ?? null,
              })}
            >
              Ändern
            </button>
          </li>
        ))}
      </ul>

      {treffer.length === 0 && (
        <p className="lead">
          {alle.length === 0
            ? "Auf diesem Gerät liegt noch keine Ticketliste."
            : "Kein Treffer."}
        </p>
      )}
    </>
  );
}

// ------------------------------------------------------- Liste einfügen --

function AlsListe({ session }: { session: store.Session }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ergebnis, setErgebnis] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  // Der Probelauf zu genau diesem Text. Ändert sich der Text, verfällt er.
  const [probe, setProbe] = useState<{ text: string; bericht: api.StammdatenBericht } | null>(null);
  const [neuFreigabe, setNeuFreigabe] = useState(false);

  // Erst zeigen, was ankommen würde. Wer 2305 Zeilen einfügt, soll vorher
  // sehen, ob die führenden Nullen überlebt haben — der häufigste Fehler beim
  // Weg über eine Tabellenkalkulation.
  const gelesen = useMemo(() => lies(text), [text]);
  const aktuell = probe && probe.text === text ? probe.bericht : null;

  const blocks = () => {
    const out: api.Stammdaten[][] = [];
    for (let i = 0; i < gelesen.zeilen.length; i += BLOCK) out.push(gelesen.zeilen.slice(i, i + BLOCK));
    return out;
  };

  /** Probelauf über alle Blöcke: Was wäre neu, was würde sich ändern? */
  async function pruefen() {
    setBusy(true);
    setFehler(null);
    setErgebnis(null);
    setNeuFreigabe(false);
    try {
      const summe: api.StammdatenBericht = {
        neu: 0, geaendert: 0, unveraendert: 0, neueCodes: [], aenderungen: [], geschrieben: false,
      };
      for (const block of blocks()) {
        const b = await api.saveTickets(session, block, { probe: true });
        summe.neu += b.neu;
        summe.geaendert += b.geaendert;
        summe.unveraendert += b.unveraendert;
        summe.neueCodes.push(...b.neueCodes);
        summe.aenderungen.push(...b.aenderungen);
      }
      setProbe({ text, bericht: summe });
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function schreiben() {
    if (!aktuell) return;
    setBusy(true);
    setFehler(null);
    setErgebnis(null);
    let fertig = 0;
    try {
      for (const block of blocks()) {
        await api.saveTickets(session, block, { neuAnlegen: neuFreigabe });
        fertig += block.length;
      }
      // Den lokalen Bestand nachziehen, statt auf den Takt zu warten — über
      // den regulären Abgleich, nicht an dessen Sperre vorbei. Zwei parallele
      // Abgleiche konnten Tickets dauerhaft falsch auf „frei" stellen.
      await sync.syncOnce(session).catch(() => {});
      setErgebnis(`Übernommen: ${aktuell.neu} neu, ${aktuell.geaendert} geändert.`);
      setText("");
      setProbe(null);
    } catch (err) {
      // Blöcke laufen einzeln. Bricht einer ab — Funkloch, Zeitlimit —, sind
      // die davor geschrieben. Das muss dastehen, sonst weiß niemand, ob die
      // Liste halb oder gar nicht drin ist.
      const grund = err instanceof Error ? err.message : String(err);
      setFehler(fertig
        ? `Nur die ersten ${fertig} von ${gelesen.zeilen.length} Zeilen sind übernommen. ${grund} ` +
          "Noch einmal prüfen und übernehmen — schon geschriebene Zeilen gelten dann als unverändert."
        : grund);
      setProbe(null);
    } finally {
      setBusy(false);
    }
  }

  const gesperrt = busy || gelesen.zeilen.length === 0 || gelesen.fehler.length > 0
    || gelesen.stellen.length > 1 || gelesen.doppelt.length > 0;

  return (
    <>
      <p className="lead">
        Eine Zeile je Ticket: Nummer, Name, Kategorie, Vermerk. Getrennt durch
        Tabulator, Semikolon oder Komma — je Liste eines davon. Aus einer
        Tabellenkalkulation lässt sich der Bereich direkt hierher kopieren.
      </p>

      <pre className="facts">{`00425; Anna Weber
00426; Weber, Ben; Crew
00427; ; VIP
00429`}</pre>

      <p className="aside tight">
        <b>Leere Felder ändern nichts.</b> Zeile 3 setzt nur die Kategorie und
        lässt den Namen stehen; Zeile 4 ändert gar nichts. Einen Namen leeren
        geht nur einzeln. Enthält ein Name ein Komma, Semikolon statt Komma
        trennen oder den Namen in Anführungszeichen setzen.
      </p>

      <label className="field">
        <span>Liste einfügen</span>
        <textarea
          value={text} rows={8}
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          placeholder="hier einfügen"
        />
      </label>

      {gelesen.fehler.length > 0 && (
        <p className="error" role="alert">
          {gelesen.fehler.length} {gelesen.fehler.length === 1 ? "Zeile ist" : "Zeilen sind"} unklar:
          {" "}{gelesen.fehler.slice(0, 3).join(" · ")}
          {gelesen.fehler.length > 3 && " …"}
        </p>
      )}
      {gelesen.doppelt.length > 0 && (
        <p className="error" role="alert">
          Doppelte Nummern: {gelesen.doppelt.slice(0, 8).join(", ")}
          {gelesen.doppelt.length > 8 && " …"}. Welche Zeile gilt? Bitte bereinigen.
        </p>
      )}

      {gelesen.zeilen.length > 0 && (
        <>
          <p className="verdict ok">
            {gelesen.zeilen.length} Zeilen erkannt, {gelesen.mitNamen} davon mit Namen.
            {" "}Getrennt durch {gelesen.trenner}. Stellen: {gelesen.stellen.join(", ")}.
          </p>
          {gelesen.stellen.length > 1 && (
            <p className="error" role="alert">
              Unterschiedlich viele Stellen — vermutlich sind beim Export die
              führenden Nullen verlorengegangen. So nicht übernehmen.
            </p>
          )}
          {/* Die ersten Zeilen so, wie sie verstanden wurden. Ein falsch
              gewähltes Trennzeichen fällt hier auf und nicht erst am Einlass. */}
          <table className="vorschau">
            <thead><tr><th>Nummer</th><th>Name</th><th>Kategorie</th><th>Vermerk</th></tr></thead>
            <tbody>
              {gelesen.zeilen.slice(0, 5).map((z) => (
                <tr key={z.code}>
                  <td>{z.code}</td>
                  <td>{z.holderName ?? <i>bleibt</i>}</td>
                  <td>{z.category ?? <i>bleibt</i>}</td>
                  <td>{z.note ?? <i>bleibt</i>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {aktuell && (
        <div className="facts">
          <p>
            <b>{aktuell.neu}</b> neu · <b>{aktuell.geaendert}</b> geändert ·{" "}
            <b>{aktuell.unveraendert}</b> unverändert
          </p>
          {aktuell.aenderungen.length > 0 && (
            <ul className="aenderungen">
              {aktuell.aenderungen.slice(0, 50).map((a, i) => (
                <li key={i}>
                  {a.code} · {feldname(a.feld)}: {a.alt ?? "—"} → <b>{a.neu ?? "—"}</b>
                </li>
              ))}
              {aktuell.geaendert > 0 && aktuell.aenderungen.length >= 50 && <li>…</li>}
            </ul>
          )}
          {aktuell.neu > 0 && (
            <label className="check">
              <input
                type="checkbox" checked={neuFreigabe}
                onChange={(e) => setNeuFreigabe(e.target.checked)}
              />
              {" "}{aktuell.neu} Nummern stehen noch nicht in der Liste
              ({aktuell.neueCodes.slice(0, 6).join(", ")}{aktuell.neu > 6 ? " …" : ""}).
              Ja, als neue Tickets anlegen — jede davon gilt danach am Einlass.
            </label>
          )}
        </div>
      )}

      {ergebnis && <p className="verdict ok">{ergebnis}</p>}
      {fehler && <p className="error" role="alert">{fehler}</p>}

      {!aktuell ? (
        <button
          type="button" className="btn primary wide" disabled={gesperrt}
          onClick={() => void pruefen()}
        >
          {busy ? "Wird geprüft…" : `${gelesen.zeilen.length} Zeilen prüfen`}
        </button>
      ) : (
        <button
          type="button" className="btn primary wide"
          disabled={gesperrt || (aktuell.neu > 0 && !neuFreigabe)
            || aktuell.neu + aktuell.geaendert === 0}
          onClick={() => void schreiben()}
        >
          {busy ? "Wird geschrieben…"
            : aktuell.neu + aktuell.geaendert === 0 ? "Nichts zu übernehmen"
            : `${aktuell.neu + aktuell.geaendert} Änderungen übernehmen`}
        </button>
      )}

      <p className="aside">
        Nicht während des Einlasses: Eine Änderung an vielen Zeilen lässt jedes
        Telefon den Bestand neu ziehen. Vormittags ja, Freitagabend nicht.
        Jede Änderung steht mit altem Wert im Änderungsprotokoll.
      </p>
    </>
  );
}

function feldname(feld: string): string {
  return feld === "holder_name" ? "Name" : feld === "category" ? "Kategorie"
    : feld === "note" ? "Vermerk" : feld;
}

/**
 * Zerlegt eine Zeile an EINEM Trennzeichen, mit Anführungszeichen wie in CSV.
 *
 * Vorher wurde an Komma, Semikolon und Tab zugleich getrennt. „Müller, Hans"
 * aus einer Tabelle wurde damit zu Name „Müller" und Kategorie „Hans" — und
 * genau das stand dann im Bestätigungsschritt am Einlass.
 */
function zerlege(zeile: string, trenner: string): string[] {
  const teile: string[] = [];
  let feld = "";
  let inQuotes = false;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (inQuotes) {
      if (c === '"' && zeile[i + 1] === '"') { feld += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else feld += c;
    } else if (c === '"' && feld.trim() === "") {
      inQuotes = true;
      feld = "";
    } else if (c === trenner) {
      teile.push(feld);
      feld = "";
    } else {
      feld += c;
    }
  }
  teile.push(feld);
  return teile.map((t) => t.trim());
}

/** Liest den eingefügten Text, ohne etwas zu erraten. */
function lies(text: string): {
  zeilen: api.Stammdaten[]; fehler: string[]; doppelt: string[];
  mitNamen: number; stellen: number[]; trenner: string;
} {
  const zeilen: api.Stammdaten[] = [];
  const fehler: string[] = [];
  const stellen = new Set<number>();
  const gesehen = new Set<string>();
  const doppelt = new Set<string>();
  let mitNamen = 0;

  const roh = text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  // Ein Trennzeichen je Liste. Tab zuerst: Aus einer Tabellenkalkulation
  // kopiert ist alles tab-getrennt, und Kommas in Namen bleiben dann Namen.
  const trenner = roh.some((z) => z.includes("\t")) ? "\t"
    : roh.some((z) => z.includes(";")) ? ";"
    : ",";

  for (const zeile of roh) {
    // Kopfzeile einer Tabelle überspringen, statt sie als Ticket zu deuten.
    if (/^(code|nummer|ticket)\b/i.test(zeile)) continue;

    const teile = zerlege(zeile, trenner);
    const code = teile[0];
    if (!/^\d+$/.test(code) || teile.length > 4) {
      fehler.push(`„${zeile.slice(0, 24)}“`);
      continue;
    }
    if (gesehen.has(code)) doppelt.add(code);
    gesehen.add(code);
    stellen.add(code.length);

    // Leere Zellen bleiben weg — der Server lässt fehlende Felder stehen.
    const z: api.Stammdaten = { code };
    if (teile[1]) { z.holderName = teile[1]; mitNamen++; }
    if (teile[2]) z.category = teile[2];
    if (teile[3]) z.note = teile[3];
    zeilen.push(z);
  }

  return {
    zeilen, fehler, doppelt: [...doppelt], mitNamen,
    stellen: [...stellen].sort((a, b) => a - b),
    trenner: trenner === "\t" ? "Tabulator" : trenner === ";" ? "Semikolon" : "Komma",
  };
}

function group(code: string): string {
  return code.replace(/(\d{2})(?=\d)/g, "$1 ");
}
