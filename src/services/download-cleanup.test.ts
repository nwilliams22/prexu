import { describe, expect, it } from "vitest";
import { isWatchedDownloadEligible, WATCHED_DOWNLOAD_GRACE_MS as DAY } from "./download-cleanup";
const base = { enabled: true, complete: true, watched: true, watchedAt: 1000, sessionStartedAt: 2000, protectedThisSession: false, startup: true, now: 3000 };
describe("watched download eligibility", () => {
  it("allows a watched download from a previous session at launch", () => {
    expect(isWatchedDownloadEligible(base)).toBe(true);
  });
  it.each([
    { enabled: false }, { complete: false }, { watched: false },
    { protectedThisSession: true }, { watchedAt: undefined },
    { watchedAt: NaN }, { watchedAt: 0 }, { watchedAt: 4000 },
    { watchedAt: 2000 }, { watchedAt: 2500 },
  ])("keeps ineligible downloads: %j", (change) => {
    expect(isWatchedDownloadEligible({ ...base, ...change })).toBe(false);
  });
  it("waits 24 hours outside the launch pass", () => {
    expect(isWatchedDownloadEligible({ ...base, startup: false, now: 1000 + DAY - 1 })).toBe(false);
    expect(isWatchedDownloadEligible({ ...base, startup: false, now: 1000 + DAY })).toBe(true);
  });
  it("keeps this session's watched downloads even after 24 hours", () => {
    expect(isWatchedDownloadEligible({ ...base, startup: false, watchedAt: 2500, now: 2500 + DAY })).toBe(false);
    expect(isWatchedDownloadEligible({ ...base, protectedThisSession: true, now: 1000 + DAY })).toBe(false);
  });
  it("never deletes while disabled, including an overdue launch", () => {
    expect(isWatchedDownloadEligible({ ...base, enabled: false, now: 1000 + DAY })).toBe(false);
  });
});
