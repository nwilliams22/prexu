import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { readProbeBootstrap } from "./probe-bootstrap";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(isTauri).mockReturnValue(true); });
afterEach(() => { vi.useRealTimers(); });
describe("native probe bootstrap", () => {
  it("does not contact IPC in a browser", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect(await readProbeBootstrap()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("preserves normal debug and release startup", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    expect(await readProbeBootstrap()).toBeNull();
    vi.mocked(invoke).mockRejectedValueOnce("Command probe_driver not found");
    expect(await readProbeBootstrap()).toBeNull();
  });
  it("never falls back to ordinary auth on an IPC failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("private information");
    await expect(readProbeBootstrap()).rejects.toThrow("probe_bootstrap_failed");
  });
  it("bounds a lost bootstrap reply", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReturnValueOnce(new Promise(() => {}));
    const result = expect(readProbeBootstrap()).rejects.toThrow("probe_bootstrap_failed");
    await vi.advanceTimersByTimeAsync(5001);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{}, { fixtureUrl: "http://example.com:1234" },
    { fixtureUrl: "http://127.0.0.1:0" }, { fixtureUrl: "http://127.0.0.1:65536" },
    { fixtureUrl: "http://127.0.0.1:1234/path" }])("rejects malformed bootstrap %j", async value => {
    vi.mocked(invoke).mockResolvedValueOnce(value);
    await expect(readProbeBootstrap()).rejects.toThrow("probe_bootstrap_failed");
  });
  it("creates synthetic in-memory auth only from native bootstrap", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ fixtureUrl: "http://127.0.0.1:1234" });
    const auth = await readProbeBootstrap();
    expect(invoke).toHaveBeenCalledWith("probe_driver", { request: { operation: "bootstrap" } });
    expect(auth?.server?.uri).toBe("http://127.0.0.1:1234");
    expect(auth?.isAuthenticated).toBe(true);
    expect(auth?.authToken).toBeNull();
    await expect(auth?.login("ignored")).rejects.toThrow("unsupported_action");
  });
});
