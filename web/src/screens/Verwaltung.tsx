// Ticketliste pflegen — aus der App heraus, ohne Dashboard und ohne Terminal.
//
// Zwei Wege, weil es zwei Aufgaben sind:
//
//   Einzeln — eine Nummer suchen, Namen eintippen, fertig. Für den Anruf
//   „bei 00425 fehlt der Name“.
//
//   Als Liste einfügen — der Organisator schickt eine Tabelle, die kommt hier
//   per Zwischenablage rein. Das ist der eigentliche Grund für diesen
//   Bildschirm: 2305 Zeilen einzeln zu tippen macht niemand.
//
// Was hier NICHT geht, und zwar mit Absicht: den Einlassstand ändern und
// Tickets löschen. Der Endpunkt nimmt beides gar nicht entgegen. Wer eine
// Einlösung zurücknehmen will, tut das im Verlauf — das hinterlässt eine Spur
// im Protokoll, ein überschriebenes Feld nicht.

import { useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";
import * as store from "../lib/store";
import * as sync from "../lib/sync";
import * as Icon from "../onboarding/Icons";

/** Der Endpunkt nimmt 500 Zeilen je Anfrage. 2305 sind damit fünf Anfragen. */
const BLOCK = 500;

type Zeile = { code: string; holderName: string | null; category: string; note: string | null };

export function Verwaltung({ session, onClose }: {
  session: store.Session;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"einzeln" | "liste">("einzeln");

  return (
    <div className="sheet overlay list">
      <header className="list-head">
        <h1>Ticketliste pflegen</h1>
        <button type="button" className="btn" onClick={onClose}>Schließen</button>
      </header>

      <div className="tabs" role="group" aria-label="Art der Änderung">
        <button
          type="button" aria-pressed={tab === "einzeln"}
          className={tab === "einzeln" ? "tab on" : "tab"}
          onClick={() => setTab("einzeln")}
        >
          Einzeln
        </button>
        <button
          type="button" aria-pressed={tab === "liste"}
          className={tab === "liste" ? "tab on" : "tab"}
          onClick={() => setTab("liste")}
        >
          Liste einfügen
        </button>
      </div>

      {tab === "einzeln" ? <Einzeln session={session} /> : <AlsListe session={session} />}

      <p className="aside">
        Der Einlassstand lässt sich hier nicht ändern — weder setzen noch
        löschen. Eine Einlösung nimmt man im <b>Verlauf</b> zurück; das steht
        dann auch im Protokoll.
      </p>
    </div>
  );
}

// --------------------------------------------------------------- Einzeln --

function Einzeln({ session }: { session: store.Session }) {
  const [alle, setAlle] = useState<store.Ticket[]>([]);
  const [query, setQuery] = useState("");
  const [offen, setOffen] = useState<Zeile | null>(null);
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => { void store.allTickets().then(setAlle); }, [meldung]);

  const treffer = useMemo(() => {
    const ziffern = query.replace(/\D/g, "");
    const text = query.trim().toLowerCase();
    if (ziffern.length >= 2) return alle.filter((t) => t.code.includes(ziffern)).slice(0, 25);
    if (text.length >= 2) {
      return alle.filter((t) => t.holderName?.toLowerCase().includes(text)).slice(0, 25);
    }
    return [];
  }, [alle, query]);

  async function speichern() {
    if (!offen) return;
    setBusy(true);
    setFehler(null);
    try {
      await api.saveTickets(session, [offen]);
      // Sofort auch lokal, damit die Änderung nicht erst beim nächsten
      // Abgleich sichtbar wird.
      const vorhanden = await store.getTicket(offen.code);
      await store.putTickets([{
        code: offen.code,
        holderName: offen.holderName,
        category: offen.category,
        note: offen.note,
        redeemedAt: vorhanden?.redeemedAt ?? null,
        redeemedByDevice: vorhanden?.redeemedByDevice ?? null,
        pending: vorhanden?.pending,
      }]);
      setMeldung(`${offen.code} gespeichert.`);
      setOffen(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (offen) {
    return (
      <>
        <p className="lead">Ticket {group(offen.code)}</p>

        <label className="field">
          <span>Name</span>
          <input
            type="text" value={offen.holderName ?? ""} autoFocus maxLength={120}
            onChange={(e) => setOffen({ ...offen, holderName: e.target.value || null })}
            placeholder="leer lassen, wenn keiner hinterlegt ist"
          />
        </label>

        <label className="field">
          <span>Kategorie</span>
          <input
            type="text" value={offen.category} maxLength={60}
            onChange={(e) => setOffen({ ...offen, category: e.target.value })}
            placeholder="Festival-Ticket"
          />
        </label>

        <label className="field">
          <span>Vermerk</span>
          <input
            type="text" value={offen.note ?? ""} maxLength={300}
            onChange={(e) => setOffen({ ...offen, note: e.target.value || null })}
            placeholder="erscheint am Eingang gelb hinterlegt"
          />
        </label>

        {fehler && <p className="error" role="alert">{fehler}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={() => setOffen(null)}>Zurück</button>
          <button
            type="button" className="btn primary grow" disabled={busy}
            onClick={() => void speichern()}
          >
            {busy ? "…" : "Speichern"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="searchbox">
        <Icon.Search className="searchbox-icon" />
        <input
          type="text" value={query} autoFocus
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => { setQuery(e.target.value); setMeldung(null); }}
          placeholder="Nummer oder Name suchen"
          aria-label="Nummer oder Name suchen"
        />
      </div>

      {meldung && <p className="verdict ok">{meldung}</p>}

      <ul className="entries roster">
        {treffer.map((t) => (
          <li key={t.code} className={t.redeemedAt ? "done" : "open"}>
            <span className="mark" aria-hidden>
              {t.redeemedAt ? <Icon.Check /> : <span className="mark-open" />}
            </span>
            <span className="entry-lines">
              <span className="entry-code">{group(t.code)}</span>
              <span className={t.holderName ? "entry-name" : "entry-name none"}>
                {t.holderName ?? "ohne Namen"}
              </span>
              <span className="entry-meta">{t.category}{t.note ? ` · ${t.note}` : ""}</span>
            </span>
            <button
              type="button" className="btn small"
              onClick={() => setOffen({
                code: t.code, holderName: t.holderName,
                category: t.category, note: t.note,
              })}
            >
              Ändern
            </button>
          </li>
        ))}
      </ul>

      {query.trim().length >= 2 && treffer.length === 0 && (
        <p className="lead">Kein Treffer.</p>
      )}
    </>
  );
}

// ------------------------------------------------------- Liste einfügen --

function AlsListe({ session }: { session: store.Session }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ergebnis, setErgebnis] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  // Erst zeigen, was ankommen würde. Wer 2305 Zeilen einfügt, soll vorher
  // sehen, ob die führenden Nullen überlebt haben — der häufigste Fehler beim
  // Weg über eine Tabellenkalkulation.
  const gelesen = useMemo(() => lies(text), [text]);

  async function schreiben() {
    setBusy(true);
    setFehler(null);
    setErgebnis(null);
    try {
      let n = 0;
      for (let i = 0; i < gelesen.zeilen.length; i += BLOCK) {
        n += await api.saveTickets(session, gelesen.zeilen.slice(i, i + BLOCK));
      }
      // Den lokalen Bestand nachziehen, statt auf den Takt zu warten.
      await sync.pullChanges(session).catch(() => {});
      setErgebnis(`${n} Zeilen geschrieben.`);
      setText("");
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="lead">
        Eine Zeile je Ticket. Nummer zuerst, dann der Name — getrennt durch
        Komma, Semikolon oder Tabulator. Aus einer Tabellenkalkulation lässt
        sich die Spalte direkt hierher kopieren.
      </p>

      <pre className="facts">{`00425, Anna Weber
00426; Ben Weber
00427\tClara Meier
00428, , Crew
00429`}</pre>

      <p className="aside tight">
        Dritte Spalte ist die Kategorie, vierte ein Vermerk — beide dürfen
        fehlen. Eine Zeile nur mit Nummer legt ein Ticket ohne Namen an.
      </p>

      <label className="field">
        <span>Liste einfügen</span>
        <textarea
          value={text} rows={8}
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          placeholder="hier einfügen"
        />
      </label>

      {gelesen.fehler.length > 0 && (
        <p className="error" role="alert">
          {gelesen.fehler.length} {gelesen.fehler.length === 1 ? "Zeile ist" : "Zeilen sind"} unklar:
          {" "}{gelesen.fehler.slice(0, 3).join(" · ")}
          {gelesen.fehler.length > 3 && " …"}
        </p>
      )}

      {gelesen.zeilen.length > 0 && (
        <>
          <p className="verdict ok">
            {gelesen.zeilen.length} Zeilen erkannt, {gelesen.mitNamen} davon mit Namen.
            {" "}Stellen: {gelesen.stellen.join(", ")}.
          </p>
          {gelesen.stellen.length > 1 && (
            <p className="error" role="alert">
              Unterschiedlich viele Stellen — vermutlich sind beim Export die
              führenden Nullen verlorengegangen. So nicht übernehmen.
            </p>
          )}
        </>
      )}

      {ergebnis && <p className="verdict ok">{ergebnis}</p>}
      {fehler && <p className="error" role="alert">{fehler}</p>}

      <button
        type="button" className="btn primary wide"
        disabled={busy || gelesen.zeilen.length === 0 || gelesen.fehler.length > 0
          || gelesen.stellen.length > 1}
        onClick={() => void schreiben()}
      >
        {busy ? "Wird geschrieben…" : `${gelesen.zeilen.length} Zeilen übernehmen`}
      </button>

      <p className="aside">
        Nicht während des Einlasses: Eine Änderung an vielen Zeilen lässt jedes
        Telefon den Bestand neu ziehen. Vormittags ja, Freitagabend nicht.
      </p>
    </>
  );
}

/** Liest den eingefügten Text, ohne etwas zu erraten. */
function lies(text: string): {
  zeilen: Zeile[]; fehler: string[]; mitNamen: number; stellen: number[];
} {
  const zeilen: Zeile[] = [];
  const fehler: string[] = [];
  const stellen = new Set<number>();
  let mitNamen = 0;

  for (const roh of text.split(/\r?\n/)) {
    const zeile = roh.trim();
    if (!zeile) continue;
    // Kopfzeile einer Tabelle überspringen, statt sie als Ticket zu deuten.
    if (/^(code|nummer|ticket)\b/i.test(zeile)) continue;

    const teile = zeile.split(/[;,\t]/).map((t) => t.trim());
    const code = teile[0];
    if (!/^\d+$/.test(code)) {
      fehler.push(`„${zeile.slice(0, 24)}“`);
      continue;
    }
    stellen.add(code.length);
    const name = teile[1] || null;
    if (name) mitNamen++;
    zeilen.push({
      code,
      holderName: name,
      category: teile[2] || "Festival-Ticket",
      note: teile[3] || null,
    });
  }

  return { zeilen, fehler, mitNamen, stellen: [...stellen].sort((a, b) => a - b) };
}

function group(code: string): string {
  return code.replace(/(\d{2})(?=\d)/g, "$1 ");
}
