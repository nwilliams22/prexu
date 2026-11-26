import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { getImageUrl, getItemMetadata } from "../services/plex-library";
import type { PlexMediaItem } from "../types/library";

/** Item context stays independent of the mounted, paused player. */
export default function WatchTogetherMediaDetails({ ratingKey }: { ratingKey: string }) {
  const { server } = useAuth();
  const [item, setItem] = useState<PlexMediaItem | null>(null);
  const uri = server?.uri;
  const token = server?.accessToken;
  useEffect(() => {
    let cancelled = false;
    setItem(null);
    if (uri && token && ratingKey) {
      void getItemMetadata<PlexMediaItem>(uri, token, ratingKey).then((detail) => {
        if (!cancelled) setItem(detail);
      }).catch(() => { /* The player surfaces media-load errors; details are optional. */ });
    }
    return () => { cancelled = true; };
  }, [uri, token, ratingKey]);
  if (!item || !uri || !token) return null;
  const context = [
    item.type === "episode" ? `${item.grandparentTitle ?? ""} · S${item.parentIndex ?? "?"} E${item.index ?? "?"}` : item.year,
    item.contentRating,
    item.duration ? `${Math.round(item.duration / 60000)} min` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="watch-lobby-details">
      {item.thumb && <img src={getImageUrl(uri, token, item.thumb, 240, 360)} alt="" />}
      <div>
        {context && <p>{context}</p>}
        {item.summary && <p>{item.summary}</p>}
      </div>
    </div>
  );
}
