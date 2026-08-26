// Rückmeldung, die man nicht ansehen muss.
//
// Die Einlasskraft schaut auf das Ticket, nicht auf das Display. Ton und
// Vibration müssen die Entscheidung deshalb allein tragen können.

let audio: AudioContext | null = null;

/** Muss aus einer Nutzergeste heraus aufgerufen werden — sonst bleibt der
 *  Ton auf iOS stumm. Passiert beim Antippen von „Los geht's“. */
export function unlockSound(): void {
  audio ??= new (window.AudioContext ?? (window as unknown as {
    webkitAudioContext: typeof AudioContext
  }).webkitAudioContext)();
  void audio.resume();
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
