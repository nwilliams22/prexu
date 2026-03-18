import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import { usePreferences } from "./usePreferences";
import {
  getItemMetadata,
  getItemChildren,
  getRelatedItems,
  getExtras,
  getMediaByActor,
} from "../services/plex-library";
import type {
  PlexMediaItem,
  PlexMovie,
  PlexShow,
  PlexSeason,
  PlexEpisode,
  PlexRole,
} from "../types/library";

export interface ItemDetailData {
  item: PlexMediaItem | null;
  seasons: PlexSeason[];
  episodes: PlexEpisode[];
  isLoading: boolean;
  error: string | null;
  parentShow: PlexShow | null;
  siblingSeasons: PlexSeason[];
  siblingEpisodes: PlexEpisode[];
  related: PlexMediaItem[];
  extras: PlexMediaItem[];
  moreWithActors: { name: string; items: PlexMediaItem[] }[];
  showFixMatch: boolean;
  setShowFixMatch: (v: boolean) => void;
  refreshItem: () => void;
  setItem: React.Dispatch<React.SetStateAction<PlexMediaItem | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setEpisodes: React.Dispatch<React.SetStateAction<PlexEpisode[]>>;
}

export function useItemDetailData(): ItemDetailData {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const { server } = useAuth();
  const { preferences } = usePreferences();
  const navigate = useNavigate();

  const [item, setItem] = useState<PlexMediaItem | null>(null);
  const [seasons, setSeasons] = useState<PlexSeason[]>([]);
  const [episodes, setEpisodes] = useState<PlexEpisode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [parentShow, setParentShow] = useState<PlexShow | null>(null);
  const [siblingSeasons, setSiblingSeasons] = useState<PlexSeason[]>([]);
  const [siblingEpisodes, setSiblingEpisodes] = useState<PlexEpisode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<PlexMediaItem[]>([]);
  const [extras, setExtras] = useState<PlexMediaItem[]>([]);
  const [moreWithActors, setMoreWithActors] = useState<
    { name: string; items: PlexMediaItem[] }[]
  >([]);
  const [showFixMatch, setShowFixMatch] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshItem = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Fetch item metadata
  useEffect(() => {
    if (!server || !ratingKey) return;
    let cancelled = false;

    // Reset ALL state for clean load
    setItem(null);
    setIsLoading(true);
    const mainEl = document.querySelector("main");
    if (mainEl) mainEl.scrollTop = 0;
    else window.scrollTo(0, 0);
    setError(null);
    setSeasons([]);
    setEpisodes([]);
    setSiblingEpisodes([]);
    setParentShow(null);
    setSiblingSeasons([]);
    setRelated([]);
    setExtras([]);
    setMoreWithActors([]);

    (async () => {
      try {
        const metadata = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          ratingKey
        );
        if (!cancelled) {
          setItem(metadata);

          if (metadata.type === "show") {
            const seasonList = await getItemChildren<PlexSeason>(
              server.uri,
              server.accessToken,
              ratingKey
            );
            if (!cancelled) {
              if (seasonList.length === 1 && preferences.appearance.skipSingleSeason) {
                navigate(`/item/${seasonList[0].ratingKey}`, { replace: true });
                return;
              }
              setSeasons(seasonList);
            }
          }

          if (metadata.type === "season") {
            const season = metadata as PlexSeason;
            const [epList, showMeta, siblingList] = await Promise.all([
              getItemChildren<PlexEpisode>(
                server.uri,
                server.accessToken,
                ratingKey
              ),
              getItemMetadata<PlexShow>(
                server.uri,
                server.accessToken,
                season.parentRatingKey
              ),
              getItemChildren<PlexSeason>(
                server.uri,
                server.accessToken,
                season.parentRatingKey
              ),
            ]);
            if (!cancelled) {
              setEpisodes(epList);
              setParentShow(showMeta);
              setSiblingSeasons(siblingList);
            }
          }

          if (metadata.type === "episode") {
            const episode = metadata as PlexEpisode;
            const siblings = await getItemChildren<PlexEpisode>(
              server.uri,
              server.accessToken,
              episode.parentRatingKey
            );
            if (!cancelled) {
              setSiblingEpisodes(siblings);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load item"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, ratingKey, refreshKey]);

  // Update page title when item loads
  useEffect(() => {
    if (item) document.title = `${item.title} - Prexu`;
  }, [item]);

  // Fetch related + extras + "more with actor" (non-critical)
  useEffect(() => {
    if (!server || !ratingKey || !item) return;
    if (item.type !== "movie" && item.type !== "show" && item.type !== "episode") return;
    let cancelled = false;

    const roles: PlexRole[] =
      (item as PlexMovie | PlexShow | PlexEpisode).Role ?? [];
    const leadActors = roles.slice(0, 2).map((r) => r.tag);

    const actorSearches = leadActors.map((name) =>
      getMediaByActor(server.uri, server.accessToken, name)
        .then((allItems) => {
          const items = allItems.filter((m) => m.ratingKey !== ratingKey);
          return { name, items };
        })
        .catch(() => ({ name, items: [] as PlexMediaItem[] }))
    );

    Promise.allSettled([
      getRelatedItems(server.uri, server.accessToken, ratingKey),
      getExtras(server.uri, server.accessToken, ratingKey),
      Promise.all(actorSearches),
    ]).then(([relResult, extResult, actorResult]) => {
      if (cancelled) return;
      if (relResult.status === "fulfilled") setRelated(relResult.value);
      if (extResult.status === "fulfilled") setExtras(extResult.value);
      if (actorResult.status === "fulfilled") {
        setMoreWithActors(
          actorResult.value.filter((a) => a.items.length > 0)
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [server, ratingKey, item]);

  return {
    item,
    seasons,
    episodes,
    isLoading,
    error,
    parentShow,
    siblingSeasons,
    siblingEpisodes,
    related,
    extras,
    moreWithActors,
    showFixMatch,
    setShowFixMatch,
    refreshItem,
    setItem,
    setIsLoading,
    setEpisodes,
  };
}
