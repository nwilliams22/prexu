/**
 * Plays invite notification sounds using the Web Audio API.
 * Supports multiple built-in synthesized sounds and custom audio files.
 */

import type { BuiltinSound } from "../services/storage";
import {
  getInviteVolume,
  getInviteSoundConfig,
} from "../services/storage";

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

// ── Built-in synthesized sounds ──

function playChime(ctx: AudioContext, volume: number): void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, ctx.currentTime);

  // Tone 1: D5 (587 Hz), 200ms
  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(587, ctx.currentTime);
  osc1.connect(gain);
  osc1.start(ctx.currentTime);
  osc1.stop(ctx.currentTime + 0.2);

  // Tone 2: G5 (784 Hz), 200ms
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(784, ctx.currentTime + 0.22);
  osc2.connect(gain);
  osc2.start(ctx.currentTime + 0.22);
  osc2.stop(ctx.currentTime + 0.42);

  gain.gain.setValueAtTime(volume, ctx.currentTime + 0.38);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
}

function playBell(ctx: AudioContext, volume: number): void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, ctx.currentTime);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.6);
  osc.connect(gain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.6);

  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
}

function playPop(ctx: AudioContext, volume: number): void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, ctx.currentTime);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
  osc.connect(gain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);

  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
}

function playPing(ctx: AudioContext, volume: number): void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, ctx.currentTime);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1200, ctx.currentTime);
  osc.connect(gain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);

  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
}

function playSoft(ctx: AudioContext, volume: number): void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume * 0.6, ctx.currentTime + 0.05);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(523, ctx.currentTime);
  osc.connect(gain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);

  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
  osc2.connect(gain);
  osc2.start(ctx.currentTime + 0.15);
  osc2.stop(ctx.currentTime + 0.5);

  gain.gain.setValueAtTime(volume * 0.6, ctx.currentTime + 0.4);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.55);
}

const BUILTIN_PLAYERS: Record<BuiltinSound, (ctx: AudioContext, vol: number) => void> = {
  chime: playChime,
  bell: playBell,
  pop: playPop,
  ping: playPing,
  soft: playSoft,
};

// ── Custom audio file playback (from data URL) ──

async function playCustomFromDataUrl(ctx: AudioContext, volume: number, dataUrl: string): Promise<void> {
  try {
    const response = await fetch(dataUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.warn("[NotificationSound] Failed to play custom sound, falling back to chime:", err);
    playChime(ctx, volume);
  }
}

// ── Public API ──

/**
 * Play the configured notification sound at the configured volume.
 * Loads settings from storage each time so changes take effect immediately.
 */
export async function playNotificationSound(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const [volume, config] = await Promise.all([
    getInviteVolume(),
    getInviteSoundConfig(),
  ]);

  if (volume <= 0) return;

  if (config.sound === "custom" && config.customDataUrl) {
    await playCustomFromDataUrl(ctx, volume, config.customDataUrl);
  } else {
    const player = BUILTIN_PLAYERS[config.sound as BuiltinSound] ?? playChime;
    player(ctx, volume);
  }
}

/**
 * Preview a specific built-in sound at a given volume.
 * Used in the settings UI so users can hear sounds before selecting.
 */
export function previewSound(sound: BuiltinSound, volume: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  if (volume <= 0) return;

  const player = BUILTIN_PLAYERS[sound] ?? playChime;
  player(ctx, volume);
}

/**
 * Preview a custom audio file from a data URL at a given volume.
 */
export async function previewCustomDataUrl(dataUrl: string, volume: number): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  if (volume <= 0) return;
  await playCustomFromDataUrl(ctx, volume, dataUrl);
}
