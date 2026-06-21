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

export function findFirstIndexForLetter(
  items: readonly SortableItem[],
  letter: string,
): number {
  const target = letter.toUpperCase();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && getLibrarySortBucket(item) === target) return i;
  }
  return -1;
}
