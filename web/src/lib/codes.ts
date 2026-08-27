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
 * Wie viele Zeichen eine Folge länger sein darf als die Nummer.
 *
 * Null wäre falsch, und das ist gemessen: Das Suchmuster oben enthält
 * absichtlich die Zeichen, die für Ziffern gehalten werden können — ein
 * senkrechter Strich neben der Nummer (Perforation, Etikettkante, Zierlinie)
 * landet damit im SELBEN Wort und wird zur Ziffer 1. Echter Tesseract-Rohtext
 * von einem gedruckten Ticket: „| 100425 §". Mit einer starren Längenprüfung
 * fiel das durch, und zwar nicht zufällig, sondern bei jedem Ticket derselben
 * Auflage — die Kameraerkennung wäre für alle 2305 Tickets auf null gefallen.
 *
 * Zwei Zeichen Spielraum holen das zurück und halten das Schädliche draußen:
 * Ein Datum ohne Trenner („20082027", acht Stellen) und eine Strichcodezahl
 * (dreizehn) liegen darüber und werden weiterhin verworfen.
 *
 * Was durchkommt: eine sechsstellige Telefongruppe wie „700900" ergibt 00900.
 * Das ist bewusst in Kauf genommen — sie müsste im Suchrahmen liegen, zweimal
 * hintereinander gleich gelesen werden, und am Ende steht der
 * Bestätigungsschritt mit Nummer und Namen vor Augen.
 */
const MAX_UEBERHANG = 2;

/**
 * Höchstens so viele Buchstaben je Folge dürfen zu Ziffern gedreht werden.
 *
 * Zwei, nicht einer: Alle 2305 Nummern beginnen mit einer Null, 999 davon mit
 * zwei — und O statt 0 ist die häufigste Verwechslung der Erkennung
 * überhaupt. „OO425" mit nur einer erlaubten Ersetzung zu verwerfen hieße,
 * genau den häufigsten Lesefehler auf genau der häufigsten Stelle nicht mehr
 * zurückdrehen zu können.
 */
const MAX_ERSETZUNGEN = 2;

/**
 * Zieht mögliche Ticketnummern aus dem erkannten Text.
 *
 * Angenommen wird nur, was in der lokalen Liste steht. Das hält Preis, Datum
 * und Hotline weitgehend fern — aber nicht alles, und dieser Satz stand hier
 * früher zu selbstbewusst: Bei 2305 fortlaufenden Nummern trifft ein Verleser
 * an einer der letzten drei Stellen zu 90 bis 99 Prozent wieder eine gültige
 * Nummer. Der Listenabgleich schützt praktisch nur die ersten beiden Stellen.
 * Die eigentliche Sicherung ist und bleibt der Bestätigungsschritt.
 *
 * Mehrere Treffer in einem Bild sind kein Problem, sondern der Schutz: Der
 * Aufrufer nimmt nur an, was eindeutig ist, und liest sonst weiter.
 */
export function extractCodes(text: string, width: number, known: (code: string) => boolean): string[] {
  const found = new Set<string>();

  // Zusammenhängende Folgen aus Ziffern und den Zeichen, die dafür gehalten
  // werden können.
  for (const token of text.match(/[0-9OoDQIlLi|!ZzSsGbTBgq]+/g) ?? []) {
    if (token.length < width || token.length > width + MAX_UEBERHANG) continue;

    for (let i = 0; i + width <= token.length; i++) {
      let ersetzt = 0;
      const digits = [...token.slice(i, i + width)].map((c) => {
        if (c >= "0" && c <= "9") return c;
        ersetzt++;
        return CONFUSED[c] ?? c;
      }).join("");

      if (ersetzt > MAX_ERSETZUNGEN) continue;
      if (!/^\d+$/.test(digits)) continue;
      if (known(digits)) found.add(digits);
    }
  }

  return [...found];
}
