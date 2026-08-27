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

// Die Vertipper-Rückverfolgung ist ersatzlos entfernt.
//
// Sie hat vorgeschlagen, ein Nachbarticket zurückzunehmen, wenn kurz zuvor auf
// demselben Gerät eine Nummer mit genau einer abweichenden Ziffer eingelöst
// wurde. Die Auswahlmenge war systematisch falsch: Gesucht wurde unter den
// bereits EINGELÖSTEN Nachbarn — also unter Gästen, die tatsächlich drin sind.
//
// Der Fall, für den sie gebaut war, kann sie gar nicht erreichen. Wurde beim
// Scannen von Ticket B versehentlich A gebucht, ist B danach noch offen; ein
// erneuter Scan von B ergibt „gültig", und die Rückverfolgung wird nie
// aufgerufen. Ausgelöst hat sie stattdessen der Normalfall, dass eine Gruppe
// fortlaufende Nummern gekauft hat und nacheinander hereinkommt.
//
// Ein Prüflauf über 2305 Tickets mit 60 Einlösungen in zehn Minuten: In 34,9
// Prozent der Doppelscans wurde ein fremdes, korrekt eingelöstes Ticket zur
// Rücknahme angeboten — als erster, hervorgehobener Knopf, mit dem Text
// „Wahrscheinlich war dieses Ticket gemeint". Ein Gast, der längst auf dem
// Gelände war, stand danach wieder als nicht eingelöst da.
//
// Ein tragfähiger Ersatz existiert nicht: Jede Nummer hat bis zu 45 gültige
// Nachbarn mit einer Ziffer Unterschied. Was am Eingang wirklich hilft, sind
// die Tatsachen — wann eingelöst, an welchem Gerät — und die Möglichkeit, ein
// unversehrtes Ticket freizugeben. Beides bleibt.
