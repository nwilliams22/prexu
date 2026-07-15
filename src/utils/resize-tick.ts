/**
 * Leading+trailing burst gate (prexu-v3j5).
 *
 * `poke()` fires `fire("leading")` on the first poke of a burst, then
 * suppresses everything until pokes go quiet for `settleMs`, firing
 * `fire("trailing")` once at settle. The next poke after settle starts a new
 * burst.
 *
 * Built for AppLayout's window-resize React commit (prexu-uzk): committing on
 * every drag frame re-rendered the entire routed page tree per frame — the
 * "shelf arrows visibly re-rendering" jitter share of prexu-41cw. The
 * DOM-level layout/paint nudges stay per-frame (they fight the WebView paint
 * lag); the React commit only needs to bracket the burst.
 */
export interface LeadingTrailingGate {
  poke: () => void;
  /** Cancel any pending trailing fire and reset burst state. */
  dispose: () => void;
}

export function createLeadingTrailingGate(
  settleMs: number,
  fire: (edge: "leading" | "trailing") => void,
): LeadingTrailingGate {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let inBurst = false;

  const poke = () => {
    if (!inBurst) {
      inBurst = true;
      fire("leading");
    }
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      inBurst = false;
      fire("trailing");
    }, settleMs);
  };

  const dispose = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    inBurst = false;
  };

  return { poke, dispose };
}
