// Texterkennung im Browser.
//
// Alle Bestandteile liegen im Bundle (siehe scripts/vendor-ocr.mjs) — kein
// fremdes CDN, damit die Erkennung auch ohne Netz arbeitet.
//
// Zwei Dinge machen den Unterschied zwischen brauchbar und unbrauchbar:
// ein eng zugeschnittener Ausschnitt statt des ganzen Bildes, und die
// Mehrfachbestätigung über mehrere Einzelbilder. Ein einzelnes Leseergebnis
// wird nie angenommen.

import { createWorker, type Worker } from "tesseract.js";

const ASSETS = `${import.meta.env.BASE_URL}tesseract/`;

let worker: Worker | null = null;
let starting: Promise<Worker> | null = null;

export async function startOcr(onProgress?: (ratio: number) => void): Promise<Worker> {
  if (worker) return worker;

  starting ??= createWorker("eng", 1, {
    workerPath: `${ASSETS}worker.min.js`,
    langPath: ASSETS,
    corePath: ASSETS,
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "loading tesseract core" || m.status === "loading language traineddata") {
        onProgress?.(m.progress);
      }
    },
  }).then(async (w) => {
    await w.setParameters({
      // Nur Ziffern. Schließt die klassischen Verwechslungen zwischen 0 und O
      // sowie 1 und l von vornherein aus.
      tessedit_char_whitelist: "0123456789",
      // Der Ausschnitt enthält genau eine Zeile.
      tessedit_pageseg_mode: "7" as unknown as never,
    });
    worker = w;
    return w;
  }).catch((err) => {
    starting = null;
    // Die Ursache ist fast immer eine fehlende Datei unter ASSETS, und die
    // Meldung von tesseract nennt sie nicht. Ohne diesen Zusatz steht auf dem
    // Gerät nur „Unbekannter Fehler“.
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Texterkennung konnte nicht starten (${ASSETS}): ${cause}`);
  });

  return starting;
}

export async function stopOcr(): Promise<void> {
  const w = worker;
  worker = null;
  starting = null;
  await w?.terminate();
}

/**
 * Bildet den auf dem Bildschirm gezeigten Rahmen auf das Videobild ab.
 *
 * Das Videobild füllt die Fläche mit `object-fit: cover`, wird also
 * beschnitten. Ein Rahmen bei 42 % der Bildschirmhöhe liegt deshalb nicht bei
 * 42 % der Videohöhe. Ohne diese Umrechnung wertet die App eine andere Stelle
 * aus als die, die sie dem Benutzer anzeigt — und der rückt so lange näher
 * heran, bis die Nummer zufällig in den ausgewerteten Bereich gerät.
 */
function roiInVideo(
  video: HTMLVideoElement,
  roi: { x: number; y: number; w: number; h: number },
) {
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  if (!ew || !eh || !vw || !vh) {
    return { sx: roi.x * vw, sy: roi.y * vh, sw: roi.w * vw, sh: roi.h * vh };
  }

  // cover: das Video wird so skaliert, dass es die Fläche vollständig
  // bedeckt; der Überstand fällt links/rechts oder oben/unten weg.
  const scale = Math.max(ew / vw, eh / vh);
  const offX = (vw * scale - ew) / 2;
  const offY = (vh * scale - eh) / 2;

  return {
    sx: (roi.x * ew + offX) / scale,
    sy: (roi.y * eh + offY) / scale,
    sw: (roi.w * ew) / scale,
    sh: (roi.h * eh) / scale,
  };
}

/**
 * Schneidet den Suchrahmen aus dem Videobild, bringt ihn auf eine für die
 * Erkennung günstige Höhe und wandelt ihn in reines Schwarzweiß.
 *
 * Vergrößert wird dabei nie: Hochskalieren fügt keine Information hinzu, es
 * kostet nur Rechenzeit. Ob aus der Entfernung gelesen werden kann, entscheidet
 * allein die Auflösung, mit der die Kamera aufnimmt.
 *
 * Die Schwelle wird nach Otsu aus dem Bild selbst bestimmt, statt fest
 * vorgegeben — damit funktioniert derselbe Code bei Sonne und bei Lampenlicht.
 */
export function prepareFrame(
  video: HTMLVideoElement,
  roi: { x: number; y: number; w: number; h: number },
  canvas: HTMLCanvasElement,
  targetHeight = 110,
): HTMLCanvasElement {
  const { sx, sy, sw, sh } = roiInVideo(video, roi);

  const scale = Math.min(targetHeight / sh, 1);
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;

  const histogram = new Array(256).fill(0);
  const grey = new Uint8Array(px.length / 4);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const value = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
    grey[g] = value;
    histogram[value]++;
  }

  const threshold = otsu(histogram, grey.length);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const value = grey[g] > threshold ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = value;
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  return canvas;
}

/** Schwellwert nach Otsu: die Teilung, die die beiden Helligkeitsgruppen am
 *  deutlichsten trennt. */
function otsu(histogram: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumBackground = 0, countBackground = 0, best = 0, threshold = 127;

  for (let i = 0; i < 256; i++) {
    countBackground += histogram[i];
    if (countBackground === 0) continue;
    const countForeground = total - countBackground;
    if (countForeground === 0) break;

    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / countBackground;
    const meanForeground = (sum - sumBackground) / countForeground;
    const between = countBackground * countForeground *
      (meanBackground - meanForeground) ** 2;

    if (between > best) { best = between; threshold = i; }
  }
  return threshold;
}

/**
 * Sammelt Leseergebnisse und gibt eine Nummer erst frei, wenn sie mehrfach
 * hintereinander gleich gelesen wurde.
 *
 * Automatisch korrigiert wird dabei nichts: Bei fortlaufenden Nummern ist zu
 * jeder Nummer auch die Nachbarnummer gültig, die App hätte für eine Korrektur
 * keine Grundlage und würde raten. Also: übereinstimmend gelesen und in der
 * Liste vorhanden — oder weiterlesen.
 */
export class Consensus {
  private recent: string[] = [];

  constructor(private needed = 3, private memory = 5) {}

  /** Gibt die Nummer zurück, sobald sie oft genug bestätigt wurde. */
  offer(reading: string | null): string | null {
    if (reading) {
      this.recent.push(reading);
      if (this.recent.length > this.memory) this.recent.shift();
    } else {
      // Ein leeres Bild löscht die Historie nicht sofort — die Hand zittert,
      // und ein einzelnes unscharfes Bild soll nicht von vorn anfangen lassen.
      this.recent.shift();
    }

    const counts = new Map<string, number>();
    for (const value of this.recent) counts.set(value, (counts.get(value) ?? 0) + 1);

    for (const [value, count] of counts) {
      if (count >= this.needed) return value;
    }
    return null;
  }

  reset(): void {
    this.recent = [];
  }
}

/** Liest den vorbereiteten Ausschnitt. Gibt nur zurück, was zur erwarteten
 *  Stellenzahl passt. */
export async function readFrame(canvas: HTMLCanvasElement, width: number): Promise<string | null> {
  const w = worker;
  if (!w) return null;

  const { data } = await w.recognize(canvas);
  const digits = (data.text ?? "").replace(/\D/g, "");
  return digits.length === width ? digits : null;
}
