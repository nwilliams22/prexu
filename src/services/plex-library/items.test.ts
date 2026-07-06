import { getOnDeck } from "./items";
import { cacheClear } from "../api-cache";

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

describe("getOnDeck", () => {
  beforeEach(() => {
    mockServerFetch.mockReset();
    mockLoggerDebug.mockReset();
    cacheClear();
  });

  it("returns the onDeck items unchanged", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 1,
          Metadata: [{ ratingKey: "66324", type: "episode", viewOffset: 280_000 }],
        },
      }),
    );

    const result = await getOnDeck(SERVER, TOKEN);

    expect(result).toMatchObject([
      { ratingKey: "66324", type: "episode", viewOffset: 280_000 },
    ]);
  });

  // prexu-ix52: this is the "viewOffset received by each deck refetch" line
  // called for in the audit — it's what lets a hardware run confirm whether
  // a deck refetch landed before or after PMS finished ingesting a stop
  // write, by comparing this against "final offset sent at stop" in
  // plex-playback.ts / useTimelineReporting.ts.
  it("logs the ratingKey + viewOffset of every item on each refetch", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 2,
          Metadata: [
            { ratingKey: "66324", type: "episode", viewOffset: 280_000 },
            { ratingKey: "77001", type: "movie" }, // no viewOffset — should log 0
          ],
        },
      }),
    );

    await getOnDeck(SERVER, TOKEN);

    expect(mockLoggerDebug).toHaveBeenCalledWith(
      "api",
      "onDeck refetch viewOffsets",
      {
        items: [
          { ratingKey: "66324", viewOffset: 280_000 },
          { ratingKey: "77001", viewOffset: 0 },
        ],
      },
    );
  });

  it("logs an empty items array when onDeck is empty", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({ MediaContainer: { size: 0, Metadata: [] } }),
    );

    await getOnDeck(SERVER, TOKEN);

    expect(mockLoggerDebug).toHaveBeenCalledWith(
      "api",
      "onDeck refetch viewOffsets",
      { items: [] },
    );
  });
});
