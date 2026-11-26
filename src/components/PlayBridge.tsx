/**
 * URL → context bridge for /play/:ratingKey entries.
 *
 * Lets external links and Watch Together invite URLs (which still encode
 * the playback target as `/play/:ratingKey?session=...&host=...&relay=...`)
 * launch playback in the new overlay model. On mount this component:
 *
 *   1. Reads ratingKey + query params from the URL
 *   2. Calls playerSession.play(...) to open the overlay
 *   3. Replaces history with the prior non-player route (or "/")
 *
 * The component itself renders nothing visible; it exists purely to
 * convert URL navigation into context state.
 *
 * In-app play actions should call playerSession.play() directly (skipping
 * the URL hop entirely) — this bridge is only for the URL entry path.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePlayerSession, type PlayerWatchTogether } from "../contexts/PlayerContext";
import { LAST_NON_PLAYER_ROUTE_KEY } from "../App";
import { useAuth } from "../hooks/useAuth";
import { getRelayUrl } from "../services/storage";

export default function PlayBridge() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const [searchParams] = useSearchParams();
  const { play } = usePlayerSession();
  const navigate = useNavigate();
  const { server } = useAuth();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!ratingKey) return;

    const offsetParam = searchParams.get("offset");
    const offset = offsetParam != null ? Number(offsetParam) : undefined;

    const sessionId = searchParams.get("session");
    const isHost = searchParams.get("host") === "true";
    const rawRelayUrl = searchParams.get("relay");
    let cancelled = false;
    void (async () => {
      const relayUrl = sessionId ? await getRelayUrl(server?.uri, true) : undefined;
      if (cancelled) return;
      if (sessionId && (!/^[0-9A-F]{8}$/.test(sessionId) ||
          (rawRelayUrl && new URL(rawRelayUrl).href !== new URL(relayUrl!).href))) {
        setError(true);
        return;
      }
      const watchTogether: PlayerWatchTogether | undefined = sessionId
        ? { sessionId, isHost, relayUrl: relayUrl ?? undefined }
        : undefined;

      play(ratingKey, { offset, watchTogether });

      // Replace history so the URL no longer references /play/* — the
      // overlay handles the player visibly, the underlying URL points
      // back at wherever the user was (or "/" for cold-start invite URLs).
      const target = sessionStorage.getItem(LAST_NON_PLAYER_ROUTE_KEY) || "/";
      navigate(target, { replace: true });
    })().catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [ratingKey, searchParams, play, navigate, server?.uri]);

  return error ? <p role="alert">This invite is invalid or uses a different relay. <button onClick={() => navigate("/", { replace: true })}>Go back</button></p> : null;
}
