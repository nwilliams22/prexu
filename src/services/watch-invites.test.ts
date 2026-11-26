import { describe, expect, it } from "vitest";
import { createInviteLink, parseInviteLink, inviteTimeLeft, INVITE_TTL_MS } from "./watch-invites";

describe("invite links", () => {
  it("round trips the lobby identifiers without a relay address", () => {
    expect(parseInviteLink(createInviteLink("AB12CD34", "17"))).toEqual({ sessionId: "AB12CD34", ratingKey: "17" });
  });
  it.each([
    "prexu://join/invalid?media=17", "prexu://join/AB12CD34?media=../17",
    "prexu://join/AB12CD34?media=17&relay=wss://evil.test", "prexu://evil.test/AB12CD34?media=17",
    "prexu://user@join/AB12CD34?media=17", "prexu://join:123/AB12CD34?media=17",
    "prexu://join/AB12CD34?media=17&media=18", "prexu://join/AB12CD34?media=17#fragment",
    "prexu://join/foo/../AB12CD34?media=17", "prexu://join/%41B12CD34?media=17",
    "prexu://join/AB12CD34?media=17\n",
    "https://join/AB12CD34?media=17", "prexu://join/AB12CD34?media=17&host=true",
  ])("rejects untrusted input %s", (link) => { expect(parseInviteLink(link)).toBeNull(); });
  it("refuses to generate malformed links", () => {
    expect(() => createInviteLink("bad", "17")).toThrow();
    expect(() => createInviteLink("AB12CD34", "../17")).toThrow();
  });
});

describe("invite expiry", () => {
  it("expires at exactly ten minutes of wall-clock time", () => {
    expect(inviteTimeLeft(1000, 1000)).toBe(INVITE_TTL_MS);
    expect(inviteTimeLeft(1000, 1000 + INVITE_TTL_MS - 1)).toBe(1);
    expect(inviteTimeLeft(1000, 1000 + INVITE_TTL_MS)).toBe(0);
    expect(inviteTimeLeft(1000, 1000 + INVITE_TTL_MS * 2)).toBe(0);
  });
  it("rejects invalid and future timestamps", () => {
    expect(inviteTimeLeft(NaN, 1000)).toBe(0);
    expect(inviteTimeLeft(Infinity, 1000)).toBe(0);
    expect(inviteTimeLeft(1001, 1000)).toBe(0);
  });
});
