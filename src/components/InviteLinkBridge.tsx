import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { parseInviteLink } from "../services/watch-invites";

/** Keep a cold-start invitation through sign-in and server selection. */
export default function InviteLinkBridge() {
  const [pending, setPending] = useState<ReturnType<typeof parseInviteLink>>(null);
  const [error, setError] = useState(false);
  const { isLoading, isAuthenticated, serverSelected } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const receive = (urls: string[]) => {
      if (!active) return;
      const parsed = parseInviteLink(urls[urls.length - 1] ?? "");
      setPending(parsed);
      setError(!parsed);
    };
    void (async () => {
      unlisten = await onOpenUrl(receive);
      if (!active) { unlisten(); return; }
      const initial = await getCurrent();
      if (initial?.length) receive(initial);
    })().catch(() => { if (active) setError(true); });
    return () => { active = false; unlisten?.(); };
  }, []);
  useEffect(() => {
    if (!pending || isLoading || !isAuthenticated || !serverSelected) return;
    navigate(`/play/${pending.ratingKey}?session=${pending.sessionId}`);
    setPending(null);
  }, [pending, isLoading, isAuthenticated, serverSelected, navigate]);
  return error ? <div role="alert">This invite link is invalid. Ask the host for a new link. <button onClick={() => setError(false)}>Dismiss</button></div> : null;
}
