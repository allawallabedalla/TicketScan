import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Auf GitHub Pages liegt die App unter /TicketScan/, auf Cloudflare Pages
// unter der Wurzel. Der Unterpfad muss auch in Service-Worker-Scope und
// Manifest landen, sonst lässt sich die App nicht installieren.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
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
        background_color: "#101317",
        theme_color: "#101317",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Die Sprachdaten der Texterkennung sind groß und ändern sich nie —
        // sie müssen mit in den Cache, sonst steht die App ohne Netz still.
        globPatterns: ["**/*.{js,css,html,png,svg,woff2,wasm,traineddata,gz}"],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
      },
    }),
  ],
});
