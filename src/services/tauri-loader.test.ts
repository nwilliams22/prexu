import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTauriLoaderClass } from "./tauri-loader";

vi.mock("hls.js", () => ({
  LoadStats: class MockLoadStats {
    loaded = 0;
    total = 0;
    aborted = false;
    loading = { start: 0, first: 0, end: 0 };
  },
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

function createContext(overrides = {}) {
  return {
    url: "https://plex.test/video/segment.ts",
    responseType: "arraybuffer" as const,
    ...overrides,
  };
}

function createConfig(overrides = {}) {
  return { timeout: 30000, ...overrides };
}

function createCallbacks() {
  return {
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onTimeout: vi.fn(),
    onAbort: vi.fn(),
  };
}

function createSuccessResponse(overrides = {}) {
  const mockBlob = new Blob(["test data"]);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://plex.test/video/segment.ts",
    blob: () => Promise.resolve(mockBlob),
    text: () => Promise.resolve("playlist data"),
    ...overrides,
  };
}

describe("createTauriLoaderClass", () => {
  const TOKEN = "my-plex-token";

  it("creates a loader class from factory", () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    expect(LoaderClass).toBeTypeOf("function");

    const loader = new LoaderClass({});
    expect(loader).toBeDefined();
    expect(loader.context).toBeNull();
    expect(loader.stats).toBeDefined();
    expect(typeof loader.load).toBe("function");
    expect(typeof loader.abort).toBe("function");
    expect(typeof loader.destroy).toBe("function");
  });

  it("appends X-Plex-Token to URL when not present", () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    mockFetch.mockResolvedValue(createSuccessResponse());

    loader.load(createContext(), createConfig(), createCallbacks());

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`X-Plex-Token=${TOKEN}`);
    expect(calledUrl).toBe(
      `https://plex.test/video/segment.ts?X-Plex-Token=${TOKEN}`,
    );
  });

  it("does not duplicate token if already in URL", () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    mockFetch.mockResolvedValue(createSuccessResponse());

    const urlWithToken = `https://plex.test/video/segment.ts?X-Plex-Token=${TOKEN}`;
    loader.load(
      createContext({ url: urlWithToken }),
      createConfig(),
      createCallbacks(),
    );

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const tokenCount = (calledUrl.match(/X-Plex-Token/g) || []).length;
    expect(tokenCount).toBe(1);
  });

  it("adds Range header for range requests", () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    mockFetch.mockResolvedValue(createSuccessResponse());

    loader.load(
      createContext({ rangeStart: 0, rangeEnd: 1000 }),
      createConfig(),
      createCallbacks(),
    );

    const fetchOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect((fetchOptions.headers as Record<string, string>)["Range"]).toBe(
      "bytes=0-999",
    );
  });

  it("calls onSuccess with arraybuffer data on successful fetch", async () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    const mockBlob = new Blob(["test data"]);
    mockFetch.mockResolvedValue(createSuccessResponse({ blob: () => Promise.resolve(mockBlob) }));

    const callbacks = createCallbacks();
    loader.load(createContext(), createConfig(), callbacks);

    // Flush the fetch promise and blob/arrayBuffer chains
    await vi.advanceTimersByTimeAsync(0);

    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    const [response, stats, context] = callbacks.onSuccess.mock.calls[0];
    expect(response.data).toBeInstanceOf(ArrayBuffer);
    expect(response.code).toBe(200);
  });

  it("calls onSuccess with text data when responseType is not arraybuffer", async () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    mockFetch.mockResolvedValue(
      createSuccessResponse({ text: () => Promise.resolve("#EXTM3U\nplaylist") }),
    );

    const callbacks = createCallbacks();
    loader.load(
      createContext({ responseType: "text" }),
      createConfig(),
      callbacks,
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    const [response] = callbacks.onSuccess.mock.calls[0];
    expect(response.data).toBe("#EXTM3U\nplaylist");
  });

  it("calls onError on HTTP error (404)", async () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      url: "https://plex.test/video/segment.ts",
    });

    const callbacks = createCallbacks();
    loader.load(createContext(), createConfig(), callbacks);

    await vi.advanceTimersByTimeAsync(0);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const [error] = callbacks.onError.mock.calls[0];
    expect(error.code).toBe(404);
    expect(error.text).toBe("Not Found");
  });

  it("calls onTimeout after timeout ms", async () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    // Never resolving fetch to let timeout fire
    mockFetch.mockReturnValue(new Promise(() => {}));

    const callbacks = createCallbacks();
    loader.load(createContext(), createConfig({ timeout: 5000 }), callbacks);

    // Advance past the timeout
    vi.advanceTimersByTime(5000);

    expect(callbacks.onTimeout).toHaveBeenCalledOnce();
  });

  it("abort() sets aborted flag and calls onAbort", () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    mockFetch.mockReturnValue(new Promise(() => {}));

    const callbacks = createCallbacks();
    loader.load(createContext(), createConfig(), callbacks);

    loader.abort();

    expect(loader.stats.aborted).toBe(true);
    expect(callbacks.onAbort).toHaveBeenCalledOnce();
  });

  it("destroy() nulls callbacks and aborts without calling onAbort", () => {
    const LoaderClass = createTauriLoaderClass(TOKEN);
    const loader = new LoaderClass({});
    mockFetch.mockReturnValue(new Promise(() => {}));

    const callbacks = createCallbacks();
    loader.load(createContext(), createConfig(), callbacks);

    loader.destroy();

    expect(loader.context).toBeNull();
    expect(loader.stats.aborted).toBe(true);
    // destroy nulls callbacks first, so onAbort should NOT fire
    expect(callbacks.onAbort).not.toHaveBeenCalled();
  });
});
