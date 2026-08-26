// Die lokale Entscheidung — der Kern der App.
//
// Bewusst eine reine Funktion ohne Netz, ohne Datenbank, ohne Zustand: Sie
// entscheidet in unter einer Millisekunde und lässt sich vollständig prüfen.
// Der Server bestätigt später, aber er wird nie gefragt, bevor die Person
// durchgelassen wird.

import type { Ticket } from "./store";

export type Verdict = "ok" | "duplicate" | "unknown";

export interface Decision {
  verdict: Verdict;
  code: string;
  ticket?: Ticket;
  /** Bei „bereits eingelöst“: die wahrscheinliche Fehleingabe, siehe unten. */
  likelyMistype?: { code: string; at: string };
}

/** Normalisiert eine Eingabe auf die gedruckte Schreibweise. */
export function normalize(input: string, width: number): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits || digits.length > width) return null;
  return digits.padStart(width, "0");
}

export function decide(code: string, ticket: Ticket | undefined): Decision {
  if (!ticket) return { verdict: "unknown", code };
  if (ticket.redeemedAt) return { verdict: "duplicate", code, ticket };
  return { verdict: "ok", code, ticket };
}

/**
 * Sucht die wahrscheinliche Fehleingabe hinter einem abgewiesenen Ticket.
 *
 * Weil die Nummern fortlaufend und damit dicht liegen, trifft ein Vertipper
 * fast immer ein anderes gültiges Ticket — dieselbe Eigenschaft lässt den
 * Fehler aber auch sehr genau lokalisieren: Wurde kurz zuvor auf demselben
 * Gerät eine Nummer mit genau einer abweichenden Ziffer eingelöst, war
 * höchstwahrscheinlich dieses Ticket gemeint.
 */
export function findLikelyMistype(
  code: string,
  tickets: Ticket[],
  deviceId: string,
  windowMinutes = 10,
): { code: string; at: string } | undefined {
  const since = Date.now() - windowMinutes * 60_000;

  const candidates = tickets.filter((t) =>
    t.redeemedAt !== null &&
    t.redeemedByDevice === deviceId &&
    Date.parse(t.redeemedAt) >= since &&
    differsByOneDigit(code, t.code)
  );

  if (candidates.length !== 1) return undefined; // Mehrdeutig? Dann lieber nichts behaupten.
  const hit = candidates[0];
  return { code: hit.code, at: hit.redeemedAt! };
}

function differsByOneDigit(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++diff > 1) return false;
  }
  return diff === 1;
}
