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

/**
 * Zieht mögliche Ticketnummern aus dem erkannten Text.
 *
 * Angenommen wird nur, was die erwartete Stellenzahl hat und in der lokalen
 * Liste steht. Diese Prüfung so früh vorzunehmen ist der wirksamste Filter
 * überhaupt: Von allem, was die Erkennung sonst noch aufschnappt — Preis,
 * Datum, Hotline, Schriftzug — bleibt nichts übrig.
 */
export function extractCodes(text: string, width: number, known: (code: string) => boolean): string[] {
  const found = new Set<string>();

  // Zusammenhängende Folgen aus Ziffern und den Zeichen, die dafür gehalten
  // werden können.
  for (const token of text.match(/[0-9OoDQIlLi|!ZzSsGbTBgq]+/g) ?? []) {
    const digits = [...token].map((c) => CONFUSED[c] ?? c).join("");
    if (!/^\d+$/.test(digits)) continue;

    // Genau passend, oder eine längere Folge, aus der ein Fenster passt —
    // Tesseract hängt an Ziffernfolgen gern ein Zeichen an.
    for (let i = 0; i + width <= digits.length; i++) {
      const candidate = digits.slice(i, i + width);
      if (known(candidate)) found.add(candidate);
    }
  }

  return [...found];
}

