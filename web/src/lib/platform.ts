// Welche Anleitung jemand braucht, hängt am Telefon in seiner Hand.
// iOS-Schritte einem Android-Nutzer zu zeigen, stiftet mehr Verwirrung als
// Hilfe — deshalb erkennen wir die Umgebung, statt beides nebeneinander zu
// zeigen.

export type Platform = "ios-safari" | "ios-other" | "android" | "desktop";

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;

  // Ein iPad mit iPadOS meldet sich als Macintosh; der Touchscreen verrät es.
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isIOS) {
    // Chrome, Firefox und Edge auf iOS können nichts installieren — das kann
    // dort nur Safari.
    return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios-safari";
  }
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** Läuft die App bereits vom Home-Bildschirm statt im Browser-Tab? */
export function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    // Safari auf iOS kennt display-mode nicht und meldet es hierüber.
    (navigator as { standalone?: boolean }).standalone === true;
}
