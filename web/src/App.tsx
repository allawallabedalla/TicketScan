import { useCallback, useEffect, useState } from "react";
import { QuickGuide } from "./onboarding/QuickGuide";
import { Login } from "./screens/Login";
import { Setup } from "./screens/Setup";
import { Scanner } from "./screens/Scanner";
import * as store from "./lib/store";
import * as sync from "./lib/sync";
import { Unauthorized } from "./lib/api";
import { isInstalled } from "./lib/platform";
import { unlockSound } from "./lib/feedback";

type Stage = "laden" | "guide" | "login" | "setup" | "scanner";

/** Auffangnetz neben dem Realtime-Push: regelmäßig senden und nachziehen. */
const SYNC_INTERVAL = 20_000;

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

      // Der Guide zeigt sich beim ersten Start — und danach so lange erneut,
      // bis die App wirklich auf dem Home-Bildschirm liegt. Genau daran
      // scheitert es sonst am Eingang.
      if (!seen || !isInstalled()) setStage("guide");
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

  if (stage === "login") {
    return <Login onDone={(active) => { setSession(active); setStage("setup"); }} />;
  }

  if (stage === "setup" && session) {
    return <Setup session={session} onDone={() => setStage("scanner")} />;
  }

  if (stage === "scanner" && session) return <Scanner session={session} />;

  return <div className="boot" aria-busy="true" />;
}
