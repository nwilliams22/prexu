/**
 * Tests for getSectionFirstCharacter service function.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSectionFirstCharacter } from "./filter";

vi.mock("../plex-api", () => ({
  serverFetch: vi.fn(),
}));

import { serverFetch } from "../plex-api";

const mockServerFetch = vi.mocked(serverFetch);

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
const SECTION_ID = "1";

describe("getSectionFirstCharacter", () => {
  beforeEach(() => {
    mockServerFetch.mockReset();
  });

  it("calls the correct firstCharacter endpoint path", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 2,
          Directory: [
            { key: "A", size: "10" },
            { key: "B", size: "5" },
          ],
        },
      })
    );

    await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    const calledPath: string = mockServerFetch.mock.calls[0][2] as string;
    expect(calledPath).toBe(`/library/sections/${SECTION_ID}/firstCharacter`);
  });

  it("returns buckets with string size coerced to number", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 3,
          Directory: [
            { key: "#", size: "3" },
            { key: "A", size: "10" },
            { key: "Z", size: "1" },
          ],
        },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ key: "#", size: 3 });
    expect(result[1]).toEqual({ key: "A", size: 10 });
    expect(result[2]).toEqual({ key: "Z", size: 1 });
  });

  it("accepts numeric size values without conversion error", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 2,
          Directory: [
            { key: "A", size: 42 },
            { key: "B", size: 7 },
          ],
        },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result[0]).toEqual({ key: "A", size: 42 });
    expect(result[1]).toEqual({ key: "B", size: 7 });
  });

  it("returns empty array when Directory is missing", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: { size: 0 },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result).toEqual([]);
  });

  it("returns empty array when Directory is null", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: { size: 0, Directory: null },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result).toEqual([]);
  });

  it("throws when the server returns a non-ok response", async () => {
    mockServerFetch.mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(
      getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID)
    ).rejects.toThrow("Plex API error: 500");
  });

  it("coerces invalid size string to 0", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 1,
          Directory: [{ key: "A", size: "not-a-number" }],
        },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result[0]).toEqual({ key: "A", size: 0 });
  });

  it("decodes URL-encoded bucket key %23 to #", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 3,
          Directory: [
            { key: "%23", size: "5" },
            { key: "A", size: "10" },
            { key: "Z", size: "1" },
          ],
        },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ key: "#", size: 5 });
    expect(result[1]).toEqual({ key: "A", size: 10 });
    expect(result[2]).toEqual({ key: "Z", size: 1 });
  });

  it("falls back gracefully when bucket key is malformed (incomplete percent sequence)", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 3,
          Directory: [
            { key: "%", size: "2" },
            { key: "A", size: "10" },
          ],
        },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result).toHaveLength(2);
    // Malformed "%" should map to "#" (first char is not A-Z)
    expect(result[0]).toEqual({ key: "#", size: 2 });
    expect(result[1]).toEqual({ key: "A", size: 10 });
  });

  it("merges multiple buckets that normalize to the same character", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 4,
          Directory: [
            { key: "%23", size: "3" },
            { key: "A", size: "10" },
            { key: "#", size: "2" },  // literal "#" also appears in the response
            { key: "B", size: "5" },
          ],
        },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ key: "#", size: 5 }); // 3 + 2 merged
    expect(result[1]).toEqual({ key: "A", size: 10 });
    expect(result[2]).toEqual({ key: "B", size: 5 });
  });

  it("maps non-alphabetic characters to #", async () => {
    mockServerFetch.mockResolvedValueOnce(
      jsonResponse({
        MediaContainer: {
          size: 3,
          Directory: [
            { key: "0", size: "2" },
            { key: "A", size: "10" },
            { key: "!", size: "1" },
          ],
        },
      })
    );

    const result = await getSectionFirstCharacter(SERVER, TOKEN, SECTION_ID);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ key: "#", size: 3 }); // "0" and "!" merged
    expect(result[1]).toEqual({ key: "A", size: 10 });
  });
});
