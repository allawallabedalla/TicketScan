// Hinweisleiste, solange die App nur im Browser-Tab läuft.
//
// Die Kurzanleitung deswegen bei jedem Start erneut zu zeigen war zu grob: Wer
// sie einmal gesehen hat, will sie nicht wieder wegklicken müssen. Eine
// schmale Leiste erinnert weiterhin daran, lässt sich aber wegtippen — und
// kommt am nächsten Tag zurück, weil es bis dahin wirklich erledigt sein
// sollte.

import { useEffect, useState } from "react";
import * as store from "../lib/store";
import { isInstalled } from "../lib/platform";
import * as Icon from "./Icons";

export function InstallHint({ onOpen }: { onOpen: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isInstalled()) return;
    void store.get<string>("hintHiddenUntil").then((until) => {
      setShow(!until || Date.parse(until) < Date.now());
    });
  }, []);

  if (!show) return null;

  const hide = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    void store.set("hintHiddenUntil", tomorrow.toISOString());
    setShow(false);
  };

  return (
    <aside className="hint-bar">
      <Icon.Fullscreen />
      <button type="button" className="hint-text" onClick={onOpen}>
        <b>Noch im Browser.</b> Am Eingang braucht die App den Home-Bildschirm —
        so anzeigen.
      </button>
      <button type="button" className="hint-close" onClick={hide} aria-label="Ausblenden">
        &times;
      </button>
    </aside>
  );
}
