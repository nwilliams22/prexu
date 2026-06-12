import { getRelatedItems } from "./related";

vi.mock("../plex-api", () => ({
  serverFetch: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

import { serverFetch } from "../plex-api";
import { logger } from "../logger";

const mockServerFetch = vi.mocked(serverFetch);
const mockLoggerDebug = vi.mocked(logger.debug);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

const SERVER = "https://plex.example.com:32400";
const TOKEN = "test-token";
const KEY = "12345";

describe("getRelatedItems", () => {
  beforeEach(() => {
    mockServerFetch.mockReset();
    mockLoggerDebug.mockReset();
  });

  describe("episode type", () => {
    it("returns empty array without making any network request", async () => {
      const result = await getRelatedItems(SERVER, TOKEN, KEY, "episode");

      expect(result).toEqual([]);
      expect(mockServerFetch).not.toHaveBeenCalled();
    });

    it("logs a debug message when skipping", async () => {
      await getRelatedItems(SERVER, TOKEN, KEY, "episode");

      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "api",
        "getRelatedItems: skipping /similar for episode",
        { ratingKey: KEY }
      );
    });
  });

  describe("movie type", () => {
    it("calls /similar and returns items when they exist", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            Metadata: [
              { ratingKey: "99", title: "Similar Movie", type: "movie" },
            ],
          },
        })
      );

      const result = await getRelatedItems(SERVER, TOKEN, KEY, "movie");

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Similar Movie");
      const calledPath: string = mockServerFetch.mock.calls[0][2] as string;
      expect(calledPath).toContain(`/library/metadata/${KEY}/similar`);
    });

    it("falls through to /related when /similar returns empty", async () => {
      mockServerFetch
        .mockResolvedValueOnce(
          jsonResponse({ MediaContainer: { Metadata: [] } })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            MediaContainer: {
              Metadata: [{ ratingKey: "88", title: "Related Movie", type: "movie" }],
            },
          })
        );

      const result = await getRelatedItems(SERVER, TOKEN, KEY, "movie");

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Related Movie");
      const paths = mockServerFetch.mock.calls.map((c) => c[2] as string);
      expect(paths[0]).toContain("/similar");
      expect(paths[1]).toContain("/related");
    });
  });

  describe("show type", () => {
    it("calls /similar for shows", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            Metadata: [{ ratingKey: "77", title: "Similar Show", type: "show" }],
          },
        })
      );

      const result = await getRelatedItems(SERVER, TOKEN, KEY, "show");

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Similar Show");
      const calledPath: string = mockServerFetch.mock.calls[0][2] as string;
      expect(calledPath).toContain(`/library/metadata/${KEY}/similar`);
    });
  });

  describe("no itemType provided (legacy behaviour)", () => {
    it("still calls /similar when itemType is omitted", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            Metadata: [{ ratingKey: "66", title: "Some Item", type: "movie" }],
          },
        })
      );

      const result = await getRelatedItems(SERVER, TOKEN, KEY);

      expect(result).toHaveLength(1);
      const calledPath: string = mockServerFetch.mock.calls[0][2] as string;
      expect(calledPath).toContain("/similar");
    });
  });
});
