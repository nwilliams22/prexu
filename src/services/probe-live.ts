import type { UsePlayerResult } from "../hooks/usePlayer";
import { checkProbeAbort, observeProbe, observeProbePlay, type ProbeSnapshot } from "./probe-observer";
import { ProbeFailure, type ProbeAdapter, type ProbeStep, type Observation } from "./probe-runner";

/** Registered only by committed React effects; never from render. */
export interface ProbePlayer {
  player: UsePlayerResult;
  stop(): Promise<void>;
  toggleFullscreen(): void;
  togglePopout(): void;
  minimize(): void;
  restore(): void;
  mini: boolean;
  popout: boolean;
  supportsMini: boolean;
  supportsPopout: boolean;
}
export const probeLive: { player: ProbePlayer | null } = { player: null };

export interface ProbeHost {
  play(): void;
  stop(): void;
  hasSession(): boolean;
  route(): string;
  navigate(route: string): void;
  snapshot(): Promise<ProbeSnapshot>;
  windowMinimize(): Promise<void>;
  windowRestore(): Promise<void>;
  windowMinimized(): Promise<boolean>;
}

export function createLiveProbeAdapter(host: ProbeHost): ProbeAdapter {
  const current = () => {
    const live = probeLive.player;
    if (!live || live.player.engine !== "native") throw new ProbeFailure("player_error");
    if (live.player.playbackError) throw new ProbeFailure("player_error");
    return live;
  };
  const observe = <T>(signal: AbortSignal, read: () => Promise<T>, accepts: (value: T) => boolean) =>
    observeProbe(signal, read, accepts);
  const native = (signal: AbortSignal, accepts: (value: ProbeSnapshot) => boolean) =>
    observe(signal, host.snapshot, (value) => {
      current();
      return value.initialized && !value.idle && value.fixtureMatches && accepts(value);
    });
  const stopped = (signal: AbortSignal) => observe(signal, host.snapshot,
    (value) => !host.hasSession() && !value.initialized && value.idle);
  const stop = async (signal: AbortSignal) => {
    checkProbeAbort(signal);
    if (probeLive.player) await probeLive.player.stop();
    else host.stop();
    checkProbeAbort(signal);
    await stopped(signal);
  };
  return {
    cleanup: stop,
    async execute(step: ProbeStep, signal: AbortSignal): Promise<Observation> {
      checkProbeAbort(signal);
      const args = step.args ?? {};
      switch (step.action) {
        case "play":
          if (host.hasSession()) throw new ProbeFailure("predicate_failed");
          return observeProbePlay(signal, host.snapshot, host.play);
        case "stop":
          await stop(signal);
          return { sessionCleared: true, idle: true };
        case "quit":
          await stopped(signal);
          return { ready: true };
        case "wait": {
          const start = performance.now();
          const duration = Number(args.durationMs);
          const elapsed = await observe(signal, async () => performance.now() - start, (v) => v >= duration);
          return { durationMs: elapsed };
        }
        case "navigate":
          host.navigate(String(args.route));
          return { route: await observe(signal, async () => host.route(), (v) => v === args.route) };
        case "windowMinimize":
        case "windowRestore": {
          const minimized = step.action === "windowMinimize";
          await (minimized ? host.windowMinimize() : host.windowRestore());
          await observe(signal, host.windowMinimized, (v) => v === minimized);
          return { minimized };
        }
        case "seek": {
          current().player.seek(Number(args.positionMs) / 1000);
          const value = await native(signal, (v) => v.positionMs !== null &&
            Math.abs(v.positionMs - Number(args.positionMs)) <= Number(args.toleranceMs));
          return { positionMs: value.positionMs! };
        }
        case "pause":
        case "resume": {
          const paused = step.action === "pause";
          const before = await native(signal, (v) => v.paused !== null);
          checkProbeAbort(signal);
          if (before.paused !== paused) current().player.togglePlay();
          await native(signal, (v) => v.paused === paused);
          return { paused };
        }
        case "selectAudio":
        case "selectSubtitle": {
          const live = current().player;
          const trackId = Number(args.trackId);
          const audio = step.action === "selectAudio";
          const tracks = audio ? live.audioTracks : live.subtitleTracks.filter((track) => !track.key);
          const track = tracks[trackId - 1];
          if (audio || trackId !== 0) {
            if (!track) throw new ProbeFailure("player_error");
            if (audio) live.selectAudioTrack(track.id);
            else live.selectSubtitleTrack(track.id);
          } else live.selectSubtitleTrack(null);
          await native(signal, (v) => (audio ? v.audioTrack : v.subtitleTrack) === trackId);
          return { trackId };
        }
        case "fullscreen":
        case "miniPlayer":
        case "popout": {
          const live = current();
          const enabled = Boolean(args.enabled);
          const read = () => {
            const state = current();
            return step.action === "fullscreen" ? state.player.isFullscreen :
              step.action === "miniPlayer" ? state.mini : state.popout;
          };
          if ((step.action === "miniPlayer" && !live.supportsMini) ||
              (step.action === "popout" && !live.supportsPopout)) throw new ProbeFailure("unsupported_action");
          if (read() !== enabled) {
            if (step.action === "fullscreen") live.toggleFullscreen();
            else if (step.action === "popout") live.togglePopout();
            else if (enabled) live.minimize();
            else live.restore();
          }
          await observe(signal, async () => read(), (v) => v === enabled);
          return { enabled };
        }
        case "setSetting": {
          if (args.name !== "volume") throw new ProbeFailure("unsupported_action");
          const value = Number(args.value);
          current().player.setVolume(value / 100);
          await observe(signal, async () => current().player.volume, (v) => Math.abs(v * 100 - value) < 0.0001);
          return { name: "volume", value };
        }
        default: throw new ProbeFailure("unsupported_action");
      }
    },
  };
}
