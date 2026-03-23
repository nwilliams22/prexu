import {
  normalizeContentRating,
  isRatingAllowed,
  getAllowedRatingLevels,
} from "./parental-controls";

describe("normalizeContentRating", () => {
  it("normalizes MPAA ratings directly", () => {
    expect(normalizeContentRating("G")).toBe("G");
    expect(normalizeContentRating("PG")).toBe("PG");
    expect(normalizeContentRating("PG-13")).toBe("PG-13");
    expect(normalizeContentRating("R")).toBe("R");
    expect(normalizeContentRating("NC-17")).toBe("NC-17");
  });

  it("is case-insensitive", () => {
    expect(normalizeContentRating("pg-13")).toBe("PG-13");
    expect(normalizeContentRating("r")).toBe("R");
    expect(normalizeContentRating("g")).toBe("G");
  });

  it("maps TV ratings to MPAA equivalents", () => {
    expect(normalizeContentRating("TV-Y")).toBe("G");
    expect(normalizeContentRating("TV-Y7")).toBe("G");
    expect(normalizeContentRating("TV-G")).toBe("G");
    expect(normalizeContentRating("TV-PG")).toBe("PG");
    expect(normalizeContentRating("TV-14")).toBe("PG-13");
    expect(normalizeContentRating("TV-MA")).toBe("R");
  });

  it("treats NR and Unrated as most restrictive", () => {
    expect(normalizeContentRating("NR")).toBe("NC-17");
    expect(normalizeContentRating("Not Rated")).toBe("NC-17");
    expect(normalizeContentRating("Unrated")).toBe("NC-17");
  });

  it("treats undefined/empty as most restrictive", () => {
    expect(normalizeContentRating(undefined)).toBe("NC-17");
    expect(normalizeContentRating("")).toBe("NC-17");
  });

  it("handles international ratings", () => {
    expect(normalizeContentRating("U")).toBe("G");
    expect(normalizeContentRating("12A")).toBe("PG");
    expect(normalizeContentRating("15")).toBe("R");
    expect(normalizeContentRating("18")).toBe("NC-17");
  });

  it("defaults unknown ratings to NC-17 for safety", () => {
    expect(normalizeContentRating("UNKNOWN")).toBe("NC-17");
    expect(normalizeContentRating("xyz")).toBe("NC-17");
  });
});

describe("isRatingAllowed", () => {
  it('allows everything when maxRating is "none"', () => {
    expect(isRatingAllowed("R", "none")).toBe(true);
    expect(isRatingAllowed("NC-17", "none")).toBe(true);
    expect(isRatingAllowed(undefined, "none")).toBe(true);
  });

  it("allows G content under PG restriction", () => {
    expect(isRatingAllowed("G", "PG")).toBe(true);
  });

  it("allows PG content under PG restriction", () => {
    expect(isRatingAllowed("PG", "PG")).toBe(true);
  });

  it("blocks PG-13 content under PG restriction", () => {
    expect(isRatingAllowed("PG-13", "PG")).toBe(false);
  });

  it("blocks R content under PG-13 restriction", () => {
    expect(isRatingAllowed("R", "PG-13")).toBe(false);
  });

  it("allows TV-PG under PG-13 restriction (maps to PG)", () => {
    expect(isRatingAllowed("TV-PG", "PG-13")).toBe(true);
  });

  it("blocks TV-MA under PG-13 restriction (maps to R)", () => {
    expect(isRatingAllowed("TV-MA", "PG-13")).toBe(false);
  });

  it("blocks undefined rating under any restriction (treated as NC-17)", () => {
    expect(isRatingAllowed(undefined, "PG")).toBe(false);
    expect(isRatingAllowed(undefined, "R")).toBe(false);
  });
});

describe("getAllowedRatingLevels", () => {
  it('returns empty array for "none"', () => {
    expect(getAllowedRatingLevels("none")).toEqual([]);
  });

  it("returns only G for G restriction", () => {
    expect(getAllowedRatingLevels("G")).toEqual(["G"]);
  });

  it("returns G and PG for PG restriction", () => {
    expect(getAllowedRatingLevels("PG")).toEqual(["G", "PG"]);
  });

  it("returns G, PG, PG-13 for PG-13 restriction", () => {
    expect(getAllowedRatingLevels("PG-13")).toEqual(["G", "PG", "PG-13"]);
  });

  it("returns all non-none levels for NC-17", () => {
    expect(getAllowedRatingLevels("NC-17")).toEqual([
      "G",
      "PG",
      "PG-13",
      "R",
      "NC-17",
    ]);
  });
});
