#!/usr/bin/env node
// Legt alle Dateien der Texterkennung ins Bundle.
//
// Ohne das lädt tesseract.js Worker, WebAssembly und Sprachdaten von einem
// fremden CDN nach. Am Einlass ist das aus zwei Gründen inakzeptabel: ohne Netz
// gibt es keine Erkennung, und ein fremder Dienst wäre eine Abhängigkeit, die
// niemand von uns kontrolliert. Lokal abgelegt nimmt der Service Worker sie
// mit in den Cache.
//
//   node scripts/vendor-ocr.mjs

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { stderr, exit } from "node:process";

const OUT = "public/tesseract";

// Die relaxedsimd-Variante läuft auf allen aktuellen iPhones und Android-
// Geräten und ist deutlich schneller als der Aufbau ohne SIMD.
const FILES = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  // 4.0.0 ist die schnelle Variante. Für schwarze Ziffern auf weißem Etikett
  // reicht sie; die genauere wäre viermal so groß bei kaum besserem Ergebnis.
  ["node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz", "eng.traineddata.gz"],
];

mkdirSync(OUT, { recursive: true });

let total = 0;
for (const [from, name] of FILES) {
  try {
    copyFileSync(from, `${OUT}/${name}`);
    const size = statSync(`${OUT}/${name}`).size;
    total += size;
    stderr.write(`  ${name.padEnd(46)} ${(size / 1024 / 1024).toFixed(1)} MB\n`);
  } catch {
    stderr.write(`\nFehlt: ${from}\nZuerst \`npm install\` ausführen.\n`);
    exit(1);
  }
}

stderr.write(`\n${(total / 1024 / 1024).toFixed(1)} MB insgesamt — einmaliger Download beim Einrichten.\n`);
