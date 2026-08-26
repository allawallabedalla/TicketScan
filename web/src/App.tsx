import { useEffect, useState } from "react";
import { QuickGuide } from "./onboarding/QuickGuide";
import { Login } from "./screens/Login";
import * as store from "./lib/store";
import { isInstalled } from "./lib/platform";

type Stage = "laden" | "guide" | "login" | "scanner";

export function App() {
  const [stage, setStage] = useState<Stage>("laden");
  const [session, setSession] = useState<store.Session | null>(null);

  useEffect(() => {
    void (async () => {
      const [seen, active] = await Promise.all([
        store.get<boolean>("guideSeen"),
        store.loadSession(),
      ]);
      setSession(active);

      // Der Guide zeigt sich beim ersten Start — und danach so lange erneut,
      // bis die App wirklich auf dem Home-Bildschirm liegt. Genau daran
      // scheitert es sonst am Eingang.
      if (!seen || !isInstalled()) setStage("guide");
      else setStage(active ? "scanner" : "login");
    })();
  }, []);

  if (stage === "laden") return <div className="boot" aria-busy="true" />;

  if (stage === "guide") {
    return (
      <QuickGuide
        onDone={() => {
          void store.set("guideSeen", true);
          setStage(session ? "scanner" : "login");
        }}
      />
    );
  }

  if (stage === "login") {
    return <Login onDone={(active) => { setSession(active); setStage("scanner"); }} />;
  }

  return (
    <div className="placeholder">
      <h1>Scanner</h1>
      <p className="lead">
        Angemeldet als <b>{session?.label}</b>.
      </p>
      <p className="aside">
        Kameraerfassung und Zifferntastatur folgen in Schritt 2 des
        Umsetzungsplans — sie hängen am Spike zur Texterkennung.
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => { void store.remove("guideSeen"); setStage("guide"); }}
      >
        Kurzanleitung noch einmal ansehen
      </button>
    </div>
  );
}
