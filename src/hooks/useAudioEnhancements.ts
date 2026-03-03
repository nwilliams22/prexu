import { useRef, useEffect, useCallback, useState, type RefObject } from "react";
import type { NormalizationPreset } from "../types/preferences";

/** DynamicsCompressor parameters per normalization preset */
const NORMALIZATION_PRESETS: Record<
  NormalizationPreset,
  {
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
  } | null
> = {
  off: null,
  light: { threshold: -24, knee: 30, ratio: 4, attack: 0.003, release: 0.25 },
  night: { threshold: -40, knee: 10, ratio: 12, attack: 0.001, release: 0.1 },
};

export interface AudioEnhancementsResult {
  volumeBoost: number;
  setVolumeBoost: (value: number) => void;
  normalizationPreset: NormalizationPreset;
  setNormalizationPreset: (preset: NormalizationPreset) => void;
  audioOffsetMs: number;
  setAudioOffsetMs: (ms: number) => void;
  isInitialized: boolean;
}

/**
 * Manages a Web Audio API processing graph attached to a <video> element.
 *
 * Graph: video → MediaElementSource → GainNode → DynamicsCompressor → DelayNode → destination
 *
 * The compressor acts as passthrough when normalization is "off" (ratio = 1).
 * The delay node at 0ms is also effectively passthrough.
 */
export function useAudioEnhancements(
  videoRef: RefObject<HTMLVideoElement | null>,
  initialBoost: number,
  initialPreset: NormalizationPreset,
  initialOffsetMs: number,
): AudioEnhancementsResult {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const delayRef = useRef<DelayNode | null>(null);

  /** Track which video element the source was created for */
  const connectedVideoRef = useRef<HTMLVideoElement | null>(null);

  const [volumeBoost, setVolumeBoostState] = useState(initialBoost);
  const [normalizationPreset, setNormalizationPresetState] =
    useState<NormalizationPreset>(initialPreset);
  const [audioOffsetMs, setAudioOffsetMsState] = useState(initialOffsetMs);
  const [isInitialized, setIsInitialized] = useState(false);

  // ── Apply compressor parameters ──
  function applyCompressorPreset(
    compressor: DynamicsCompressorNode,
    preset: NormalizationPreset,
  ) {
    const params = NORMALIZATION_PRESETS[preset];
    if (params) {
      compressor.threshold.value = params.threshold;
      compressor.knee.value = params.knee;
      compressor.ratio.value = params.ratio;
      compressor.attack.value = params.attack;
      compressor.release.value = params.release;
    } else {
      // "off" — passthrough: ratio 1 means no compression
      compressor.threshold.value = 0;
      compressor.knee.value = 40;
      compressor.ratio.value = 1;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
    }
  }

  // ── Initialize Web Audio graph when video element is ready ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Already connected to this exact video element
    if (connectedVideoRef.current === video && audioCtxRef.current) {
      setIsInitialized(true);
      return;
    }

    try {
      let ctx = audioCtxRef.current;
      if (!ctx) {
        ctx = new AudioContext();
        audioCtxRef.current = ctx;
      }

      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      // Create source (once per video element — cannot be re-created)
      const source = ctx.createMediaElementSource(video);
      sourceRef.current = source;
      connectedVideoRef.current = video;

      // GainNode — volume boost
      const gain = ctx.createGain();
      gain.gain.value = volumeBoost;
      gainRef.current = gain;

      // DynamicsCompressorNode — normalization
      const compressor = ctx.createDynamicsCompressor();
      applyCompressorPreset(compressor, normalizationPreset);
      compressorRef.current = compressor;

      // DelayNode — audio offset (max 500ms)
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = audioOffsetMs / 1000;
      delayRef.current = delay;

      // Connect the graph
      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(delay);
      delay.connect(ctx.destination);

      setIsInitialized(true);
    } catch {
      // CORS error or already-connected element — gracefully degrade
      setIsInitialized(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef.current]);

  // ── Resume AudioContext if suspended (e.g. tab backgrounded) ──
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const handleStateChange = () => {
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    };

    ctx.addEventListener("statechange", handleStateChange);
    return () => ctx.removeEventListener("statechange", handleStateChange);
  }, [isInitialized]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      sourceRef.current = null;
      gainRef.current = null;
      compressorRef.current = null;
      delayRef.current = null;
      connectedVideoRef.current = null;
    };
  }, []);

  // ── Setters (update React state + live Web Audio nodes) ──

  const setVolumeBoost = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(5, value));
    setVolumeBoostState(clamped);
    if (gainRef.current) {
      gainRef.current.gain.value = clamped;
    }
  }, []);

  const setNormalizationPreset = useCallback((preset: NormalizationPreset) => {
    setNormalizationPresetState(preset);
    if (compressorRef.current) {
      applyCompressorPreset(compressorRef.current, preset);
    }
  }, []);

  const setAudioOffsetMs = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(500, ms));
    setAudioOffsetMsState(clamped);
    if (delayRef.current) {
      delayRef.current.delayTime.value = clamped / 1000;
    }
  }, []);

  return {
    volumeBoost,
    setVolumeBoost,
    normalizationPreset,
    setNormalizationPreset,
    audioOffsetMs,
    setAudioOffsetMs,
    isInitialized,
  };
}
