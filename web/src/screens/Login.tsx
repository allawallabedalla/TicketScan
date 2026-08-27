// Anmeldung: einmal je Gerät und Festivaltag.
//
// Das Passwort wird ausschließlich serverseitig geprüft. Hier wird es nur
// weitergereicht — im Bundle steht kein Vergleichswert, und es gibt auch
// keinen, den man dort suchen könnte.

import { type FormEvent, useState } from "react";
import * as store from "../lib/store";
import * as localAuth from "../lib/localAuth";
import * as Icon from "../onboarding/Icons";
import { Logo } from "../onboarding/Logo";

const API = import.meta.env.VITE_API_URL ?? "";

/** Weiterarbeiten mit der letzten Anmeldung dieses Geräts. */
async function offlineWeiter(
  password: string,
  label: string,
  onDone: (session: store.Session) => void,
): Promise<boolean> {
  const known = await store.get<store.Session>("session");
  if (!known || !(await localAuth.matches(password))) return false;

  const rollover = new Date();
  rollover.setHours(6, 0, 0, 0);
  if (rollover <= new Date()) rollover.setDate(rollover.getDate() + 1);

  const offlineSession: store.Session = {
    ...known,
    label: label.trim() || known.label,
    expiresAt: Math.floor(rollover.getTime() / 1000),
  };
  await store.set("session", offlineSession);
  onDone(offlineSession);
  return true;
}

export function Login({ onDone }: { onDone: (session: store.Session) => void }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
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
        // Bei einem Serverfehler denselben Weg wie ohne Netz gehen: Ein
        // pausiertes Projekt, eine überlastete Datenbank oder ein fehlendes
        // Geheimnis sind für die Person am Eingang dasselbe wie Funkstille.
        // 429 gehört dazu: Ist die Anmeldebremse zugeschnappt, hilft es
        // niemandem, ein Gerät auszusperren, das eine gültige gespeicherte
        // Sitzung und den passenden Passworthash hat.
        if ((res.status >= 500 || res.status === 429)
            && await offlineWeiter(password, label, onDone)) return;
        setError(data.error ?? "Anmeldung fehlgeschlagen");
        return;
      }

      const session: store.Session = data;
      await store.set("session", session);
      // Für den Fall, dass morgens kein Netz da ist.
      await localAuth.keep(password);
      onDone(session);
    } catch {
      // Kein Netz. War dieses Gerät schon einmal angemeldet, geht es trotzdem
      // weiter — der Server entscheidet erneut, sobald er erreichbar ist.
      if (await offlineWeiter(password, label, onDone)) return;
      const known = await store.get<store.Session>("session");
      setError(
        known
          ? "Kein Netz — und das Passwort stimmt nicht mit dem der letzten Anmeldung überein."
          : "Kein Netz. Für die allererste Anmeldung braucht das Gerät einmal Verbindung.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <Logo className="logo-lead" label="Herzberg Festival" />
      <h1>Anmelden</h1>
      <p className="lead">
        Einmal für heute. Beim Scannen fragt die App nicht noch einmal.
      </p>

      <label className="field">
        <span>Passwort</span>
        {/* Ein gemeinsames Eventpasswort wird abgetippt, oft im Dunkeln und
            unter Zeitdruck. Wer sich vertippt, soll das sehen können. */}
        <div className="field-with-button">
          <input
            type={visible ? "text" : "password"}
            value={password} required autoComplete="current-password"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Von der Einlassleitung"
          />
          <button
            type="button" className="field-button"
            onClick={() => setVisible(!visible)}
            aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"}
            aria-pressed={visible}
          >
            {visible ? <Icon.EyeOff /> : <Icon.Eye />}
          </button>
        </div>
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
