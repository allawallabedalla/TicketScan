// Die vollständige Ticketliste: was ist eingelöst, was steht noch aus.
//
// Zwei Zwecke in einer Ansicht. Erstens nachschlagen, wenn eine Nummer nicht
// mehr lesbar ist — zerrissen, verregnet, überklebt; dann hilft ein Teil der
// Nummer oder der Name weiter. Zweitens der Überblick: Wer am Eingang steht,
// will sehen können, was schon durch ist, ohne dafür einen Laptop zu suchen.
//
// Die Liste zeigt den Stand, den dieses Gerät kennt. Ohne Netz ist das der
// Stand des letzten Abgleichs — das steht auch so darunter, damit niemand
// eine Vollständigkeit annimmt, die gerade nicht gegeben ist.

import { useEffect, useMemo, useRef, useState } from "react";
import * as store from "../lib/store";
import * as Icon from "../onboarding/Icons";

/** Wie viele Zeilen auf einmal in den Baum gehen. 2305 Zeilen gleichzeitig
 *  machen das Blättern auf einem älteren Telefon spürbar zäh; nachgeladen
 *  wird, sobald das Ende in Sicht kommt. */
const STEP = 120;

type Filter = "alle" | "offen" | "eingeloest";

export function Tickets({ onPick, onClose }: {
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<store.Ticket[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("alle");
  const [limit, setLimit] = useState(STEP);
  const scroller = useRef<HTMLDivElement>(null);

  // Der Abgleich läuft weiter, während die Liste offen ist. Alle fünf
  // Sekunden neu einlesen heißt: Was ein anderes Gerät gerade eingelassen
  // hat, steht hier kurz darauf auch.
  useEffect(() => {
    const load = () => void store.allTickets().then(setAll);
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const zahlen = useMemo(() => {
    let eingeloest = 0;
    for (const t of all) if (t.redeemedAt) eingeloest++;
    return { gesamt: all.length, eingeloest, offen: all.length - eingeloest };
  }, [all]);

  const treffer = useMemo(() => {
    const ziffern = query.replace(/\D/g, "");
    const text = query.trim().toLowerCase();

    let rows = all;
    // Ziffern schlagen Buchstaben: Wer eine Nummer eintippt, sucht eine Nummer.
    if (ziffern.length >= 2) rows = rows.filter((t) => t.code.includes(ziffern));
    else if (text.length >= 2) {
      rows = rows.filter((t) => t.holderName?.toLowerCase().includes(text));
    }

    if (filter === "offen") rows = rows.filter((t) => !t.redeemedAt);
    if (filter === "eingeloest") rows = rows.filter((t) => t.redeemedAt);

    // Bei den Eingelösten ist die Reihenfolge des Einlasses die nützlichere:
    // zuletzt eingelassen steht oben. Sonst bleibt es bei der Nummer.
    if (filter === "eingeloest") {
      rows = [...rows].sort((a, b) => (b.redeemedAt ?? "").localeCompare(a.redeemedAt ?? ""));
    } else {
      rows = [...rows].sort((a, b) => a.code.localeCompare(b.code));
    }
    return rows;
  }, [all, query, filter]);

  // Jede neue Auswahl fängt oben an — sonst bliebe die Liste an der Stelle
  // stehen, an der man vorher war, und sähe leer aus.
  useEffect(() => {
    setLimit(STEP);
    scroller.current?.scrollTo({ top: 0 });
  }, [query, filter]);

  function onScroll() {
    const el = scroller.current;
    if (!el || limit >= treffer.length) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) {
      setLimit((n) => n + STEP);
    }
  }

  const sichtbar = treffer.slice(0, limit);

  return (
    <div className="sheet overlay list" ref={scroller} onScroll={onScroll}>
      <header className="list-head">
        <h1>Ticketliste</h1>
        <button type="button" className="btn" onClick={onClose}>Schließen</button>
      </header>

      <div className="searchbox">
        <Icon.Search className="searchbox-icon" />
        <input
          type="text" value={query}
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nummer oder Name suchen"
          aria-label="Nummer oder Name suchen"
        />
        {query && (
          <button
            type="button" className="searchbox-clear"
            onClick={() => setQuery("")} aria-label="Suche zurücksetzen"
          >
            ×
          </button>
        )}
      </div>

      <div className="tabs" role="tablist">
        <Tab now={filter} me="alle" set={setFilter} n={zahlen.gesamt}>Alle</Tab>
        <Tab now={filter} me="offen" set={setFilter} n={zahlen.offen}>Offen</Tab>
        <Tab now={filter} me="eingeloest" set={setFilter} n={zahlen.eingeloest}>Eingelöst</Tab>
      </div>

      <div className="bar" aria-hidden>
        <span style={{ width: `${zahlen.gesamt ? (zahlen.eingeloest / zahlen.gesamt) * 100 : 0}%` }} />
      </div>
      <p className="aside tight">
        {zahlen.eingeloest} von {zahlen.gesamt} eingelöst · Stand des letzten
        Abgleichs auf diesem Gerät
      </p>

      {treffer.length === 0 && (
        <p className="lead">
          {all.length === 0
            ? "Auf diesem Gerät liegt noch keine Ticketliste."
            : query.trim()
              ? "Kein Treffer. Bei einer Suche über den Namen heißt das wenig — nicht jedes Ticket trägt einen. Dann über die Nummer suchen."
              : "Hier steht gerade nichts."}
        </p>
      )}

      <ul className="entries roster">
        {sichtbar.map((ticket) => (
          <li key={ticket.code} className={ticket.redeemedAt ? "done" : "open"}>
            <span className="mark" aria-hidden>
              {ticket.redeemedAt ? <Icon.Check /> : <span className="mark-open" />}
            </span>
            <span className="entry-lines">
              <span className="entry-code">{group(ticket.code)}</span>
              <span className={ticket.holderName ? "entry-name" : "entry-name none"}>
                {ticket.holderName ?? "ohne Namen"}
              </span>
              <span className="entry-meta">
                {ticket.redeemedAt
                  ? `eingelöst um ${time(ticket.redeemedAt)}${ticket.pending ? " · noch nicht gesendet" : ""}`
                  : "noch nicht eingelöst"}
              </span>
            </span>
            {!ticket.redeemedAt && (
              // Führt in denselben Bestätigungsschritt wie ein Scan — deshalb
              // „Prüfen“ und nicht „Einlassen“: Eingelassen wird erst nach dem
              // Blick auf Nummer und Namen.
              <button type="button" className="btn small" onClick={() => onPick(ticket.code)}>
                Prüfen
              </button>
            )}
          </li>
        ))}
      </ul>

      {limit < treffer.length && (
        <p className="aside">
          {sichtbar.length} von {treffer.length} angezeigt — weiterblättern lädt nach.
        </p>
      )}
    </div>
  );
}

function Tab({ now, me, set, n, children }: {
  now: Filter; me: Filter; set: (f: Filter) => void; n: number; children: string;
}) {
  return (
    <button
      type="button" role="tab" aria-selected={now === me}
      className={now === me ? "tab on" : "tab"}
      onClick={() => set(me)}
    >
      {children} <em>{n}</em>
    </button>
  );
}

function group(code: string): string {
  return code.replace(/(\d{2})(?=\d)/g, "$1 ");
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
