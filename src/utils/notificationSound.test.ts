import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage so playNotificationSound can read settings
vi.mock("../services/storage", () => ({
  getInviteVolume: vi.fn(() => Promise.resolve(0.5)),
  getInviteSoundConfig: vi.fn(() => Promise.resolve({ sound: "chime" })),
}));

// We need fresh module state for each test since the module caches audioCtx
beforeEach(() => {
  vi.resetModules();
});

describe("playNotificationSound", () => {
  it("creates AudioContext and calls createOscillator and createGain", async () => {
    const createOscillator = vi.fn(() => ({
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    const createGain = vi.fn(() => ({
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
    }));

    vi.stubGlobal(
      "AudioContext",
      class {
        currentTime = 0;
        state = "running";
        destination = {};
        createOscillator = createOscillator;
        createGain = createGain;
        resume = vi.fn(() => Promise.resolve());
      },
    );

    const { playNotificationSound } = await import("./notificationSound");
    await playNotificationSound();

    expect(createOscillator).toHaveBeenCalledTimes(2);
    expect(createGain).toHaveBeenCalledOnce();
  });

  it("does not crash when AudioContext is unavailable", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("not supported");
        }
      },
    );

    const { playNotificationSound } = await import("./notificationSound");
    await expect(playNotificationSound()).resolves.not.toThrow();
  });

  it("resumes suspended context", async () => {
    const resume = vi.fn(() => Promise.resolve());

    vi.stubGlobal(
      "AudioContext",
      class {
        currentTime = 0;
        state = "suspended";
        destination = {};
        createOscillator = vi.fn(() => ({
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }));
        createGain = vi.fn(() => ({
          connect: vi.fn(),
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
          },
        }));
        resume = resume;
      },
    );

    const { playNotificationSound } = await import("./notificationSound");
    await playNotificationSound();
    expect(resume).toHaveBeenCalled();
  });

  it("reuses AudioContext on subsequent calls", async () => {
    let constructorCount = 0;

    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          constructorCount++;
        }
        currentTime = 0;
        state = "running";
        destination = {};
        createOscillator = vi.fn(() => ({
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }));
        createGain = vi.fn(() => ({
          connect: vi.fn(),
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
          },
        }));
        resume = vi.fn(() => Promise.resolve());
      },
    );

    const { playNotificationSound } = await import("./notificationSound");
    await playNotificationSound();
    await playNotificationSound();
    await playNotificationSound();

    expect(constructorCount).toBe(1);
  });
});
