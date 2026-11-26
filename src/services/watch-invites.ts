/** Invite links carry identifiers only; relay selection remains local configuration. */
export const INVITE_TTL_MS = 10 * 60 * 1000;
const SESSION_ID = /^[0-9A-F]{8}$/;
const RATING_KEY = /^[1-9][0-9]*$/;

export function inviteTimeLeft(sentAt: number, now = Date.now()): number {
  if (!Number.isFinite(sentAt) || sentAt > now) return 0;
  return Math.max(0, INVITE_TTL_MS - (now - sentAt));
}

export function createInviteLink(sessionId: string, ratingKey: string): string {
  if (!SESSION_ID.test(sessionId) || !RATING_KEY.test(ratingKey)) {
    throw new Error("Invalid invite identifiers");
  }
  return `prexu://join/${sessionId}?media=${ratingKey}`;
}

export function parseInviteLink(raw: string): { sessionId: string; ratingKey: string } | null {
  // Match the original spelling to reject credentials, ports, URL normalization,
  // encoded separators, duplicate parameters, and any supplied relay/host override.
  if (raw.length > 256) return null;
  const match = /^prexu:\/\/join\/([0-9A-F]{8})\?media=([1-9][0-9]*)$/.exec(raw);
  return match?.[0] === raw && match[1] && match[2] ? { sessionId: match[1], ratingKey: match[2] } : null;
}
