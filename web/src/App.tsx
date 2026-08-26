import { useCallback, useEffect, useState } from "react";
import { QuickGuide } from "./onboarding/QuickGuide";
import { Login } from "./screens/Login";
import { Setup } from "./screens/Setup";
import { Scanner } from "./screens/Scanner";
import * as store from "./lib/store";
import * as sync from "./lib/sync";
import { Unauthorized } from "./lib/api";
import { InstallHint } from "./onboarding/InstallHint";
import { unlockSound } from "./lib/feedback";

type Stage = "laden" | "guide" | "login" | "setup" | "scanner";

/**
 * Takt des Abgleichs.
 *
 * Das Konzept sah zusätzlich einen Realtime-Push vor. Der ist bewusst
 * entfallen: Ein Abo auf die Ticket-Tabelle würde voraussetzen, der
 * öffentlichen Rolle Leserechte zu geben — genau die, die Migration 0002 ihr
 * ausdrücklich entzieht. Diese Absicherung für eine Sekunde Latenz aufzugeben
 * wäre ein schlechter Tausch.
 *
 * Acht Sekunden halten das Fenster für Doppeleinlösungen klein genug: In dieser
 * Zeit müsste dasselbe Ticket an zwei Geräten vorgelegt werden.
 */
const SYNC_INTERVAL = 8_000;

export function App() {
  const [stage, setStage] = useState<Stage>("laden");
  const [session, setSession] = useState<store.Session | null>(null);

  useEffect(() => {
    void (async () => {
      const [seen, active, ready] = await Promise.all([
        store.get<boolean>("guideSeen"),
        store.loadSession(),
        store.get<boolean>("setupDone"),
      ]);
      setSession(active);

      // Nur beim ersten Start. Ihn bis zur Installation bei jedem Öffnen zu
      // wiederholen war zu aufdringlich — wer ihn kennt, wird stattdessen von
      // einer schmalen Leiste erinnert, die sich wegtippen lässt.
      if (!seen) setStage("guide");
      else if (!active) setStage("login");
      else setStage(ready ? "scanner" : "setup");
    })();
  }, []);

  // Der Speicher einer Web-App darf vom Betriebssystem geräumt werden. Ohne
  // diese Bitte stünde ein Gerät im schlechtesten Fall ohne Ticketliste da.
  useEffect(() => {
    void navigator.storage?.persist?.();
  }, []);

  const runSync = useCallback(async (active: store.Session) => {
    try {
      await sync.syncOnce(active);
    } catch (err) {
      // Kein Netz ist der Normalfall und kein Grund für eine Meldung. Nur ein
      // abgelaufenes Token führt zurück zur Anmeldung.
      if (err instanceof Unauthorized) {
        setSession(null);
        setStage("login");
      }
    }
  }, []);

  useEffect(() => {
    if (stage !== "scanner" || !session) return;

    void runSync(session);
    const timer = window.setInterval(() => void runSync(session), SYNC_INTERVAL);
    const onBack = () => void runSync(session);
    window.addEventListener("online", onBack);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onBack);
    };
  }, [stage, session, runSync]);

  if (stage === "laden") return <div className="boot" aria-busy="true" />;

  if (stage === "guide") {
    return (
      <QuickGuide
        onDone={async () => {
          // Aus der Geste heraus, sonst bleibt der Ton auf iOS stumm.
          unlockSound();
          await store.set("guideSeen", true);
          const ready = await store.get<boolean>("setupDone");
          setStage(!session ? "login" : ready ? "scanner" : "setup");
        }}
      />
    );
  }

  const hint = <InstallHint onOpen={() => setStage("guide")} />;

  if (stage === "login") {
    return (
      <>
        {hint}
        <Login onDone={(active) => { setSession(active); setStage("setup"); }} />
      </>
    );
  }

  if (stage === "setup" && session) {
    return <>{hint}<Setup session={session} onDone={() => setStage("scanner")} /></>;
  }

  if (stage === "scanner" && session) return <Scanner session={session} />;

  return <div className="boot" aria-busy="true" />;
}
