// Suche in der Ticketliste.
//
// Für Tickets, deren Nummer sich nicht mehr lesen lässt: zerrissen, verregnet,
// überklebt. Gesucht wird über einen Teil der Nummer, damit auch drei erhaltene
// Ziffern noch weiterhelfen — oder über den Namen, falls einer hinterlegt ist.
// Viele Tickets haben keinen; die Suche über die Nummer bleibt der Normalfall.

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
    const digits = query.replace(/\D/g, "");
    const text = query.trim().toLowerCase();
    // Ziffern schlagen Buchstaben: Wer eine Nummer eintippt, sucht eine Nummer.
    if (digits.length >= 2) return all.filter((t) => t.code.includes(digits)).slice(0, MAX_HITS);
    if (text.length >= 3) {
      return all
        .filter((t) => t.holderName?.toLowerCase().includes(text))
        .slice(0, MAX_HITS);
    }
    return [];
  }, [all, query]);

  const searching = query.replace(/\D/g, "").length >= 2 || query.trim().length >= 3;

  return (
    <div className="sheet overlay list">
      <header className="list-head">
        <h1>Ticket suchen</h1>
        <button type="button" className="btn" onClick={onClose}>Schließen</button>
      </header>

      <label className="field">
        <span>Nummer oder Name</span>
        <input
          type="text" value={query} autoFocus
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="z. B. 245 oder Schneider"
        />
        <small>
          Zwei Ziffern in der richtigen Reihenfolge — oder drei Buchstaben des
          Namens, sofern das Ticket einen trägt.
        </small>
      </label>

      {searching && hits.length === 0 && (
        <p className="lead">
          Kein Treffer. Bei einer Suche über den Namen heißt das wenig — nicht
          jedes Ticket trägt einen. Dann über die Nummer suchen.
        </p>
      )}

      <ul className="entries">
        {hits.map((ticket) => (
          <li key={ticket.code} className={ticket.redeemedAt ? "duplicate" : "ok"}>
            <span className="entry-code">{group(ticket.code)}</span>
            <span className="entry-lines">
              {ticket.holderName && <span className="entry-name">{ticket.holderName}</span>}
              <span className="entry-meta">
                {ticket.redeemedAt
                  ? `eingelöst um ${time(ticket.redeemedAt)}`
                  : "noch nicht eingelöst"}
              </span>
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
