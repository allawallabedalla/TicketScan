// Rückmeldung, die man nicht ansehen muss.
//
// Die Einlasskraft schaut auf das Ticket, nicht auf das Display. Ton und
// Vibration müssen die Entscheidung deshalb allein tragen können.

let audio: AudioContext | null = null;

/** Muss aus einer Nutzergeste heraus aufgerufen werden — sonst bleibt der
 *  Ton auf iOS stumm. Passiert beim Antippen von „Los geht's“ und über
 *  `keepSoundUnlocked` bei jeder weiteren Berührung. */
export function unlockSound(): void {
  try {
    // Auf iOS folgt Web Audio sonst dem Stummschalter an der Seite. Die
    // Einstellung gibt es erst in neueren Safari-Fassungen; fehlt sie, bleibt
    // der Schalter maßgeblich — deshalb steht er auch in der Checkliste.
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== "playback") session.type = "playback";

    audio ??= new (window.AudioContext ?? (window as unknown as {
      webkitAudioContext: typeof AudioContext
    }).webkitAudioContext)();
    if (audio.state !== "running") void audio.resume();
  } catch { /* Kein Ton ist besser als ein Absturz beim Antippen. */ }
}

/**
 * Hält den Ton über die ganze Sitzung freigeschaltet.
 *
 * Vorher geschah das Freischalten ein einziges Mal: beim Abschluss der
 * Kurzanleitung, also beim allerersten Start. Jeder spätere Start — iOS
 * verwirft Web-Apps im Hintergrund regelmäßig — begann mit `audio = null`,
 * und `beep` kehrte stumm zurück. Auf einem iPhone, das nicht vibrieren kann,
 * gab es damit ab dem ersten Neustart überhaupt keine Rückmeldung mehr, ohne
 * dass es jemand bemerkt hätte: Die Einlasskraft schaut aufs Ticket.
 *
 * Dazu kommt, dass iOS einen laufenden Audiokontext nach Hintergrund, Anruf
 * oder Sperre auf „suspended" oder „interrupted" setzt. Auch das heilt nur
 * eine Geste. Also jede Berührung nutzen — der Aufruf ist billig, wenn der
 * Kontext schon läuft.
 */
export function keepSoundUnlocked(): void {
  const again = () => {
    if (!audio || audio.state !== "running") unlockSound();
  };
  for (const type of ["pointerdown", "touchend", "keydown"]) {
    document.addEventListener(type, again, { capture: true, passive: true });
  }
}

function beep(frequency: number, ms: number, delay = 0): void {
  if (!audio) return;
  const start = audio.currentTime + delay / 1000;

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = frequency;
  osc.type = "sine";

  // Weiche Flanken: ein hart geschalteter Ton knackt und klingt billig.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.35, start + 0.01);
  gain.gain.setValueAtTime(0.35, start + ms / 1000 - 0.03);
  gain.gain.linearRampToValueAtTime(0, start + ms / 1000);

  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + ms / 1000 + 0.02);
}

/** navigator.vibrate gibt es auf iOS nicht — deshalb trägt immer der Ton. */
function buzz(pattern: number | number[]): void {
  navigator.vibrate?.(pattern);
}

export const feedback = {
  ok() { beep(880, 120); buzz(40); },
  duplicate() { beep(600, 110); beep(600, 110, 160); buzz([50, 80, 50]); },
  unknown() { beep(200, 320); buzz(300); },
  tick() { beep(1200, 25); },
};
