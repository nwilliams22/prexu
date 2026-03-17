import { describe, it, expect } from "vitest";
import { toArray, getNotificationUrl } from "./plex-activity";

// ── toArray ──

describe("toArray", () => {
  it("returns the same array when given an array", () => {
    const arr = [1, 2, 3];
    expect(toArray(arr)).toBe(arr);
  });

  it("wraps a non-null object in an array", () => {
    const obj = { key: "value" };
    expect(toArray(obj)).toEqual([obj]);
  });

  it("returns empty array for null", () => {
    expect(toArray(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it("returns empty array for a primitive string", () => {
    expect(toArray("hello")).toEqual([]);
  });

  it("returns empty array for a number", () => {
    expect(toArray(42)).toEqual([]);
  });
});

// ── getNotificationUrl ──

describe("getNotificationUrl", () => {
  it("replaces https with wss and appends token", () => {
    const url = getNotificationUrl("https://plex.example.com", "abc123");
    expect(url).toBe(
      "wss://plex.example.com/:/websockets/notifications?X-Plex-Token=abc123",
    );
  });

  it("replaces http with ws and appends token", () => {
    const url = getNotificationUrl("http://192.168.1.1:32400", "tok");
    expect(url).toBe(
      "ws://192.168.1.1:32400/:/websockets/notifications?X-Plex-Token=tok",
    );
  });
});
