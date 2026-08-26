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

export interface Frame {
  canvas: HTMLCanvasElement;
  /** Wurde das Etikett gefunden? Sonst wurde der ganze Rahmen ausgewertet. */
  found: boolean;
  /** Fundstelle in Anteilen der angezeigten Fläche, für die Anzeige. */
  box: { x: number; y: number; w: number; h: number } | null;
  /** Auflösung, mit der die Kamera tatsächlich liefert. */
  source: { w: number; h: number };
}

const analysis = document.createElement("canvas");

/**
 * Sucht Text innerhalb des Rahmens — über Kantendichte, nicht über Farbe.
 *
 * Das ist der entscheidende Schritt für den Abstand: Statt das ganze Rahmenband
 * auf Lesegröße herunterzurechnen, wobei die Ziffern mitschrumpfen, wird nur
 * die Textstelle ausgeschnitten, und zwar in voller Kameraauflösung. Das wirkt
 * wie ein Zoom auf die Nummer, ohne dass jemand näher herangehen muss.
 *
 * Gesucht wird bewusst nichts Ticketspezifisches. Ein weißer Aufkleber wäre ein
 * bequemes Merkmal, aber das nächste Ticket sieht anders aus. Was Text dagegen
 * immer auszeichnet: viele dicht beieinander liegende Hell-dunkel-Wechsel.
 * Papier, Farbe und Untergrund spielen dabei keine Rolle, helle Schrift auf
 * dunklem Grund funktioniert genauso wie umgekehrt.
 */
function findTextRegion(
  video: HTMLVideoElement,
  region: { sx: number; sy: number; sw: number; sh: number },
) {
  const W = 240;
  const H = Math.max(8, Math.round((region.sh / region.sw) * W));
  analysis.width = W;
  analysis.height = H;

  const ctx = analysis.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, region.sx, region.sy, region.sw, region.sh, 0, 0, W, H);

  const px = ctx.getImageData(0, 0, W, H).data;
  const grey = new Uint8Array(W * H);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    grey[g] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
  }

  // Waagerechte Helligkeitssprünge. Ziffern erzeugen davon viele auf engem
  // Raum; eine Papierkante erzeugt einen einzelnen, eine gleichmäßige Fläche
  // keinen.
  const edge = new Uint8Array(W * H);
  let sum = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W - 1; x++) {
      const at = y * W + x;
      const d = Math.abs(grey[at + 1] - grey[at - 1]);
      edge[at] = d;
      sum += d;
    }
  }

  // Schwelle relativ zum Bildinhalt, damit sie bei jedem Licht passt.
  const limit = Math.max(18, (sum / (W * H)) * 2.2);

  const perRow = new Int32Array(H);
  const perColumn = new Int32Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (edge[y * W + x] >= limit) { perRow[y]++; perColumn[x]++; }
    }
  }

  /** Längster zusammenhängender Abschnitt oberhalb eines Schwellwerts. */
  const run = (profile: Int32Array, floor: number) => {
    let bestFrom = -1, bestTo = -1, from = -1;
    for (let i = 0; i <= profile.length; i++) {
      const inside = i < profile.length && profile[i] >= floor;
      if (inside && from === -1) from = i;
      if (!inside && from !== -1) {
        if (i - from > bestTo - bestFrom) { bestFrom = from; bestTo = i; }
        from = -1;
      }
    }
    return bestFrom === -1 ? null : { from: bestFrom, to: bestTo };
  };

  // Zeilen zuerst: Text bildet ein waagerechtes Band.
  const peakRow = Math.max(...perRow);
  const rows = run(perRow, Math.max(3, peakRow * 0.35));
  if (!rows) return null;

  // Spalten nur innerhalb dieses Bandes zählen, sonst zieht Struktur darüber
  // oder darunter den Ausschnitt in die Breite.
  const inBand = new Int32Array(W);
  for (let y = rows.from; y < rows.to; y++) {
    for (let x = 0; x < W; x++) if (edge[y * W + x] >= limit) inBand[x]++;
  }
  const bandHeight = rows.to - rows.from;
  const cols = run(inBand, Math.max(1, bandHeight * 0.18));
  if (!cols) return null;

  const width = cols.to - cols.from;
  if (width < W * 0.05 || bandHeight < 4) return null;
  // Eine Ziffernfolge ist breiter als hoch. Alles andere ist kein Text.
  if (width / bandHeight < 1.1) return null;

  const padX = width * 0.08;
  const padY = bandHeight * 0.35;
  const scaleX = region.sw / W;
  const scaleY = region.sh / H;

  const left = Math.max(0, cols.from - padX);
  const top = Math.max(0, rows.from - padY);

  return {
    sx: region.sx + left * scaleX,
    sy: region.sy + top * scaleY,
    sw: Math.min(W - left, width + 2 * padX) * scaleX,
    sh: Math.min(H - top, bandHeight + 2 * padY) * scaleY,
  };
}

/**
 * Bereitet ein Einzelbild für die Erkennung vor: Etikett suchen, in voller
 * Auflösung ausschneiden, auf Lesegröße bringen, schwarzweiß machen.
 *
 * Vergrößert wird nie — Hochskalieren fügt keine Information hinzu.
 */
export function prepareFrame(
  video: HTMLVideoElement,
  roi: { x: number; y: number; w: number; h: number },
  canvas: HTMLCanvasElement,
  targetHeight = 120,
): Frame {
  const region = roiInVideo(video, roi);
  const found = findTextRegion(video, region);
  const crop = found ?? region;

  const scale = Math.min(targetHeight / crop.sh, 1);
  canvas.width = Math.max(1, Math.round(crop.sw * scale));
  canvas.height = Math.max(1, Math.round(crop.sh * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;

  const histogram = new Array(256).fill(0);
  const grey = new Uint8Array(px.length / 4);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const value = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
    grey[g] = value;
    histogram[value]++;
  }

  // Die Schwelle stammt aus dem Bild selbst — derselbe Code arbeitet damit bei
  // Sonne wie bei Lampenlicht.
  const threshold = otsu(histogram, grey.length);

  let dark = 0;
  for (let g = 0; g < grey.length; g++) if (grey[g] <= threshold) dark++;
  // Überwiegt das Dunkle, steht die Schrift hell auf dunklem Grund. Tesseract
  // erwartet das Gegenteil, also umdrehen — damit ist die Erkennung auch von
  // der Gestaltung des Aufdrucks unabhängig.
  const invert = dark > grey.length * 0.55;

  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const bright = grey[g] > threshold;
    const value = (invert ? !bright : bright) ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = value;
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  return {
    canvas,
    found: found !== null,
    box: found ? videoToElement(video, found) : null,
    source: { w: video.videoWidth, h: video.videoHeight },
  };
}

/** Rückweg: Videokoordinaten in Anteile der angezeigten Fläche. */
function videoToElement(
  video: HTMLVideoElement,
  r: { sx: number; sy: number; sw: number; sh: number },
) {
  const ew = video.clientWidth, eh = video.clientHeight;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!ew || !eh || !vw || !vh) return null;

  const scale = Math.max(ew / vw, eh / vh);
  const offX = (vw * scale - ew) / 2;
  const offY = (vh * scale - eh) / 2;

  return {
    x: (r.sx * scale - offX) / ew,
    y: (r.sy * scale - offY) / eh,
    w: (r.sw * scale) / ew,
    h: (r.sh * scale) / eh,
  };
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
