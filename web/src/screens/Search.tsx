// Suche in der Ticketliste.
//
// Für Tickets, deren Nummer sich nicht mehr lesen lässt: zerrissen, verregnet,
// überklebt. Gesucht wird über einen Teil der Nummer, damit auch drei erhaltene
// Ziffern noch weiterhelfen.

import { useEffect, useMemo, useState } from "react";
import * as store from "../lib/store";

const MAX_HITS = 40;

export function Search({ onPick, onClose }: {
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<store.Ticket[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => { void store.allTickets().then(setAll); }, []);

  const hits = useMemo(() => {
    const needle = query.replace(/\D/g, "");
    if (needle.length < 2) return [];
    return all.filter((t) => t.code.includes(needle)).slice(0, MAX_HITS);
  }, [all, query]);

  return (
    <div className="sheet overlay list">
      <header className="list-head">
        <h1>Ticket suchen</h1>
        <button type="button" className="btn" onClick={onClose}>Schließen</button>
      </header>

      <label className="field">
        <span>Teil der Nummer</span>
        <input
          type="text" inputMode="numeric" value={query} autoFocus
          onChange={(e) => setQuery(e.target.value)}
          placeholder="z. B. 245"
        />
        <small>Mindestens zwei Ziffern. Die Reihenfolge muss stimmen.</small>
      </label>

      {query.replace(/\D/g, "").length >= 2 && hits.length === 0 && (
        <p className="lead">Keine Nummer enthält diese Ziffernfolge.</p>
      )}

      <ul className="entries">
        {hits.map((ticket) => (
          <li key={ticket.code} className={ticket.redeemedAt ? "duplicate" : "ok"}>
            <span className="entry-code">{group(ticket.code)}</span>
            <span className="entry-meta">
              {ticket.redeemedAt
                ? `eingelöst um ${time(ticket.redeemedAt)}`
                : "noch nicht eingelöst"}
            </span>
            {!ticket.redeemedAt && (
              <button type="button" className="btn small" onClick={() => onPick(ticket.code)}>
                Prüfen
              </button>
            )}
          </li>
        ))}
      </ul>

      {hits.length === MAX_HITS && (
        <p className="aside">Mehr als {MAX_HITS} Treffer — bitte weitere Ziffern angeben.</p>
      )}
    </div>
  );
}

function group(code: string): string {
  return code.replace(/(\d{2})(?=\d)/g, "$1 ");
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
