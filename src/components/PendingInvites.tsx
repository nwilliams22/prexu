import "./PendingInvites.css";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInvites } from "../hooks/useInvites";
import { inviteTimeLeft, parseInviteLink } from "../services/watch-invites";

export default function PendingInvites() {
  const { invites, dismissInvite } = useInvites();
  const navigate = useNavigate();
  const [link, setLink] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <details className="pending-invites">
    <summary>Pending invites ({invites.length})</summary>
    <section aria-label="Pending Watch Together invites" className="pending-invites-panel">
      <form onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseInviteLink(link);
        setInvalid(!parsed);
        if (parsed) {
          dismissInvite(parsed.sessionId);
          navigate(`/play/${parsed.ratingKey}?session=${parsed.sessionId}`);
          setLink("");
        }
      }}>
        <label>Paste invite link <input value={link} onChange={(event) => setLink(event.target.value)} /></label>
        <button type="submit">Join by link</button>
        {invalid && <p role="alert">Invalid invite link. Ask the host for a new link.</p>}
      </form>
      {invites.length === 0 && <p>No pending invites.</p>}
      {invites.map((invite) => <article key={invite.sessionId}>
        <p><strong>{invite.senderUsername}</strong> invited you to {invite.mediaTitle}</p>
        <p>{Math.ceil(inviteTimeLeft(invite.sentAt, now) / 1000)} seconds left</p>
        <div className="pending-invites-actions"><button disabled={inviteTimeLeft(invite.sentAt, now) === 0} onClick={() => {
          navigate(`/play/${invite.mediaRatingKey}?${new URLSearchParams({ session: invite.sessionId, relay: invite.relayUrl })}`);
          dismissInvite(invite.sessionId);
        }}>Join {invite.mediaTitle}</button>
        <button onClick={() => dismissInvite(invite.sessionId)}>Decline</button></div>
      </article>)}
    </section>
  </details>;
}
