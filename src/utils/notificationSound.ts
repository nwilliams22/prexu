/**
 * Plays a short two-tone chime using the Web Audio API.
 * No external audio files needed — synthesized on the fly.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

export function playNotificationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume context if suspended (browsers require user gesture first)
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);

  // Tone 1: D5 (587 Hz), 200ms
  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(587, ctx.currentTime);
  osc1.connect(gain);
  osc1.start(ctx.currentTime);
  osc1.stop(ctx.currentTime + 0.2);

  // Tone 2: G5 (784 Hz), 200ms, starts after tone 1
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(784, ctx.currentTime + 0.22);
  osc2.connect(gain);
  osc2.start(ctx.currentTime + 0.22);
  osc2.stop(ctx.currentTime + 0.42);

  // Fade out to avoid click
  gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.38);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
}
