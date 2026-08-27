// Die letzten Vorgänge dieses Geräts, mit Rücknahme.
//
// Der häufigste Bedienfehler am Eingang ist das versehentlich erfasste
// Nachbarticket. Ohne eine Möglichkeit, das zurückzunehmen, wird daraus ein
// Fall für die Schichtleitung — mit ihr ein Handgriff.

import { useCallback, useEffect, useState } from "react";
import * as store from "../lib/store";
import * as sync from "../lib/sync";

export function Recent({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<store.HistoryEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => void store.history().then(setEntries), []);
  useEffect(load, [load]);

  async function takeBack(entry: store.HistoryEntry) {
    setBusy(entry.scanId);
    try {
      // Die scanId der eigenen Einlösung mitgeben: Diese Rücknahme meint
      // genau diesen Vorgang. Kommt sie verspätet an, weil das Gerät im
      // Funkloch stand, darf sie keine fremde Einlösung treffen, die
      // inzwischen an einer anderen Tür entstanden ist.
      await sync.undo(entry.code, "Rücknahme am Gerät", entry.scanId);
      await store.amend(entry.scanId, { undoneAt: new Date().toISOString() });
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sheet overlay list">
      <header className="list-head">
        <h1>Letzte Vorgänge</h1>
        <button type="button" className="btn" onClick={onClose}>Schließen</button>
      </header>

      {entries.length === 0 && (
        <p className="lead">Auf diesem Gerät wurde noch nichts erfasst.</p>
      )}

      <ul className="entries">
        {entries.map((entry) => (
          <li key={entry.scanId} className={entry.undoneAt ? "undone" : entry.verdict}>
            <span className="entry-code">{group(entry.code)}</span>
            <span className="entry-meta">
              {time(entry.at)}
              {" · "}
              {entry.undoneAt
                ? "zurückgenommen"
                : entry.verdict === "ok" ? "eingelassen"
                : entry.verdict === "duplicate" ? "war schon eingelöst"
                : "unbekannt"}
            </span>
            {entry.verdict === "ok" && !entry.undoneAt && (
              <button
                type="button" className="btn small"
                disabled={busy === entry.scanId}
                onClick={() => void takeBack(entry)}
              >
                {busy === entry.scanId ? "…" : "Zurücknehmen"}
              </button>
            )}
          </li>
        ))}
      </ul>

      <p className="aside">
        Zurücknehmen macht das Ticket wieder frei. Das wirkt sofort und auch
        ohne Netz; die anderen Geräte erfahren es beim nächsten Abgleich.
      </p>
    </div>
  );
}

function group(code: string): string {
  return code.replace(/(\d{2})(?=\d)/g, "$1 ");
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
