import { describe, it, expect } from "vitest";
import { formatTime, formatTimeMs, formatDurationLabel } from "./time-format";

describe("formatTime", () => {
  it("formats seconds as m:ss for under an hour", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("formats seconds as h:mm:ss for an hour or more", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
    expect(formatTime(7200)).toBe("2:00:00");
  });

  it("treats negative values as zero", () => {
    expect(formatTime(-10)).toBe("0:00");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(65.9)).toBe("1:05");
  });
});

describe("formatTimeMs", () => {
  it("converts milliseconds to formatted time", () => {
    expect(formatTimeMs(0)).toBe("0:00");
    expect(formatTimeMs(5000)).toBe("0:05");
    expect(formatTimeMs(65000)).toBe("1:05");
    expect(formatTimeMs(3661000)).toBe("1:01:01");
  });
});

describe("formatDurationLabel", () => {
  it("formats as Xmin for under an hour", () => {
    expect(formatDurationLabel(300)).toBe("5min");
    expect(formatDurationLabel(1800)).toBe("30min");
  });

  it("formats as Xh Ymin for an hour or more", () => {
    expect(formatDurationLabel(3600)).toBe("1h 0min");
    expect(formatDurationLabel(5400)).toBe("1h 30min");
    expect(formatDurationLabel(7200)).toBe("2h 0min");
  });
});
