import type { DownloadItem } from "../../types/downloads";

export function groupShows(items: DownloadItem[]) {
  const shows = new Map<string, { key: string; title: string; items: DownloadItem[] }>();
  for (const item of items) {
    // Older saved downloads have only the show title, not its Plex rating key.
    const key = JSON.stringify([item.serverUri, item.grandparentTitle ?? item.ratingKey]);
    const show = shows.get(key) ?? { key, title: item.grandparentTitle ?? "Unknown show", items: [] };
    show.items.push(item);
    shows.set(key, show);
  }
  return [...shows.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function groupSeasons(items: DownloadItem[]) {
  const seasons = new Map<number | undefined, DownloadItem[]>();
  for (const item of items) {
    const season = seasons.get(item.parentIndex) ?? [];
    season.push(item);
    seasons.set(item.parentIndex, season);
  }
  return [...seasons].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity)).map(([index, episodes]) => ({
    index,
    title: index === undefined ? "Unknown season" : index === 0 ? "Specials" : `Season ${index}`,
    items: [...episodes].sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity) || a.title.localeCompare(b.title)),
  }));
}

export function downloadSize(items: DownloadItem[]) {
  return items.reduce((total, item) => total + (item.status === "complete" ? item.fileSize : item.bytesDownloaded), 0);
}

export function watchedDownloads(items: DownloadItem[], watchedKeys: ReadonlySet<string>) {
  return items.filter((item) => item.status === "complete" && watchedKeys.has(item.ratingKey));
}
