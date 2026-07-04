/**
 * Tests for the engine resolution matrix + session-fallback pub-sub
 * (prexu-axj4.4).
 *
 * resolveEngineChoice is a pure function — table-driven over
 * platform x playerEngine pref x session-fallback. The pub-sub tests cover
 * the false→true edge notification contract that PlayerOverlay relies on
 * to force a Player remount.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveEngineChoice,
  isSessionFallbackActive,
  setSessionFallbackActive,
  subscribeToEngineFallback,
  __resetEngineFallbackForTests,
  type EngineResolutionInput,
  type ResolvedEngine,
} from "./engineResolution";
import type { PlayerEnginePreference } from "../../types/preferences";

describe("resolveEngineChoice", () => {
  const cases: Array<{
    name: string;
    input: EngineResolutionInput;
    expected: ResolvedEngine;
  }> = [
    // ── Platform incapable (web, or Tauri on macOS) — always HTML5 ──
    {
      name: "platform incapable + auto pref + no fallback → html5",
      input: { platformCapable: false, playerEngine: "auto", sessionFallback: false },
      expected: "html5",
    },
    {
      name: "platform incapable + native pref (irrelevant) → html5",
      input: { platformCapable: false, playerEngine: "native", sessionFallback: false },
      expected: "html5",
    },
    {
      name: "platform incapable + html5 pref → html5",
      input: { platformCapable: false, playerEngine: "html5", sessionFallback: false },
      expected: "html5",
    },
    {
      name: "platform incapable + fallback active → html5",
      input: { platformCapable: false, playerEngine: "auto", sessionFallback: true },
      expected: "html5",
    },

    // ── Platform capable (Windows or Linux native), no fallback ──
    {
      name: "platform capable + auto → native",
      input: { platformCapable: true, playerEngine: "auto", sessionFallback: false },
      expected: "native",
    },
    {
      name: "platform capable + native → native",
      input: { platformCapable: true, playerEngine: "native", sessionFallback: false },
      expected: "native",
    },
    {
      name: "platform capable + html5 (explicit opt-out) → html5",
      input: { platformCapable: true, playerEngine: "html5", sessionFallback: false },
      expected: "html5",
    },

    // ── Platform capable, session fallback already active ──
    {
      name: "platform capable + auto + fallback active → html5",
      input: { platformCapable: true, playerEngine: "auto", sessionFallback: true },
      expected: "html5",
    },
    {
      name: "platform capable + native + fallback active → html5",
      input: { platformCapable: true, playerEngine: "native", sessionFallback: true },
      expected: "html5",
    },
    {
      name: "platform capable + html5 + fallback active → html5",
      input: { platformCapable: true, playerEngine: "html5", sessionFallback: true },
      expected: "html5",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(resolveEngineChoice(input)).toBe(expected);
    });
  }

  // Exhaustive sweep over every combination as a belt-and-suspenders check
  // that the matrix above didn't miss a cell, and that the function never
  // throws or returns something outside ResolvedEngine.
  it("exhaustive sweep: every combination resolves to a valid engine", () => {
    const platformValues = [true, false];
    const prefValues: PlayerEnginePreference[] = ["auto", "native", "html5"];
    const fallbackValues = [true, false];
    for (const platformCapable of platformValues) {
      for (const playerEngine of prefValues) {
        for (const sessionFallback of fallbackValues) {
          const result = resolveEngineChoice({ platformCapable, playerEngine, sessionFallback });
          expect(["native", "html5"]).toContain(result);
          // Native is only ever possible when the platform is capable,
          // the pref didn't force html5, and no fallback is active.
          if (result === "native") {
            expect(platformCapable).toBe(true);
            expect(playerEngine).not.toBe("html5");
            expect(sessionFallback).toBe(false);
          }
        }
      }
    }
  });
});

describe("session fallback flag + pub-sub", () => {
  beforeEach(() => {
    __resetEngineFallbackForTests();
  });

  it("starts inactive", () => {
    expect(isSessionFallbackActive()).toBe(false);
  });

  it("setSessionFallbackActive(true) flips the flag", () => {
    setSessionFallbackActive(true);
    expect(isSessionFallbackActive()).toBe(true);
  });

  it("notifies subscribers on the false→true edge", () => {
    let calls = 0;
    subscribeToEngineFallback(() => {
      calls++;
    });
    setSessionFallbackActive(true);
    expect(calls).toBe(1);
  });

  it("does not notify again on a redundant true→true set", () => {
    let calls = 0;
    subscribeToEngineFallback(() => {
      calls++;
    });
    setSessionFallbackActive(true);
    setSessionFallbackActive(true);
    expect(calls).toBe(1);
  });

  it("does not notify on false (no edge)", () => {
    let calls = 0;
    subscribeToEngineFallback(() => {
      calls++;
    });
    setSessionFallbackActive(false);
    expect(calls).toBe(0);
  });

  it("unsubscribe stops further notifications", () => {
    let calls = 0;
    const unsubscribe = subscribeToEngineFallback(() => {
      calls++;
    });
    unsubscribe();
    setSessionFallbackActive(true);
    expect(calls).toBe(0);
  });

  it("one listener throwing does not prevent others from running", () => {
    let secondCalls = 0;
    subscribeToEngineFallback(() => {
      throw new Error("boom");
    });
    subscribeToEngineFallback(() => {
      secondCalls++;
    });
    expect(() => setSessionFallbackActive(true)).not.toThrow();
    expect(secondCalls).toBe(1);
  });
});

// SUPPORTS_PLAYER_MINIMIZE / SUPPORTS_PLAYER_POPOUT are module-level consts
// derived from navigator.userAgent + window.__TAURI_INTERNALS__ at import
// time (prexu-axj4.5 split of the old combined SUPPORTS_PLAYER_WINDOWING).
// Exercising the full platform matrix means controlling those globals
// BEFORE the module is evaluated, so each case stubs userAgent + the Tauri
// marker, force-reloads the module via vi.resetModules(), then dynamically
// imports a fresh copy and reads its exports.
describe("SUPPORTS_PLAYER_MINIMIZE / SUPPORTS_PLAYER_POPOUT platform matrix", () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
    });
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  async function loadEngineResolution(tauri: boolean, userAgent: string) {
    vi.resetModules();
    if (tauri) {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    } else {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
    Object.defineProperty(navigator, "userAgent", {
      value: userAgent,
      configurable: true,
    });
    return import("./engineResolution");
  }

  it("Windows native (Tauri + Windows UA): minimize and popout both supported", async () => {
    const mod = await loadEngineResolution(
      true,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    expect(mod.SUPPORTS_PLAYER_MINIMIZE).toBe(true);
    expect(mod.SUPPORTS_PLAYER_POPOUT).toBe(true);
    expect(mod.IS_LINUX_NATIVE_PLAYER).toBe(false);
  });

  it("Linux native (Tauri + Linux UA): minimize AND popout supported (prexu-axj4.10)", async () => {
    const mod = await loadEngineResolution(true, "Mozilla/5.0 (X11; Linux x86_64)");
    expect(mod.SUPPORTS_PLAYER_MINIMIZE).toBe(true);
    expect(mod.SUPPORTS_PLAYER_POPOUT).toBe(true);
    expect(mod.IS_LINUX_NATIVE_PLAYER).toBe(true);
  });

  it("HTML5 / non-Tauri (no __TAURI_INTERNALS__): neither minimize nor popout supported", async () => {
    const mod = await loadEngineResolution(
      false,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    expect(mod.SUPPORTS_PLAYER_MINIMIZE).toBe(false);
    expect(mod.SUPPORTS_PLAYER_POPOUT).toBe(false);
    expect(mod.IS_LINUX_NATIVE_PLAYER).toBe(false);
  });

  it("Tauri on an unsupported OS (e.g. macOS): neither minimize nor popout supported", async () => {
    const mod = await loadEngineResolution(
      true,
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    );
    expect(mod.SUPPORTS_PLAYER_MINIMIZE).toBe(false);
    expect(mod.SUPPORTS_PLAYER_POPOUT).toBe(false);
    expect(mod.IS_LINUX_NATIVE_PLAYER).toBe(false);
  });
});
