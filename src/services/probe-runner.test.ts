import { afterEach, describe, expect, it, vi } from "vitest";
import { createProbeStarter, ProbeFailure, runProbe, type ProbeAdapter, type ProbeRequest, type ProbeScript } from "./probe-runner";

const script: ProbeScript = {
  schema: "prexu.probe.script", version: 1, runId: "test", fixture: "av-cues-v1", timeoutMs: 1000,
  steps: [{ id: "wait", action: "wait", timeoutMs: 100, args: { durationMs: 1 } },
    { id: "quit", action: "quit", timeoutMs: 100 }],
};
function setup() {
  const requests: ProbeRequest[] = [];
  const send = vi.fn(async (request: ProbeRequest) => {
    requests.push(request);
    return request.operation === "ready" ? script : null;
  });
  const adapter: ProbeAdapter = {
    execute: vi.fn(async (step) => step.action === "quit" ? { ready: true } : { durationMs: 1 }),
    cleanup: vi.fn(async () => {}),
  };
  return { requests, send, adapter };
}
afterEach(() => { vi.useRealTimers(); });
describe("probe runner", () => {
  it("handshakes and executes once across repeated starts", async () => {
    const { requests, send, adapter } = setup();
    const start = createProbeStarter(send, adapter);
    const first = start();
    expect(start()).toBe(first);
    await first;
    await start();
    expect(requests.map(r => r.operation)).toEqual(["ready", "begin", "end", "begin", "end", "cleanup", "finish"]);
    expect(requests.at(-1)).toEqual({ operation: "finish", clean: true });
    expect(adapter.execute).toHaveBeenCalledTimes(2);
    expect(adapter.cleanup).toHaveBeenCalledTimes(1);
  });
  it("does not retry a lost handshake reply", async () => {
    const { adapter } = setup();
    const send = vi.fn(async () => { throw new Error("lost"); });
    const start = createProbeStarter(send, adapter);
    await expect(start()).rejects.toThrow("lost");
    await expect(start()).rejects.toThrow("lost");
    expect(send).toHaveBeenCalledTimes(1);
    expect(adapter.execute).not.toHaveBeenCalled();
  });
  it("stops on first failure and never sends private exception text", async () => {
    const { requests, send, adapter } = setup();
    vi.mocked(adapter.execute).mockRejectedValue(new Error("private URL"));
    await runProbe(script, send, adapter);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(requests.map(r => r.operation)).toEqual(["begin", "fail", "cleanup", "finish"]);
    expect(requests[1]).toEqual({ operation: "fail", code: "player_error" });
    expect(JSON.stringify(requests)).not.toContain("private");
  });
  it("preserves allowlisted capability failures", async () => {
    const { requests, send, adapter } = setup();
    vi.mocked(adapter.execute).mockRejectedValue(new ProbeFailure("unsupported_action"));
    await runProbe(script, send, adapter);
    expect(requests[1]).toEqual({ operation: "fail", code: "unsupported_action" });
  });
  it("aborts hung steps and ignores late observations", async () => {
    vi.useFakeTimers();
    const { requests, send, adapter } = setup();
    let complete!: (value: { ready: boolean }) => void;
    let signal!: AbortSignal;
    vi.mocked(adapter.execute).mockImplementation((_step, current) => {
      signal = current;
      return new Promise(resolve => { complete = resolve; });
    });
    const running = runProbe(script, send, adapter);
    await vi.advanceTimersByTimeAsync(101);
    await running;
    expect(signal.aborted).toBe(true);
    complete({ ready: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.map(r => r.operation)).toEqual(["begin", "fail", "cleanup", "finish"]);
    expect(requests[1]).toEqual({ operation: "fail", code: "step_timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not dispatch after a timed out begin IPC resolves", async () => {
    vi.useFakeTimers();
    const { send, adapter } = setup();
    let release!: () => void;
    send.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(null); }));
    const running = runProbe(script, send, adapter);
    await vi.advanceTimersByTimeAsync(101);
    await running;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(adapter.cleanup).toHaveBeenCalledOnce();
  });
  it("reports failed cleanup and bounds a hung teardown", async () => {
    vi.useFakeTimers();
    const { requests, send, adapter } = setup();
    let signal!: AbortSignal;
    vi.mocked(adapter.cleanup).mockImplementation(current => {
      signal = current;
      return new Promise(() => {});
    });
    const running = runProbe(script, send, adapter);
    await vi.advanceTimersByTimeAsync(9001);
    await running;
    expect(signal.aborted).toBe(true);
    expect(requests.at(-1)).toEqual({ operation: "finish", clean: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans locally when the marker channel rejects cleanup", async () => {
    const { send, adapter } = setup();
    send.mockImplementation(async request => {
      if (request.operation === "cleanup") throw new Error("marker_io");
      return null;
    });
    await runProbe(script, send, adapter);
    expect(adapter.cleanup).toHaveBeenCalledOnce();
    expect(send).toHaveBeenLastCalledWith({ operation: "finish", clean: false });
  });
  it("enforces the whole run deadline across individually valid steps", async () => {
    vi.useFakeTimers();
    const { requests, send, adapter } = setup();
    vi.mocked(adapter.execute).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
      return { durationMs: 60 };
    });
    const running = runProbe({ ...script, timeoutMs: 90 }, send, adapter);
    await vi.advanceTimersByTimeAsync(91);
    await running;
    expect(requests.filter(r => r.operation === "end")).toHaveLength(1);
    expect(requests).toContainEqual({ operation: "fail", code: "step_timeout" });
    await vi.advanceTimersByTimeAsync(100);
    expect(requests.filter(r => r.operation === "end")).toHaveLength(1);
  });
  it("attempts local teardown even when cleanup IPC never replies", async () => {
    vi.useFakeTimers();
    const { send, adapter } = setup();
    send.mockImplementation(async request => {
      if (request.operation === "cleanup") return new Promise(() => {});
      return null;
    });
    const running = runProbe(script, send, adapter);
    await vi.advanceTimersByTimeAsync(1001);
    await running;
    expect(adapter.cleanup).toHaveBeenCalledOnce();
    expect(send).toHaveBeenLastCalledWith({ operation: "finish", clean: false });
    expect(vi.getTimerCount()).toBe(0);
  });

});
