// Einstiegs-Guide: erklärt in einfachen Schritten, wie die App auf den
// Home-Bildschirm kommt und wie ein Ticket gescannt wird.
//
// Die Anleitung richtet sich an Einlasshelfer, die das Gerät womöglich zum
// ersten Mal in der Hand halten und wenig Zeit haben. Deshalb: kurze Sätze,
// ein Schritt je Bildschirm, und nur die Anleitung, die zum jeweiligen Telefon
// passt.

import { type ReactNode, useEffect, useState } from "react";
import { detectPlatform, isInstalled, type Platform } from "../lib/platform";
import * as Icon from "./Icons";
import { Logo } from "./Logo";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Step {
  id: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
}

/** Nummerierter Handgriff mit Symbol — der wiederkehrende Baustein. */
function Move({ n, icon, children }: { n: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <li className="move">
      <span className="move-n">{n}</span>
      <span className="move-text">{children}</span>
      {icon && <span className="move-icon">{icon}</span>}
    </li>
  );
}

/** Kleines Merkmal mit Symbol, ohne Reihenfolge. */
function Perk({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="perk">
      <span className="perk-icon">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function buildSteps(platform: Platform, installed: boolean, installNow: (() => void) | null): Step[] {
  const steps: Step[] = [];

  if (!installed) {
    steps.push({
      id: "warum",
      eyebrow: "Bevor es losgeht",
      title: "Leg die App auf den Home-Bildschirm",
      body: (
        <>
          <Logo className="logo-lead" label="Herzberg Festival" />
          <p className="lead">
            Im Browser-Tab fehlt der App das Wichtigste. Vom Home-Bildschirm aus
            kann sie alles, was du am Eingang brauchst.
          </p>
          <ul className="perks">
            <Perk icon={<Icon.Wifi />}>
              <b>Sie läuft ohne Empfang.</b> Alle Ticketnummern liegen auf dem Telefon.
              Am Eingang ist das Netz oft weg — die App merkt es kaum.
            </Perk>
            <Perk icon={<Icon.Fullscreen />}>
              <b>Sie füllt den Bildschirm.</b> Keine Browser-Leisten, nichts zum
              Verrutschen, größere Knöpfe.
            </Perk>
            <Perk icon={<Icon.Scan />}>
              <b>Ein Tipp und du bist im Scanner.</b> Kein Suchen nach dem richtigen Tab.
            </Perk>
          </ul>
          <p className="aside">Das dauert eine halbe Minute. Danach nie wieder.</p>
        </>
      ),
    });

    if (platform === "ios-safari" || platform === "ios-other") {
      steps.push({
        id: "install",
        eyebrow: "Schritt für Schritt",
        title: "So kommt die App auf den Home-Bildschirm",
        body: (
          <>
            {platform === "ios-other" && (
              <div className="alert">
                <Icon.Warning />
                <p>
                  <b>Du bist gerade nicht in Safari.</b> Auf dem iPhone kann nur
                  Safari eine App installieren. Kopiere die Adresse und öffne
                  diese Seite in Safari.
                </p>
              </div>
            )}
            <ol className="moves">
              <Move n={1} icon={<Icon.Share />}>
                Tippe unten in der Leiste auf <b>Teilen</b>. Das ist das Quadrat
                mit dem Pfeil nach oben.
              </Move>
              <Move n={2} icon={<Icon.AddToHome />}>
                Wische in der Liste nach unten, bis <b>Zum Home-Bildschirm</b> kommt.
                Tippe darauf.
              </Move>
              <Move n={3}>
                Oben rechts auf <b>Hinzufügen</b>.
              </Move>
              <Move n={4} icon={<Icon.Safari />}>
                Schließe Safari. Öffne <b>TicketScan</b> ab jetzt immer über das
                neue Symbol auf dem Home-Bildschirm.
              </Move>
            </ol>
          </>
        ),
      });
    } else if (platform === "android") {
      steps.push({
        id: "install",
        eyebrow: "Schritt für Schritt",
        title: "So kommt die App auf den Startbildschirm",
        body: (
          <>
            {installNow ? (
              <>
                <p className="lead">Dein Telefon kann das in einem Schritt erledigen.</p>
                <button type="button" className="btn primary wide" onClick={installNow}>
                  <Icon.Install /> Jetzt installieren
                </button>
                <p className="aside">
                  Kommt kein Fenster? Dann geht es auch von Hand, siehe unten.
                </p>
              </>
            ) : null}
            <ol className="moves">
              <Move n={1} icon={<Icon.Menu />}>
                Tippe oben rechts auf die <b>drei Punkte</b>.
              </Move>
              <Move n={2} icon={<Icon.Install />}>
                Wähle <b>App installieren</b>. Je nach Telefon heißt es auch
                „Zum Startbildschirm zufügen“.
              </Move>
              <Move n={3}>
                Bestätige mit <b>Installieren</b>.
              </Move>
              <Move n={4}>
                Öffne <b>TicketScan</b> ab jetzt immer über das neue Symbol.
              </Move>
            </ol>
          </>
        ),
      });
    } else {
      steps.push({
        id: "install",
        eyebrow: "Kleiner Hinweis",
        title: "Am Eingang wird mit dem Telefon gescannt",
        body: (
          <>
            <p className="lead">
              Am Rechner kannst du alles ansehen und ausprobieren. Zum Scannen
              brauchst du ein Telefon mit Kamera.
            </p>
            <p className="aside">
              Öffne diese Seite auf dem Einlassgerät und leg sie dort auf den
              Home-Bildschirm.
            </p>
          </>
        ),
      });
    }
  }

  steps.push({
    id: "anmelden",
    eyebrow: "Einmal am Tag",
    title: "Passwort und Gerätename",
    body: (
      <>
        <ul className="perks">
          <Perk icon={<Icon.Lock />}>
            <b>Das Passwort bekommst du von der Einlassleitung.</b> Es ist für
            alle Geräte dasselbe.
          </Perk>
          <Perk icon={<Icon.Tag />}>
            <b>Gib dem Gerät einen Namen</b> — zum Beispiel „Nordeingang 2“.
            Damit ist später erkennbar, an welcher Tür ein Ticket gescannt wurde.
          </Perk>
          <Perk icon={<Icon.Check />}>
            <b>Beim Scannen fragt die App nie nach dem Passwort.</b> Auch nicht
            nach einer Pause oder wenn der Bildschirm aus war.
          </Perk>
        </ul>
        <p className="aside">
          Morgen früh fragt sie noch einmal. Mitten in der Schicht nie.
        </p>
      </>
    ),
  });

  steps.push({
    id: "kamera",
    eyebrow: "Einmalig",
    title: "Kamera erlauben",
    body: (
      <>
        <div className="hero-icon"><Icon.Camera /></div>
        <p className="lead">
          Beim ersten Scan fragt dein Telefon, ob die App die Kamera benutzen
          darf. Tippe auf <b>Erlauben</b>.
        </p>
        <p className="aside">
          Aus Versehen abgelehnt? Sag der Einlassleitung Bescheid — das lässt
          sich in den Telefon-Einstellungen wieder freigeben. Bis dahin kannst
          du die Nummern eintippen, das geht genauso.
        </p>
      </>
    ),
  });

  steps.push({
    id: "scannen",
    eyebrow: "Der Ablauf",
    title: "So gehst du ein Ticket durch",
    body: (
      <>
        <ol className="moves">
          <Move n={1} icon={<Icon.Scan />}>
            Halte die <b>Ticketnummer</b> in den Rahmen. Nicht das ganze
            Ticket — nur die Nummer.
          </Move>
          <Move n={2} icon={<Icon.Check />}>
            Warte auf <b>Grün</b>. Die Nummer erscheint groß auf dem Bildschirm.
          </Move>
          <Move n={3} icon={<Icon.Person />}>
            <b>Vergleiche sie mit dem Ticket</b> und tippe dann auf
            <b> Einlassen</b>. Dieser Blick ist wichtig: Er fängt Lesefehler ab.
            Steht ein <b>Name</b> darunter, vergleiche auch den. Fehlt er, ist
            das kein Grund, jemanden abzuweisen — viele Tickets haben keinen.
          </Move>
          <Move n={4} icon={<Icon.Tear />}>
            <b>Abschnitt abreißen</b>, Bändchen anlegen. Fertig.
          </Move>
        </ol>
        <div className="alert soft">
          <Icon.Keypad />
          <p>
            <b>Kamera will nicht?</b> Ticket verknittert, zu dunkel, nass —
            passiert. Tippe auf <b>Tastatur</b> und gib die vier Ziffern ein.
            Die erste Null steht schon da.
          </p>
        </div>
        <div className="alert soft">
          <Icon.List />
          <p>
            <b>Nummer gar nicht mehr lesbar?</b> Unter <b>Liste</b> stehen alle
            Tickets — was schon eingelöst ist und was noch offen. Dort lässt
            sich nach einem Teil der Nummer oder nach dem Namen suchen und das
            Ticket von Hand einlassen.
          </p>
        </div>
      </>
    ),
  });

  return steps;
}

export function QuickGuide({ onDone }: { onDone: () => void }) {
  const [platform] = useState(detectPlatform);
  const [installed, setInstalled] = useState(isInstalled);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const capture = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const done = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  const installNow = prompt
    ? () => {
        void prompt.prompt();
        void prompt.userChoice.then(({ outcome }) => {
          if (outcome === "accepted") setInstalled(true);
          setPrompt(null);
        });
      }
    : null;

  const steps = buildSteps(platform, installed, installNow);
  // Ändert sich die Schrittzahl mitten im Guide — etwa weil die Installation
  // gerade geklappt hat —, darf der Zeiger nicht ins Leere zeigen.
  const index = Math.min(at, steps.length - 1);
  const step = steps[index];
  const last = index === steps.length - 1;

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <header className="guide-head">
        <div className="dots" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.id} className={i === index ? "dot on" : "dot"} />
          ))}
        </div>
        <button type="button" className="skip" onClick={onDone}>
          Überspringen
        </button>
      </header>

      <main className="guide-body" key={step.id}>
        <p className="eyebrow">{step.eyebrow}</p>
        <h1 id="guide-title">{step.title}</h1>
        {step.body}
      </main>

      <footer className="guide-foot">
        {index > 0 && (
          <button type="button" className="btn" onClick={() => setAt(index - 1)}>
            Zurück
          </button>
        )}
        <button
          type="button"
          className="btn primary grow"
          onClick={() => (last ? onDone() : setAt(index + 1))}
        >
          {last ? "Los geht's" : "Weiter"}
        </button>
      </footer>
    </div>
  );
}
