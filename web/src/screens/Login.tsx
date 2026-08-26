// Anmeldung: einmal je Gerät und Festivaltag.
//
// Das Passwort wird ausschließlich serverseitig geprüft. Hier wird es nur
// weitergereicht — im Bundle steht kein Vergleichswert, und es gibt auch
// keinen, den man dort suchen könnte.

import { type FormEvent, useState } from "react";
import * as store from "../lib/store";
import * as Icon from "../onboarding/Icons";

const API = import.meta.env.VITE_API_URL ?? "";

export function Login({ onDone }: { onDone: (session: store.Session) => void }) {
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      // Eine bereits vergebene Gerätekennung mitschicken, damit dasselbe
      // Telefon am nächsten Morgen dieselbe Kennung behält.
      const known = await store.get<store.Session>("session");

      const res = await fetch(`${API}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, label: label.trim(), deviceId: known?.deviceId ?? null }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Anmeldung fehlgeschlagen");
        return;
      }

      const session: store.Session = data;
      await store.set("session", session);
      onDone(session);
    } catch {
      setError("Kein Netz. Für die erste Anmeldung braucht das Gerät einmal Verbindung.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <div className="hero-icon"><Icon.Lock /></div>
      <h1>Anmelden</h1>
      <p className="lead">
        Einmal für heute. Beim Scannen fragt die App nicht noch einmal.
      </p>

      <label className="field">
        <span>Passwort</span>
        <input
          type="password" value={password} required autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Von der Einlassleitung"
        />
      </label>

      <label className="field">
        <span>Name dieses Geräts</span>
        <input
          type="text" value={label} required maxLength={40} autoComplete="off"
          onChange={(e) => setLabel(e.target.value)}
          placeholder="z. B. Nordeingang 2"
        />
        <small>Damit später erkennbar ist, an welcher Tür gescannt wurde.</small>
      </label>

      {error && <p className="error" role="alert">{error}</p>}

      <button type="submit" className="btn primary wide" disabled={busy}>
        {busy ? "Einen Moment…" : "Anmelden"}
      </button>
    </form>
  );
}
