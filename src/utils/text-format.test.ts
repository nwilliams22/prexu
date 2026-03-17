import { describe, it, expect } from "vitest";
import { getInitials, formatDate } from "./text-format";

describe("getInitials", () => {
  it("returns single initial for single name", () => {
    expect(getInitials("Madonna")).toBe("M");
  });

  it("returns first+last initials for full name", () => {
    expect(getInitials("John Smith")).toBe("JS");
  });

  it("uses first and last parts for multi-part names", () => {
    expect(getInitials("Robert De Niro")).toBe("RN");
  });

  it("handles extra whitespace", () => {
    expect(getInitials("  Jane   Doe  ")).toBe("JD");
  });

  it("returns empty for empty string", () => {
    expect(getInitials("")).toBe("");
  });
});

describe("formatDate", () => {
  it("returns empty string for null", () => {
    expect(formatDate(null)).toBe("");
  });

  it("formats a valid date string", () => {
    const result = formatDate("1990-05-15");
    expect(result).toContain("1990");
    expect(result).toContain("15");
  });
});
