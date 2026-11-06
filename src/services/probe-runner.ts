/** Serial execution of a native-validated probe script. No activation flags or eval. */
export type ProbeStep = {
  id: string;
  action: string;
  timeoutMs: number;
  args?: Record<string, string | number | boolean>;
};
export type ProbeScript = {
  schema: "prexu.probe.script";
  version: 1;
  runId: string;
  fixture: "av-cues-v1";
  timeoutMs: number;
  steps: ProbeStep[];
};
export type Observation = Record<string, string | number | boolean>;
export type ProbeRequest =
  | { operation: "ready" }
  | { operation: "begin"; id: string }
  | { operation: "end"; id: string; observed: Observation }
  | { operation: "fail"; code: ProbeFailureCode }
  | { operation: "cleanup" }
  | { operation: "finish"; clean: boolean };
export type ProbeFailureCode = "unsupported_action" | "step_timeout" | "predicate_failed" | "player_error";
export class ProbeFailure extends Error {
  constructor(readonly code: ProbeFailureCode) { super(code); }
}
export interface ProbeAdapter {
  /** Subscribe before dispatch; resolve only after the action's state predicate.
   * Abort must remove observers/timers and prevent any subsequent dispatch. */
  execute(step: ProbeStep, signal: AbortSignal): Promise<Observation>;
  /** Stop playback, release subscriptions, and verify native idle. */
  cleanup(signal: AbortSignal): Promise<void>;
}
export type ProbeTransport = (request: ProbeRequest) => Promise<ProbeScript | null>;

/** A deadline also covers hung IPC. The native writer remains authoritative. */
async function bounded<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProbeFailure("step_timeout"));
        }, Math.max(0, ms));
      }),
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new ProbeFailure("step_timeout");
        return work(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function runProbe(script: ProbeScript, send: ProbeTransport, adapter: ProbeAdapter): Promise<void> {
  const deadline = performance.now() + script.timeoutMs;
  try {
    for (const step of script.steps) {
      const remaining = Math.min(step.timeoutMs, deadline - performance.now());
      if (remaining <= 0) throw new ProbeFailure("step_timeout");
      await bounded(remaining, async (signal) => {
        await send({ operation: "begin", id: step.id });
        if (signal.aborted) throw new ProbeFailure("step_timeout");
        const observed = await adapter.execute(step, signal);
        if (signal.aborted) throw new ProbeFailure("step_timeout");
        await send({ operation: "end", id: step.id, observed });
      });
    }
  } catch (error) {
    // Never serialize exception messages, URLs, or arbitrary adapter payloads.
    // end may already have emitted a native failure; duplicate fail is rejected.
    await bounded(1000, () => send({
      operation: "fail", code: error instanceof ProbeFailure ? error.code : "player_error",
    })).catch(() => undefined);
  }
  // One budget covers both cleanup IPC and adapter teardown. If the IPC writer
  // is broken, still attempt local cleanup; never synthesize a passing marker.
  let clean = false;
  try {
    await bounded(9000, async (signal) => {
      let announced = false;
      try {
        await bounded(1000, () => send({ operation: "cleanup" }));
        announced = true;
      } finally {
        if (!signal.aborted) await adapter.cleanup(signal);
      }
      clean = announced && !signal.aborted;
    });
  } catch {
    clean = false;
  }
  await bounded(1000, () => send({ operation: "finish", clean }));
}

/** Own once per document, outside React effects. A rejected handshake must not
 * retry: native may have written run.begin before its reply was lost. */
export function createProbeStarter(send: ProbeTransport, adapter: ProbeAdapter): () => Promise<void> {
  let started: Promise<void> | undefined;
  return () => {
    started ??= (async () => {
      const script = await bounded(5000, () => send({ operation: "ready" }));
      if (script) await runProbe(script, send, adapter);
    })();
    return started;
  };
}
