import { createPin, getAuthUrl, pollForAuth } from "./plex-auth";

// Mock storage module
vi.mock("./storage", () => ({
  getClientIdentifier: vi.fn().mockResolvedValue("test-client-id"),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
  } as Response;
}

describe("plex-auth", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── createPin ──

  describe("createPin", () => {
    it("POSTs to /pins and returns PlexPin", async () => {
      const pinData = {
        id: 12345,
        code: "ABCD1234",
        product: "Prexu",
        trusted: false,
        clientIdentifier: "test-client-id",
        authToken: null,
        expiresAt: "2025-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce(jsonResponse(pinData));

      const pin = await createPin();

      expect(pin).toEqual(pinData);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://clients.plex.tv/api/v2/pins");
      expect(options.method).toBe("POST");
      expect(options.body).toBe("strong=true");
      expect(options.headers["X-Plex-Client-Identifier"]).toBe("test-client-id");
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(createPin()).rejects.toThrow("Failed to create PIN");
    });
  });

  // ── getAuthUrl ──

  describe("getAuthUrl", () => {
    it("constructs URL with clientID and code params", async () => {
      const url = await getAuthUrl("TESTCODE");

      expect(url).toContain("https://app.plex.tv/auth#?");
      expect(url).toContain("clientID=test-client-id");
      expect(url).toContain("code=TESTCODE");
      expect(url).toContain("context%5Bdevice%5D%5Bproduct%5D=Prexu");
    });
  });

  // ── pollForAuth ──

  describe("pollForAuth", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns token when found on first poll", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          code: "ABC",
          authToken: "found-token",
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        })
      );

      const token = await pollForAuth(1);
      expect(token).toBe("found-token");
    });

    it("polls multiple times until token appears", async () => {
      // First poll: no token yet
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          authToken: null,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        })
      );

      // Second poll: token available
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          authToken: "my-token",
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        })
      );

      const pollPromise = pollForAuth(1);

      // Advance past first poll interval
      await vi.advanceTimersByTimeAsync(2100);

      const token = await pollPromise;
      expect(token).toBe("my-token");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws when PIN has expired", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          authToken: null,
          expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
        })
      );

      await expect(pollForAuth(1)).rejects.toThrow("PIN has expired");
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
      await expect(pollForAuth(1)).rejects.toThrow("Failed to check PIN: 404");
    });

    it("calls correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: 999, authToken: "token", expiresAt: "2099-01-01" })
      );

      await pollForAuth(999);

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://clients.plex.tv/api/v2/pins/999"
      );
    });
  });
});
