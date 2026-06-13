/**
 * Shared skip-segment pill decision helper.
 *
 * Both MiniChrome and SkipSegmentButton implement the same three-way
 * decision table for which pill(s) to show:
 *
 *   segment.type === "intro"
 *     → primary: "Skip Intro"   secondary: none
 *
 *   segment.type === "credits", no next item (or no handler)
 *     → primary: "Skip Credits" secondary: none
 *
 *   segment.type === "credits" + hasNext + onNextEpisode present
 *     → primary: "Skip Credits" secondary: "Next Episode"
 *       (two-button layout lets users watch post-credits scenes)
 *
 * Extracting this table here means a single source of truth — changing
 * the label or split logic propagates to both surfaces automatically.
 */

export interface SkipPillDecision {
  /** Label for the primary action button (always present when a segment is active). */
  primaryLabel: string;
  /** True when a secondary "Next Episode" button should be shown alongside the primary. */
  showNextEpisode: boolean;
}

/**
 * Compute the pill decision for the given segment type and next-episode state.
 *
 * @param segmentType - The type of the active segment ("intro" | "credits").
 * @param hasNextItem - Whether there is a logical next item in the queue.
 * @param hasNextEpisodeHandler - Whether a next-episode click handler is wired.
 * @returns The label for the primary pill and whether to show the secondary pill.
 */
export function resolveSkipPillDecision(
  segmentType: "intro" | "credits",
  hasNextItem: boolean,
  hasNextEpisodeHandler: boolean,
): SkipPillDecision {
  const isCredits = segmentType === "credits";
  const primaryLabel = isCredits ? "Skip Credits" : "Skip Intro";
  const showNextEpisode = Boolean(isCredits && hasNextItem && hasNextEpisodeHandler);
  return { primaryLabel, showNextEpisode };
}
