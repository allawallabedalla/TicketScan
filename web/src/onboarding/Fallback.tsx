// Auffangnetz für einen Fehler zur Laufzeit.
//
// Ohne das reißt ein einziger Fehler in irgendeinem Bildschirm die ganze App
// mit: React hängt den Baum aus, übrig bleibt eine leere Fläche. Am Eingang
// heißt das ein Gerät, das nichts mehr tut und nichts mehr sagt — und niemand
// weiß, ob es die App, das Telefon oder das Netz ist.
//
// Gefunden mit einer Serverantwort im falschen Format: Die Übersicht warf,
// und danach war auch der Scanner weg.
//
// ZWEI GRENZEN, nicht eine. Die äußere in main.tsx fängt alles ab, was beim
// Zeichnen der App wirft. Sie allein genügte aber nicht für ihren eigenen
// Anlass: Übersicht, Liste und Verlauf werden INNERHALB des Scanners
// gezeichnet — wirft eine davon, wäre der Scanner weiterhin weg, nur mit
// Erklärtext statt weißer Fläche. Deshalb bekommt jede dieser Flächen eine
// eigene Grenze, die zurück zum Scanner führt.
//
// Was keine Fehlergrenze fängt, und zwar in keinem React: Fehler aus
// Ereignisbehandlern, aus Promises und aus Zeitgebern. Die sind an den
// riskanten Stellen einzeln abgefangen — siehe `redeem` und `override` in
// Scanner.tsx.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { error: unknown }

interface Props {
  children: ReactNode;
  /** Was statt der Kinder erscheint. Ohne Angabe der ganzflächige Bildschirm
   *  mit Neustart — richtig für die äußere Grenze, zu grob für eine Fläche,
   *  die sich einfach schließen lässt. */
  onClose?: () => void;
  label?: string;
}

/** Auch `throw null` und `throw "kaputt"` müssen ankommen. Vorher prüfte die
 *  Grenze auf `!this.state.error` — ein geworfener falsy Wert lief damit ins
 *  Leere und die Kinder wurden weitergezeichnet, ohne jede Meldung. */
function beschreibe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string" && error) return error;
  return "Unbekannter Fehler";
}

export class Fallback extends Component<Props, State> {
  state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    // Ein geworfenes null bliebe `undefined` und löste nicht aus — deshalb
    // ein eigener Ersatzwert.
    return { error: error ?? new Error("Unbekannter Fehler") };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Unerwarteter Fehler:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    const text = beschreibe(this.state.error);

    // Eine Fläche, die sich schließen lässt: zurück zum Scanner, der weiter
    // arbeitet. Das ist der wichtigere Fall — der Einlass läuft weiter.
    if (this.props.onClose) {
      return (
        <div className="sheet overlay list" role="alert">
          <header className="list-head">
            <h1>{this.props.label ?? "Bildschirm"} nicht verfügbar</h1>
            <button
              type="button" className="btn"
              onClick={() => { this.setState({ error: undefined }); this.props.onClose?.(); }}
            >
              Schließen
            </button>
          </header>
          <p className="lead">
            Hier ist etwas schiefgegangen. Der Scanner arbeitet weiter — schließ
            diese Fläche und mach am Eingang weiter.
          </p>
          <p className="facts">{text}</p>
        </div>
      );
    }

    return (
      <div className="sheet bad full" role="alert">
        <p className="sheet-label">Etwas ist schiefgegangen</p>
        <p className="sheet-meta">
          Die App hat sich verschluckt. Die Ticketliste und alles, was noch
          nicht gesendet ist, liegen weiter auf dem Gerät — ein Neustart
          verliert nichts.
        </p>
        <p className="facts">{text}</p>
        <div className="sheet-actions">
          <button
            type="button" className="btn primary wide"
            onClick={() => location.reload()}
          >
            App neu starten
          </button>
        </div>
      </div>
    );
  }
}
