import "@testing-library/jest-dom/vitest";
import * as matchers from "vitest-axe/matchers";

expect.extend(matchers);

// Polyfill crypto.randomUUID — jsdom doesn't provide it, storage.ts needs it
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      ...globalThis.crypto,
      randomUUID: () =>
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        }),
    },
    writable: true,
  });
}

// Stub navigator.sendBeacon — jsdom doesn't provide it, plex-playback.ts needs it
if (!navigator.sendBeacon) {
  Object.defineProperty(navigator, "sendBeacon", {
    value: vi.fn(() => true),
    writable: true,
  });
}

// Polyfill ResizeObserver — jsdom doesn't provide it, HorizontalRow uses it
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// Stub window.matchMedia — jsdom doesn't implement it, some components use it
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
