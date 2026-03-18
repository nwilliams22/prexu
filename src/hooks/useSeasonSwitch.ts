import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import {
  getItemMetadata,
  getItemChildren,
} from "../services/plex-library";
import type {
  PlexMediaItem,
  PlexSeason,
  PlexEpisode,
} from "../types/library";

export interface SeasonSwitchState {
  seasonFading: boolean;
  switchSeason: (targetSeason: PlexSeason) => Promise<void>;
}

export function useSeasonSwitch(
  setItem: React.Dispatch<React.SetStateAction<PlexMediaItem | null>>,
  setEpisodes: React.Dispatch<React.SetStateAction<PlexEpisode[]>>
): SeasonSwitchState {
  const { server } = useAuth();
  const navigate = useNavigate();
  const [seasonFading, setSeasonFading] = useState(false);

  const switchSeason = useCallback(async (targetSeason: PlexSeason) => {
    if (!server) return;
    setSeasonFading(true);
    try {
      const [seasonMeta, epList] = await Promise.all([
        getItemMetadata<PlexSeason>(server.uri, server.accessToken, targetSeason.ratingKey),
        getItemChildren<PlexEpisode>(server.uri, server.accessToken, targetSeason.ratingKey),
      ]);
      await new Promise((r) => setTimeout(r, 150));
      setItem(seasonMeta);
      setEpisodes(epList);
      window.history.replaceState(null, "", `/item/${targetSeason.ratingKey}`);
    } catch {
      navigate(`/item/${targetSeason.ratingKey}`);
    } finally {
      setSeasonFading(false);
    }
  }, [server, navigate, setItem, setEpisodes]);

  return { seasonFading, switchSeason };
}
