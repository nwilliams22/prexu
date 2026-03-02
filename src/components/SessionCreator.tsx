import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getPlexFriends, getPlexUser } from "../services/plex-api";
import type { PlexFriend } from "../services/plex-api";
import { watchSync } from "../services/watch-sync";
import { getRelayUrl } from "../services/storage";

interface SessionCreatorProps {
  ratingKey: string;
  title: string;
  mediaType: "movie" | "episode";
  onClose: () => void;
}

function SessionCreator({
  ratingKey,
  title,
  mediaType,
  onClose,
}: SessionCreatorProps) {
  const { authToken, server } = useAuth();
  const navigate = useNavigate();

  const [friends, setFriends] = useState<PlexFriend[]>([]);
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(
    new Set()
  );
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch friends on mount
  useEffect(() => {
    if (!authToken) return;
    (async () => {
      try {
        const friendsList = await getPlexFriends(authToken);
        setFriends(friendsList);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load friends"
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, [authToken]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const toggleFriend = (username: string) => {
    setSelectedUsernames((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  };

  const filteredFriends = friends.filter((f) => {
    const search = filter.toLowerCase();
    return (
      f.username.toLowerCase().includes(search) ||
      f.friendlyName.toLowerCase().includes(search)
    );
  });

  const handleStart = async () => {
    if (!authToken || selectedUsernames.size === 0) return;
    setIsCreating(true);
    setError(null);

    try {
      const user = await getPlexUser(authToken);
      const sessionId = crypto.randomUUID().slice(0, 8).toUpperCase();

      // Ensure relay is connected
      if (!watchSync.isConnected) {
        throw new Error(
          "Not connected to relay server. Check your relay URL in settings."
        );
      }

      // Wait for session_created confirmation
      const sessionCreated = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Session creation timed out")), 5000);
        const unsub = watchSync.on("session_created", () => {
          clearTimeout(timeout);
          unsub();
          resolve();
        });
        const unsubErr = watchSync.on("session_error", (data: { reason?: string }) => {
          clearTimeout(timeout);
          unsubErr();
          reject(new Error(data.reason ?? "Session creation failed"));
        });
      });

      // Create session
      watchSync.send({
        type: "create_session",
        session_id: sessionId,
        media_title: title,
        media_rating_key: ratingKey,
        media_type: mediaType,
      });

      await sessionCreated;

      // Send invites to selected friends (include relay URL so they can auto-connect)
      const relayUrl = await getRelayUrl(server?.uri);
      for (const username of selectedUsernames) {
        watchSync.send({
          type: "invite",
          target_username: username,
          session_id: sessionId,
          media_title: title,
          media_rating_key: ratingKey,
          media_type: mediaType,
          sender_username: user.username,
          sender_thumb: user.thumb,
          relay_url: relayUrl,
        });
      }

      // Navigate to player with session
      onClose();
      navigate(`/play/${ratingKey}?session=${sessionId}&host=true`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create session"
      );
      setIsCreating(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Watch Together</h2>
          <button onClick={onClose} style={styles.closeButton}>
            ✕
          </button>
        </div>
        <p style={styles.subtitle}>{title}</p>

        {/* Search */}
        <input
          type="text"
          placeholder="Search friends..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={styles.searchInput}
          autoFocus
        />

        {/* Friends list */}
        <div style={styles.friendsList}>
          {isLoading && (
            <p style={styles.loadingText}>Loading friends...</p>
          )}
          {!isLoading && filteredFriends.length === 0 && (
            <p style={styles.loadingText}>
              {friends.length === 0
                ? "No Plex friends found"
                : "No matches"}
            </p>
          )}
          {filteredFriends.map((friend) => {
            const isSelected = selectedUsernames.has(friend.username);
            return (
              <div
                key={friend.id}
                style={{
                  ...styles.friendRow,
                  background: isSelected
                    ? "rgba(229, 160, 13, 0.15)"
                    : "transparent",
                }}
                onClick={() => toggleFriend(friend.username)}
              >
                {friend.thumb ? (
                  <img
                    src={friend.thumb}
                    alt=""
                    style={styles.friendAvatar}
                  />
                ) : (
                  <div style={styles.friendAvatarPlaceholder}>
                    {(friend.friendlyName || friend.username)[0]?.toUpperCase()}
                  </div>
                )}
                <div style={styles.friendInfo}>
                  <span style={styles.friendName}>
                    {friend.friendlyName || friend.username}
                  </span>
                  {friend.friendlyName && friend.username !== friend.friendlyName && (
                    <span style={styles.friendUsername}>
                      @{friend.username}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    ...styles.checkbox,
                    background: isSelected
                      ? "var(--accent)"
                      : "transparent",
                    borderColor: isSelected
                      ? "var(--accent)"
                      : "var(--border)",
                  }}
                >
                  {isSelected && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#000"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && <p style={styles.errorText}>{error}</p>}

        {/* Footer */}
        <div style={styles.footer}>
          <span style={styles.selectedCount}>
            {selectedUsernames.size} friend
            {selectedUsernames.size !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={handleStart}
            disabled={selectedUsernames.size === 0 || isCreating}
            style={{
              ...styles.startButton,
              opacity: selectedUsernames.size === 0 || isCreating ? 0.5 : 1,
            }}
          >
            {isCreating ? "Creating..." : "Start Session"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    animation: "overlayFadeIn 0.2s ease-out",
  },
  modal: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    width: "420px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    animation: "modalSlideUp 0.25s ease-out",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.25rem 0",
  },
  title: {
    fontSize: "1.15rem",
    fontWeight: 700,
    margin: 0,
  },
  closeButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "1.1rem",
    border: "none",
    cursor: "pointer",
    padding: "0.25rem",
  },
  subtitle: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    margin: "0.25rem 1.25rem 0.75rem",
  },
  searchInput: {
    margin: "0 1.25rem 0.75rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.9rem",
    outline: "none",
  },
  friendsList: {
    flex: 1,
    overflowY: "auto",
    padding: "0 0.5rem",
    maxHeight: "350px",
  },
  loadingText: {
    textAlign: "center",
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    padding: "2rem",
  },
  friendRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.6rem 0.75rem",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  friendAvatar: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    objectFit: "cover" as const,
    flexShrink: 0,
  },
  friendAvatarPlaceholder: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    background: "var(--bg-card)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  friendInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  friendName: {
    fontSize: "0.9rem",
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  friendUsername: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  checkbox: {
    width: "22px",
    height: "22px",
    borderRadius: "4px",
    border: "2px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "all 0.15s",
  },
  errorText: {
    color: "var(--error, #ef4444)",
    fontSize: "0.85rem",
    padding: "0 1.25rem",
    margin: "0.5rem 0 0",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75rem 1.25rem",
    borderTop: "1px solid var(--border)",
  },
  selectedCount: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  startButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "8px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default SessionCreator;
