/**
 * Hook managing the request submission state machine:
 * selecting a result, picking a server, and submitting.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { useContentRequests } from "./useContentRequests";
import { discoverServers } from "../services/plex-api";
import type { PlexServer } from "../types/plex";
import type {
  TmdbMovie,
  TmdbTvShow,
  TmdbSearchResult,
  RequestMediaType,
} from "../types/content-request";

export interface UseRequestSubmissionReturn {
  servers: PlexServer[];
  selectedServerId: string;
  setSelectedServerId: (id: string) => void;
  selected: TmdbSearchResult | null;
  setSelected: (item: TmdbSearchResult | null) => void;
  submitted: boolean;
  handleSubmit: (imdbInput: string) => void;
  targetServer: PlexServer | undefined;
}

export function useRequestSubmission(): UseRequestSubmissionReturn {
  const { authToken } = useAuth();
  const { submitRequest } = useContentRequests();

  const [servers, setServers] = useState<PlexServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Fetch all servers the user has access to
  useEffect(() => {
    if (!authToken) return;
    (async () => {
      try {
        const allServers = await discoverServers(authToken);
        const online = allServers.filter((s) => s.status === "online");
        setServers(online);
        if (online.length === 1) {
          setSelectedServerId(online[0].clientIdentifier);
        }
      } catch {
        // Non-critical -- just won't show server picker
      }
    })();
  }, [authToken]);

  const targetServer = servers.find(
    (s) => s.clientIdentifier === selectedServerId,
  );

  const handleSubmit = useCallback(
    (imdbInput: string) => {
      if (!selected) return;

      const isMovie = selected.media_type === "movie";
      const title = isMovie
        ? (selected as TmdbMovie).title
        : (selected as TmdbTvShow).name;
      const year = isMovie
        ? (selected as TmdbMovie).release_date?.split("-")[0] ?? ""
        : (selected as TmdbTvShow).first_air_date?.split("-")[0] ?? "";

      const target = servers.find(
        (s) => s.clientIdentifier === selectedServerId,
      );

      submitRequest({
        tmdbId: selected.id,
        imdbId: imdbInput.trim() || undefined,
        mediaType: selected.media_type as RequestMediaType,
        title,
        year,
        posterPath: selected.poster_path,
        overview: selected.overview,
        targetServerName: target?.name,
        targetServerId: target?.clientIdentifier,
      });

      setSubmitted(true);
    },
    [selected, submitRequest, servers, selectedServerId],
  );

  return {
    servers,
    selectedServerId,
    setSelectedServerId,
    selected,
    setSelected,
    submitted,
    handleSubmit,
    targetServer,
  };
}
