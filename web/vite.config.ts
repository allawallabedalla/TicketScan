import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Auf GitHub Pages liegt die App unter /TicketScan/, auf Cloudflare Pages
// unter der Wurzel. Der Unterpfad muss auch in Service-Worker-Scope und
// Manifest landen, sonst lässt sich die App nicht installieren.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  // Damit auf dem Gerät ablesbar ist, welche Fassung dort tatsächlich läuft.
  // Ohne diese Angabe ist aus der Ferne nicht zu unterscheiden, ob ein Fehler
  // noch besteht oder nur eine alte Fassung im Cache hängt.
  define: {
    __BUILD__: JSON.stringify(
      process.env.GITHUB_SHA?.slice(0, 7) ??
        new Date().toISOString().slice(0, 16).replace("T", " "),
    ),
  },
  plugins: [
    react(),
    VitePWA({
      // Neue Fassungen greifen sofort. Der Schutz vor einem fehlerhaften
      // Deploy während des Festivals ist nicht diese Einstellung, sondern der
      // abgeschaltete Ablauf — mit "prompt" hing dagegen jedes Gerät auf der
      // alten Fassung fest, solange niemand eine Abfrage dafür einbaut.
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "icon-512-maskable.png"],
      manifest: {
        name: "TicketScan",
        short_name: "TicketScan",
        description: "Einlasskontrolle am Festivaleingang",
        lang: "de",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#F1E7C8",
        theme_color: "#F1E7C8",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // Die 18 MB der Texterkennung bleiben aus dem Vorab-Cache heraus: Sie
        // würden die erste Installation lange und ohne Rückmeldung blockieren.
        // Stattdessen holt sie der Einrichtungsschritt sichtbar und mit
        // Fortschritt — und landet über diese Regel dauerhaft im Cache.
        globIgnores: ["**/tesseract/**"],
        runtimeCaching: [{
          urlPattern: ({ url }: { url: URL }) => url.pathname.includes("/tesseract/"),
          handler: "CacheFirst",
          options: {
            cacheName: "ticketscan-ocr",
            expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 120 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }],
      },
    }),
  ],
});
