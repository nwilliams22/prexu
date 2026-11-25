import { describe, expect, it } from "vitest";
import { formatBytes, formatSpeed, formatTimeLeft } from "./format";

describe("download formatting", () => {
  it.each([[0, "0 B"], [1024, "1.0 KB"], [1048576, "1.0 MB"], [-1, "0 B"], [NaN, "0 B"], [Infinity, "0 B"]])("formats %s bytes", (value, expected) => {
    expect(formatBytes(value)).toBe(expected);
  });
  it("formats speed and unavailable measurements", () => {
    expect(formatSpeed(1536)).toBe("1.5 KB/s");
    expect(formatSpeed(undefined)).toBe("0 B/s");
  });
  it.each([[null, "Estimating time left…"], [undefined, "Estimating time left…"], [Infinity, "Estimating time left…"], [-1, "Estimating time left…"], [0, "Less than 1s left"], [1.2, "2s left"], [59.1, "1m 0s left"], [61, "1m 1s left"], [3661, "1h 1m left"]])("formats %s seconds", (value, expected) => {
    expect(formatTimeLeft(value)).toBe(expected);
  });
});
