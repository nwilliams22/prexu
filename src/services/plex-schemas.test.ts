/**
 * Tests for the permissive Plex Zod schemas and the safeParsePlex helper.
 *
 * Verifies that:
 *   - a valid Plex sample parses and preserves typed + unknown-extra fields
 *   - a malformed/partial sample safe-parses to a graceful fallback (no throw)
 *     and logs the mismatch
 *   - the discriminated union narrows correctly on `type`
 *   - `.catch` defaults keep individual bad fields from poisoning parse
 */

vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

import { logger } from "./logger";
import {
  safeParsePlex,
  plexMetadataSchema,
  plexMetadataUnionSchema,
  metadataContainerSchema,
  directoryContainerSchema,
  type PlexMetadataUnion,
} from "./plex-schemas";

const mockWarn = vi.mocked(logger.warn);

beforeEach(() => {
  mockWarn.mockReset();
});

describe("plexMetadataSchema", () => {
  it("parses a valid movie and exposes typed + unknown extra fields", () => {
    const raw = {
      type: "movie",
      ratingKey: "101",
      key: "/library/metadata/101",
      title: "Blade Runner",
      summary: "A blade runner...",
      thumb: "/thumb.jpg",
      art: "/art.jpg",
      addedAt: 1700000000,
      updatedAt: 1700000001,
      year: 1982,
      rating: 8.1,
      // unknown extra key Plex may add — must pass through, not error
      titleSort: "Blade Runner",
    };

    const result = plexMetadataSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe("movie");
    expect(result.data.year).toBe(1982);
    expect(result.data.rating).toBe(8.1);
    // loose schema preserves unknown keys
    expect((result.data as Record<string, unknown>).titleSort).toBe(
      "Blade Runner",
    );
  });

  it("coerces an unknown type to the catch-all 'clip' rather than failing", () => {
    const result = plexMetadataSchema.safeParse({
      type: "somethingNew",
      ratingKey: "9",
      key: "/k",
      title: "T",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("clip");
  });

  it("applies .catch defaults for malformed required base fields", () => {
    // ratingKey is a number (wrong) and title missing — .catch keeps it parsing
    const result = plexMetadataSchema.safeParse({
      type: "movie",
      ratingKey: 12345,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ratingKey).toBe(""); // coerced via .catch
    expect(result.data.title).toBe("");
  });
});

describe("plexMetadataUnionSchema (discriminated union)", () => {
  it("narrows on type so episode-specific fields are typed", () => {
    const raw = {
      type: "episode",
      ratingKey: "55",
      key: "/library/metadata/55",
      title: "Pilot",
      summary: "",
      thumb: "",
      art: "",
      addedAt: 1,
      updatedAt: 1,
      grandparentTitle: "The Show",
      index: 1,
      parentIndex: 1,
    };

    const result = plexMetadataUnionSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const item: PlexMetadataUnion = result.data;
    // Narrowing branch — TypeScript sees the literal type here
    if (item.type === "episode") {
      expect(item.grandparentTitle).toBe("The Show");
      expect(item.index).toBe(1);
    } else {
      throw new Error("expected episode variant");
    }
  });

  it("narrows a collection distinctly from a movie", () => {
    const result = plexMetadataUnionSchema.safeParse({
      type: "collection",
      ratingKey: "c1",
      key: "/k",
      title: "Marvel",
      summary: "",
      thumb: "",
      art: "",
      addedAt: 1,
      updatedAt: 1,
      childCount: 23,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "collection") {
      expect(result.data.childCount).toBe(23);
    } else {
      throw new Error("expected collection variant");
    }
  });
});

describe("safeParsePlex", () => {
  it("returns parsed data on success without logging", () => {
    const out = safeParsePlex(
      metadataContainerSchema,
      {
        MediaContainer: {
          size: 1,
          Metadata: [
            {
              type: "movie",
              ratingKey: "1",
              key: "/k",
              title: "X",
              summary: "",
              thumb: "",
              art: "",
              addedAt: 0,
              updatedAt: 0,
            },
          ],
        },
      },
      "test:success",
      { MediaContainer: { size: 0 } },
    );
    expect(out.MediaContainer.Metadata).toHaveLength(1);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("returns the fallback and logs on a totally malformed shape (no throw)", () => {
    const fallback = { MediaContainer: { size: 0 } };
    // MediaContainer is a string — cannot be coerced, so parse fails
    const out = safeParsePlex(
      metadataContainerSchema,
      { MediaContainer: "not-an-object" },
      "test:malformed",
      fallback,
    );
    expect(out).toBe(fallback);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      "api",
      expect.stringContaining("test:malformed"),
      expect.any(Array),
    );
  });

  it("does not throw on null/undefined input", () => {
    const fallback = { MediaContainer: { Directory: [] } };
    expect(() =>
      safeParsePlex(directoryContainerSchema, null, "test:null", fallback),
    ).not.toThrow();
    const out = safeParsePlex(
      directoryContainerSchema,
      undefined,
      "test:undef",
      fallback,
    );
    expect(out).toBe(fallback);
  });
});

describe("directoryContainerSchema", () => {
  it("parses directory entries with mixed string/number size", () => {
    const result = directoryContainerSchema.safeParse({
      MediaContainer: {
        Directory: [
          { key: "A", title: "Action", size: "10" },
          { key: "B", size: 5 },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const dirs = result.data.MediaContainer.Directory ?? [];
    expect(dirs).toHaveLength(2);
    expect(dirs[0].key).toBe("A");
    expect(dirs[0].size).toBe("10");
    expect(dirs[1].size).toBe(5);
  });

  it("tolerates a missing Directory array", () => {
    const result = directoryContainerSchema.safeParse({ MediaContainer: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MediaContainer.Directory).toBeUndefined();
    }
  });
});
