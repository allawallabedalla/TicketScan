// Rückmeldung geben.
//
// Zwei Wege, weil zwei sehr verschiedene Leute das benutzen: In der Entwicklung
// landet die Meldung direkt als Eintrag im Repo. Am Eingang hat niemand ein
// GitHub-Konto — dort kopiert man die Angaben und schickt sie, wie man
// ohnehin schreibt.

import { useEffect, useState } from "react";
import { collect, issueUrl } from "../lib/diagnostics";
import * as Icon from "../onboarding/Icons";

export function Feedback({ onClose }: { onClose: () => void }) {
  const [facts, setFacts] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { void collect().then(setFacts); }, []);

  async function copy() {
    const text = [title, description, "", facts].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ohne Zwischenablage bleibt der Text im Feld — von Hand markierbar.
      setCopied(false);
    }
  }

  return (
    <div className="sheet overlay list">
      <header className="list-head">
        <h1>Rückmeldung</h1>
        <button type="button" className="btn" onClick={onClose}>Schließen</button>
      </header>

      <label className="field">
        <span>Worum geht es?</span>
        <input
          type="text" value={title} maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="z. B. Kamera erkennt Nummer nicht"
        />
      </label>

      <label className="field">
        <span>Was ist passiert?</span>
        <textarea
          rows={4} value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Was hast du gemacht, was ist stattdessen passiert?"
        />
      </label>

      <section className="block">
        <h2>Angaben vom Gerät</h2>
        <p className="aside">
          Gehen mit, egal welchen der beiden Wege du nimmst. Ohne sie beginnt jede Fehlersuche mit
          denselben Rückfragen.
        </p>
        <pre className="facts">{facts}</pre>
      </section>

      <div className="sheet-actions column">
        <a
          className="btn primary wide"
          href={issueUrl(title, description, facts)}
          target="_blank" rel="noreferrer"
        >
          <Icon.Share /> Als Eintrag im Repo anlegen
        </a>
        <button type="button" className="btn wide" onClick={() => void copy()}>
          {copied ? <><Icon.Check /> Kopiert</> : "Alles kopieren und selbst verschicken"}
        </button>
      </div>

      <p className="aside">
        Der obere Weg braucht ein GitHub-Konto und öffnet einen fertig
        ausgefüllten Entwurf — abgeschickt wird erst dort. Der untere geht
        immer.
      </p>
    </div>
  );
}
