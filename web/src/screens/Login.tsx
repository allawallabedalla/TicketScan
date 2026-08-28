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

type Zweck = null | "scanner" | "verwaltung";

export function Login({ onDone }: { onDone: (session: store.Session) => void }) {
  /**
   * Erst die Frage, wofür — dann das Passwort.
   *
   * Vorher stand hier nur ein Feld, und die Verwaltung versteckte sich hinter
   * dem zweiten Passwort, von dem auf diesem Bildschirm nichts stand. Das war
   * als Zurückhaltung gedacht und war in Wahrheit eine Sackgasse: Wer die
   * Liste pflegen sollte, fand den Weg nicht — und wer schon angemeldet war,
   * kam gar nicht mehr hierher zurück.
   *
   * Verborgen schützt ohnehin nichts. Was schützt, ist das Passwort. Also
   * steht die Wahl jetzt offen da, in zwei Worten, die keiner Erklärung
   * bedürfen.
   */
  const [zweck, setZweck] = useState<Zweck>(null);
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
        // Bei einem abgelehnten Passwort auf Groß- und Kleinschreibung
        // hinweisen, und zwar deutlich, wenn tatsächlich alles groß getippt
        // wurde. Genau das ist beim ersten Versuch passiert: Feststelltaste,
        // „NIMDA" statt „nimda", und die Meldung sagte nur „stimmt nicht".
        // Nachts um drei im Dunkeln kommt das wieder.
        const nurGross = password.length > 1
          && password === password.toUpperCase()
          && password !== password.toLowerCase();
        setError(
          res.status === 401
            ? `${data.error ?? "Passwort stimmt nicht"} — Groß- und Kleinschreibung zählt.` +
              (nurGross ? " Feststelltaste an?" : "")
            : data.error ?? "Anmeldung fehlgeschlagen",
        );
        return;
      }

      const session: store.Session = data;

      // Wer „Ticketliste pflegen" gewählt, aber das Einlasspasswort getippt
      // hat, bekommt es gesagt — statt sich hinterher zu fragen, warum
      // nirgends ein Bearbeiten-Knopf ist.
      if (zweck === "verwaltung" && !session.admin) {
        setError(
          "Das war das Einlasspasswort. Zum Pflegen der Liste braucht es das " +
          "Verwaltungspasswort.",
        );
        return;
      }

      await store.set("session", session);
      // Damit die App gleich dort landet, wo die Wahl hinzeigte.
      if (session.admin && zweck === "verwaltung") {
        await store.set("verwaltungGewuenscht", true);
      }
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

  if (zweck === null) {
    return (
      <div className="login">
        <Logo className="logo-lead" label="Herzberg Festival" />
        <h1>Wofür brauchst du die App?</h1>
        <p className="lead">Einmal für heute. Danach fragt sie nicht noch einmal.</p>

        <button
          type="button" className="wahl"
          onClick={() => { setZweck("scanner"); setError(null); }}
        >
          <span className="wahl-icon"><Icon.Camera /></span>
          <span>
            <b>Einlass scannen</b>
            <small>Tickets prüfen und Bändchen ausgeben. Das ist der Normalfall.</small>
          </span>
        </button>

        <button
          type="button" className="wahl"
          onClick={() => { setZweck("verwaltung"); setError(null); }}
        >
          <span className="wahl-icon"><Icon.List /></span>
          <span>
            <b>Ticketliste pflegen</b>
            <small>Namen nachtragen und Tickets ergänzen. Eigenes Passwort.</small>
          </span>
        </button>
      </div>
    );
  }

  const istVerwaltung = zweck === "verwaltung";

  return (
    <form className="login" onSubmit={submit}>
      <Logo className="logo-lead" label="Herzberg Festival" />
      <h1>{istVerwaltung ? "Ticketliste pflegen" : "Einlass scannen"}</h1>
      <p className="lead">
        {istVerwaltung
          ? "Dafür gibt es ein eigenes Passwort — nicht das vom Eingang."
          : "Einmal für heute. Beim Scannen fragt die App nicht noch einmal."}
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
            placeholder={istVerwaltung ? "Verwaltungspasswort" : "Von der Einlassleitung"}
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
          placeholder={istVerwaltung ? "z. B. Laptop Büro" : "z. B. Nordeingang 2"}
        />
        <small>
          {istVerwaltung
            ? "Beliebig — er steht später in der Geräteliste."
            : "Damit später erkennbar ist, an welcher Tür gescannt wurde."}
        </small>
      </label>

      {error && <p className="error" role="alert">{error}</p>}

      <button type="submit" className="btn primary wide" disabled={busy}>
        {busy ? "Einen Moment…" : "Anmelden"}
      </button>

      <button
        type="button" className="linky"
        onClick={() => { setZweck(null); setPassword(""); setError(null); }}
      >
        Zurück zur Auswahl
      </button>
    </form>
  );
}
