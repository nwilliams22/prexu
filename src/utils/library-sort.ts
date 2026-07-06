const ARTICLES_RE = /^(the|a|an)\s+/i;

interface SortableItem {
  titleSort?: string;
  title?: string;
}

export function getLibrarySortKey(item: SortableItem): string {
  const titleSort = item.titleSort?.trim();
  if (titleSort) return titleSort;
  const title = item.title?.trim() ?? "";
  return title.replace(ARTICLES_RE, "");
}

export function getLibrarySortBucket(item: SortableItem): string {
  const key = getLibrarySortKey(item);
  const first = key.charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}

/**
 * Fallback alpha-jump scan used when the firstCharacter index is unavailable
 * (endpoint failed) or filters are active (offsets from the raw index don't
 * match a filtered result set) — see LibraryView's `handleAlphaJump`.
 *
 * `items` is a sparse-by-index store (prexu-6qi5.1): unfetched positions are
 * `undefined` and are skipped rather than treated as a bucket mismatch.
 *
 * Mirrors the fast path's (`computeLetterOffsets`) >= semantics: if no
 * populated item exactly matches `letter`'s bucket, this returns the first
 * populated item whose bucket sorts AFTER it (the next existing bucket)
 * instead of reporting a miss — so clicking a letter with no items still
 * lands somewhere useful rather than doing nothing.
 *
 * Limitation: this can only "see" whatever has been fetched so far. With
 * filters active, `usePaginatedLibrary`'s `loadAll` path progressively fills
 * the store in the background, so repeated jumps converge on the true
 * answer as more of the section loads; a jump issued before that fill
 * completes may land earlier than the eventual correct position.
 */
export function findFirstIndexForLetter(
  items: readonly (SortableItem | undefined)[],
  letter: string,
): number {
  const target = letter.toUpperCase();
  let firstAfter = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue; // unfetched slot — sparse store, skip
    const bucket = getLibrarySortBucket(item);
    if (bucket === target) return i;
    if (firstAfter === -1 && bucket > target) firstAfter = i;
  }
  return firstAfter;
}
