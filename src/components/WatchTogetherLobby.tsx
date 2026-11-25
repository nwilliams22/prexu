import { useId } from "react";
import type { WatchLobbySnapshot, WatchLobbyParticipantState } from "../types/watch-together";
import "./WatchTogetherLobby.css";

const participantLabels: Record<WatchLobbyParticipantState, string> = {
  invited: "Invited",
  "joined-buffering": "Joined · buffering",
  ready: "Ready",
  reconnecting: "Reconnecting",
};

export interface WatchTogetherLobbyProps {
  snapshot: WatchLobbySnapshot;
  isHost: boolean;
  connected: boolean;
  error?: string | null;
  onStartNow: () => void;
  onResendInvite: (username: string) => void;
  onRemoveParticipant: (username: string) => void;
  onLeave: () => void;
}

/** Shared host/guest view. Only a relay snapshot may dismiss the lobby. */
export default function WatchTogetherLobby({
  snapshot, isHost, connected, error,
  onStartNow, onResendInvite, onRemoveParticipant, onLeave,
}: WatchTogetherLobbyProps) {
  const titleId = useId();
  const participantsId = useId();
  const canManage = isHost && connected && !snapshot.hostAway;

  return (
    <section className="watch-lobby" aria-labelledby={titleId}>
      <header>
        <p className="watch-lobby-eyebrow">Watch Together</p>
        <h1 id={titleId}>{snapshot.mediaTitle}</h1>
        <p role="status">
          {!connected ? "Reconnecting to the session…"
            : snapshot.hostAway ? "Waiting for the host to reconnect…"
            : snapshot.phase === "playback" ? "Session in progress."
            : "Playback starts when everyone is ready."}
        </p>
      </header>
      <section aria-labelledby={participantsId}>
        <h2 id={participantsId}>Participants</h2>
        <ul className="watch-lobby-participants" aria-live="polite" aria-relevant="all">
          {snapshot.participants.map((participant) => (
            <li key={participant.plexUsername}>
              <div className="watch-lobby-person">
                {participant.plexThumb && <img src={participant.plexThumb} alt="" />}
                <div>
                  <span>{participant.plexUsername}{participant.isHost ? " (Host)" : ""}</span>
                  <span className="watch-lobby-state">{participantLabels[participant.state]}</span>
                </div>
              </div>
              {isHost && !participant.isHost && (
                <div className="watch-lobby-actions">
                  {participant.state === "invited" && (
                    <button type="button" disabled={!canManage}
                      aria-label={`Resend invite to ${participant.plexUsername}`}
                      onClick={() => onResendInvite(participant.plexUsername)}>Resend invite</button>
                  )}
                  <button type="button" disabled={!canManage}
                    aria-label={`${participant.state === "invited" ? "Cancel invite for" : "Remove"} ${participant.plexUsername}`}
                    onClick={() => onRemoveParticipant(participant.plexUsername)}>
                    {participant.state === "invited" ? "Cancel invite" : "Remove"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      {error && <p role="alert">{error}</p>}
      <footer className="watch-lobby-actions">
        <button type="button" onClick={onLeave}>{isHost ? "Cancel session" : "Leave session"}</button>
        {isHost && snapshot.phase === "lobby" && <button type="button" className="watch-lobby-start" disabled={!canManage}
          onClick={onStartNow}>Start now</button>}
      </footer>
    </section>
  );
}
