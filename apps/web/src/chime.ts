// "La lezione è pronta" signal: a short rising arpeggio (WebAudio, no file), a vibration on phones,
// and a tab-title mark while the page is in the background. Follows the "Suoni" switch.
import { readPref } from "@pv/engine";

const NOTES = [784, 988, 1319]; // G5 B5 E6

export function readyChime(): void {
  if (readPref("sounds")) {
    try {
      const ctx = new AudioContext();
      const t0 = ctx.currentTime + 0.05;
      NOTES.forEach((freq, i) => {
        const at = t0 + i * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.25, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 1);
      });
      setTimeout(() => void ctx.close(), 1600);
    } catch {
      // No WebAudio: the vibration and the title still signal it.
    }
  }
  navigator.vibrate?.([120, 80, 120]);
  if (document.hidden) {
    const title = document.title;
    document.title = "✓ Lezione pronta · AnimaPage";
    document.addEventListener("visibilitychange", () => (document.title = title), { once: true });
  }
}
