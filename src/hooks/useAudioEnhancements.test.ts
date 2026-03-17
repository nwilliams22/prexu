import { renderHook, act } from "@testing-library/react";
import { useAudioEnhancements } from "./useAudioEnhancements";

// ── Mock Web Audio API ──

function createMockGainNode() {
  return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
}

function createMockCompressorNode() {
  return {
    threshold: { value: 0 },
    knee: { value: 40 },
    ratio: { value: 1 },
    attack: { value: 0.003 },
    release: { value: 0.25 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMockDelayNode() {
  return {
    delayTime: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMockSourceNode() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

let mockGain: ReturnType<typeof createMockGainNode>;
let mockCompressor: ReturnType<typeof createMockCompressorNode>;
let mockDelay: ReturnType<typeof createMockDelayNode>;
let mockSource: ReturnType<typeof createMockSourceNode>;
let mockClose: ReturnType<typeof vi.fn>;
let mockResume: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGain = createMockGainNode();
  mockCompressor = createMockCompressorNode();
  mockDelay = createMockDelayNode();
  mockSource = createMockSourceNode();
  mockClose = vi.fn().mockResolvedValue(undefined);
  mockResume = vi.fn().mockResolvedValue(undefined);

  // Use a class mock so `new AudioContext()` works correctly
  globalThis.AudioContext = class MockAudioContext {
    state = "running";
    destination = {};
    createGain = () => mockGain;
    createDynamicsCompressor = () => mockCompressor;
    createDelay = () => mockDelay;
    createMediaElementSource = () => mockSource;
    close = mockClose;
    resume = mockResume;
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
  } as unknown as typeof AudioContext;
});

function makeVideoRef(el: HTMLVideoElement | null = document.createElement("video")) {
  return { current: el };
}

describe("useAudioEnhancements", () => {
  it("initializes with provided values", () => {
    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 2.0, "light", 100),
    );

    expect(result.current.volumeBoost).toBe(2.0);
    expect(result.current.normalizationPreset).toBe("light");
    expect(result.current.audioOffsetMs).toBe(100);
    expect(result.current.isInitialized).toBe(true);
  });

  it("creates the Web Audio graph on mount", () => {
    const ref = makeVideoRef();
    renderHook(() => useAudioEnhancements(ref, 1.0, "off", 0));

    // source → gain → compressor → delay → destination
    expect(mockSource.connect).toHaveBeenCalledWith(mockGain);
    expect(mockGain.connect).toHaveBeenCalledWith(mockCompressor);
    expect(mockCompressor.connect).toHaveBeenCalledWith(mockDelay);
    expect(mockDelay.connect).toHaveBeenCalled();
  });

  it("stays uninitialized when no video element", () => {
    const ref = makeVideoRef(null);
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    expect(result.current.isInitialized).toBe(false);
  });

  // ── Volume boost ──

  it("setVolumeBoost updates gain node value", () => {
    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    act(() => result.current.setVolumeBoost(3.5));

    expect(result.current.volumeBoost).toBe(3.5);
    expect(mockGain.gain.value).toBe(3.5);
  });

  it("clamps volume boost to [0.25, 5]", () => {
    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    act(() => result.current.setVolumeBoost(0));
    expect(result.current.volumeBoost).toBe(0.25);

    act(() => result.current.setVolumeBoost(10));
    expect(result.current.volumeBoost).toBe(5);
  });

  // ── Normalization presets ──

  it("applies light preset compressor parameters", () => {
    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    act(() => result.current.setNormalizationPreset("light"));

    expect(result.current.normalizationPreset).toBe("light");
    expect(mockCompressor.threshold.value).toBe(-24);
    expect(mockCompressor.ratio.value).toBe(4);
  });

  it("applies night preset compressor parameters", () => {
    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    act(() => result.current.setNormalizationPreset("night"));

    expect(result.current.normalizationPreset).toBe("night");
    expect(mockCompressor.threshold.value).toBe(-40);
    expect(mockCompressor.ratio.value).toBe(12);
  });

  it("sets ratio to 1 (passthrough) when preset is off", () => {
    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "light", 0),
    );

    act(() => result.current.setNormalizationPreset("off"));

    expect(mockCompressor.ratio.value).toBe(1);
  });

  // ── Audio offset ──

  it("setAudioOffsetMs updates delay node value in seconds", () => {
    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    act(() => result.current.setAudioOffsetMs(200));

    expect(result.current.audioOffsetMs).toBe(200);
    expect(mockDelay.delayTime.value).toBe(0.2);
  });

  it("clamps audio offset to [0, 500]", () => {
    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    act(() => result.current.setAudioOffsetMs(-50));
    expect(result.current.audioOffsetMs).toBe(0);

    act(() => result.current.setAudioOffsetMs(999));
    expect(result.current.audioOffsetMs).toBe(500);
  });

  // ── Cleanup ──

  it("closes AudioContext on unmount", () => {
    const ref = makeVideoRef();
    const { unmount } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    unmount();

    expect(mockClose).toHaveBeenCalled();
  });

  // ── Graceful degradation ──

  it("stays uninitialized when createMediaElementSource throws", () => {
    globalThis.AudioContext = class FailingAudioContext {
      state = "running";
      destination = {};
      createGain = () => mockGain;
      createDynamicsCompressor = () => mockCompressor;
      createDelay = () => mockDelay;
      createMediaElementSource = (): never => {
        throw new Error("CORS");
      };
      close = mockClose;
      resume = mockResume;
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    } as unknown as typeof AudioContext;

    const ref = makeVideoRef();
    const { result } = renderHook(() =>
      useAudioEnhancements(ref, 1.0, "off", 0),
    );

    expect(result.current.isInitialized).toBe(false);
  });
});
