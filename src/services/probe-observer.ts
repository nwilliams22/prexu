import { ProbeFailure } from "./probe-runner";

/** Native IPC omits paths and preserves unknown properties as null. */
export interface ProbeSnapshot {
  initialized: boolean;
  idle: boolean;
  fixtureMatches: boolean;
  positionMs: number | null;
  paused: boolean | null;
  audioTrack: number | null;
  subtitleTrack: number | null;
}

export function checkProbeAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new ProbeFailure("step_timeout");
}

/** Poll live state instead of accepting untagged, potentially stale events.
 * The runner owns deadlines. Abort removes timers and rejects immediately,
 * including when an in-flight native IPC never replies. */
export async function observeProbe<T>(
  signal: AbortSignal,
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
): Promise<T> {
  checkProbeAbort(signal);
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (value?: T, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(undefined, new ProbeFailure("step_timeout"));
    const sample = async () => {
      try {
        checkProbeAbort(signal);
        const value = await read();
        if (settled) return;
        checkProbeAbort(signal);
        if (accepts(value)) finish(value);
        else timer = setTimeout(() => void sample(), 100);
      } catch (error) {
        finish(undefined, error);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    void sample();
  });
}

/** Every play must cross an absent-handle boundary before dispatch. Two
 * post-dispatch samples must then show this fixture's time advancing. */
export async function observeProbePlay(
  signal: AbortSignal,
  read: () => Promise<ProbeSnapshot>,
  play: () => void,
): Promise<{ loaded: true; positionMs: number }> {
  await observeProbe(signal, read, (value) => !value.initialized);
  checkProbeAbort(signal);
  play();
  let previous: number | null = null;
  const snapshot = await observeProbe(signal, read, (value) => {
    if (!value.initialized || value.idle || !value.fixtureMatches || value.paused !== false ||
        value.positionMs === null || !Number.isFinite(value.positionMs) || value.positionMs < 0) {
      previous = null;
      return false;
    }
    const advancing = previous !== null && value.positionMs > previous;
    previous = value.positionMs;
    return advancing;
  });
  return { loaded: true, positionMs: snapshot.positionMs! };
}
