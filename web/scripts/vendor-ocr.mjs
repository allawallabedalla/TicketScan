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

// Alle sechs Kern-Varianten. tesseract entscheidet erst im Browser, welche es
// braucht — je nachdem, ob er relaxed SIMD, nur SIMD oder keines von beidem
// beherrscht. Safari 17 etwa kann SIMD, aber kein relaxed SIMD und fordert
// deshalb eine andere Datei an als Safari 18. Fehlt sie, bricht die Erkennung
// mit einem 404 ab, und zwar erst auf dem Gerät.
//
// Heruntergeladen wird zur Laufzeit immer nur eine davon. Die übrigen kosten
// nichts außer Platz im Bundle.
const CORE = [
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-relaxedsimd.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core.wasm.js",
];

const FILES = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ...CORE.map((name) => [`node_modules/tesseract.js-core/${name}`, name]),
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
