// Vom erkannten Text zur Ticketnummer.
//
// Bewusst ohne Abhängigkeit zur Texterkennung: Diese Regeln entscheiden, was
// als Nummer durchgeht, und müssen deshalb für sich prüfbar sein.

/**
 * Häufige Verwechslungen der Erkennung, gezielt zurückgedreht.
 *
 * Ohne Ziffernzwang liest Tesseract an einer Ziffernfolge gelegentlich einen
 * Buchstaben. Das lässt sich aber nur an Stellen zurückdrehen, an denen ohnehin
 * eine Ziffer stehen muss — deshalb geschieht es erst nach der Zerlegung, nicht
 * vorher am ganzen Text.
 */
const CONFUSED: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0",
  I: "1", l: "1", i: "1", "|": "1", "!": "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  G: "6", b: "6",
  T: "7",
  B: "8",
  g: "9", q: "9",
};

/** Höchstens so viele Buchstaben je Folge dürfen zu Ziffern gedreht werden.
 *  Wer mehr dreht, liest keine Nummer mehr, sondern erfindet eine. */
const MAX_ERSETZUNGEN = 1;

/**
 * Zieht mögliche Ticketnummern aus dem erkannten Text.
 *
 * Angenommen wird nur, was genau die erwartete Stellenzahl hat und in der
 * lokalen Liste steht. Das hält Preis, Datum und Hotline zuverlässig fern.
 *
 * Es hält aber nicht alles fern, und dieser Satz stand hier früher zu
 * selbstbewusst: Bei 2305 fortlaufenden Nummern trifft ein Verleser an einer
 * der letzten drei Stellen zu 90 bis 99 Prozent wieder eine gültige Nummer.
 * Der Listenabgleich schützt praktisch nur die ersten beiden Stellen. Die
 * eigentliche Sicherung ist und bleibt der Bestätigungsschritt mit Nummer
 * und Namen vor Augen.
 *
 * Zwei Regeln halten den Rest klein:
 *
 * 1. Kein Fenster über längere Folgen mehr. Es machte aus dem Datum
 *    „20082027" die gültige Nummer 00820 und aus einer Strichcodezahl 00638 —
 *    jeweils genau ein Treffer, also für die Mehrfachbestätigung ununter-
 *    scheidbar von einer echten Lesung.
 * 2. Höchstens eine Buchstabenersetzung je Folge. „O2O27" wird damit nicht
 *    mehr zu 02027.
 *
 * Ein einzelnes O unmittelbar vor der Jahreszahl im Schriftzug ergibt
 * weiterhin 02027 — lexikalisch ist das von der echten Nummer nicht zu
 * unterscheiden. Dagegen hilft nur, den Ausschnitt gar nicht erst auf die
 * Schriftzugzeile zu legen; siehe findTextRegion in ocr.ts.
 */
export function extractCodes(text: string, width: number, known: (code: string) => boolean): string[] {
  const found = new Set<string>();

  // Zusammenhängende Folgen aus Ziffern und den Zeichen, die dafür gehalten
  // werden können.
  for (const token of text.match(/[0-9OoDQIlLi|!ZzSsGbTBgq]+/g) ?? []) {
    if (token.length !== width) continue;

    let ersetzt = 0;
    const digits = [...token].map((c) => {
      if (c >= "0" && c <= "9") return c;
      ersetzt++;
      return CONFUSED[c] ?? c;
    }).join("");

    if (ersetzt > MAX_ERSETZUNGEN) continue;
    if (!/^\d+$/.test(digits)) continue;
    if (known(digits)) found.add(digits);
  }

  return [...found];
}

