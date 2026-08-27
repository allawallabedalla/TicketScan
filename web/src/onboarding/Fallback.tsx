// Auffangnetz für einen Fehler zur Laufzeit.
//
// Ohne das reißt ein einziger Fehler in irgendeinem Bildschirm die ganze App
// mit: React hängt den Baum aus, übrig bleibt eine leere Fläche. Am Eingang
// heißt das ein Gerät, das nichts mehr tut und nichts mehr sagt — und niemand
// weiß, ob es die App, das Telefon oder das Netz ist.
//
// Gefunden mit einer Serverantwort im falschen Format: Die Übersicht warf,
// und danach war auch der Scanner weg.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { error: Error | null }

export class Fallback extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // In die Konsole, damit die Rückmeldefunktion und ein angeschlossener
    // Rechner etwas zu sehen bekommen.
    console.error("Unerwarteter Fehler:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="sheet bad full">
        <p className="sheet-label">Etwas ist schiefgegangen</p>
        <p className="sheet-meta">
          Die App hat sich verschluckt. Die Ticketliste und alles, was noch
          nicht gesendet ist, liegen weiter auf dem Gerät — ein Neustart
          verliert nichts.
        </p>
        <p className="facts">{this.state.error.message}</p>
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
