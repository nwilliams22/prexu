/**
 * Requests page — view and manage content requests.
 * Admin: sees all incoming requests with approve/decline actions.
 * Non-admin: sees own submitted requests with status + can submit new ones.
 */

import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useContentRequests } from "../hooks/useContentRequests";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { getTmdbImageUrl } from "../services/tmdb";
import ContentRequestForm from "../components/ContentRequestForm";
import type { ContentRequest } from "../types/content-request";

type FilterTab = "all" | "pending" | "approved" | "declined";

function Requests() {
  const { activeUser } = useAuth();
  const {
    requests,
    respondToRequest,
    dismissRequest,
    markAllRead,
    isRelayConnected,
  } = useContentRequests();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const isAdmin = activeUser?.isAdmin ?? false;

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [showRequestForm, setShowRequestForm] = useState(false);

  // Pre-fill request form from URL params (e.g., /requests?q=Taken&type=movie)
  const initialQuery = searchParams.get("q") ?? undefined;
  const initialMediaType = (searchParams.get("type") as "movie" | "tv") || undefined;
  const hasUrlParams = !!initialQuery;

  // Auto-open form if query params are present
  useEffect(() => {
    if (initialQuery) {
      setShowRequestForm(true);
    }
  }, [initialQuery]);

  // Mark all as read when admin visits the page
  useState(() => {
    if (isAdmin) markAllRead();
  });

  const filtered = requests.filter((r) => {
    if (filter === "all") return true;
    return r.status === filter;
  });

  const counts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    declined: requests.filter((r) => r.status === "declined").length,
  };

  const formatDate = (timestamp: number): string => {
    const d = new Date(timestamp);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  };

  return (
    <div style={styles.container}>
      <div style={{
        ...styles.header,
        ...(mobile ? { flexDirection: "column", alignItems: "flex-start", gap: "0.75rem" } : {}),
      }}>
        <div>
          <h2 style={styles.title}>
            {isAdmin ? "Content Requests" : "My Requests"}
          </h2>
          {isAdmin && !isRelayConnected && (
            <p style={styles.relayWarning}>
              Relay not connected — new requests won't arrive until reconnected.
            </p>
          )}
        </div>
        <button
          onClick={() => setShowRequestForm(true)}
          style={styles.requestButton}
        >
          + Request Something
        </button>
      </div>

      {/* Filter tabs */}
      <div style={styles.filterRow}>
        {(["all", "pending", "approved", "declined"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            style={{
              ...styles.filterTab,
              ...(filter === tab ? styles.filterTabActive : {}),
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {counts[tab] > 0 && (
              <span style={styles.filterCount}>{counts[tab]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Request list */}
      <div style={styles.list}>
        {filtered.length === 0 && (
          <div style={styles.emptyState}>
            <svg
              width={40}
              height={40}
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-secondary)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
            </svg>
            <p style={styles.emptyText}>
              {filter === "all"
                ? isAdmin
                  ? "No content requests yet."
                  : "You haven't made any requests yet."
                : `No ${filter} requests.`}
            </p>
          </div>
        )}

        {filtered.map((request) => (
          <RequestCard
            key={request.requestId}
            request={request}
            isAdmin={isAdmin}
            mobile={mobile}
            onApprove={() => respondToRequest(request.requestId, "approved")}
            onDecline={() => respondToRequest(request.requestId, "declined")}
            onDismiss={() => dismissRequest(request.requestId)}
            formatDate={formatDate}
          />
        ))}
      </div>

      {/* Request form modal */}
      {showRequestForm && (
        <ContentRequestForm
          onClose={() => {
            setShowRequestForm(false);
            // If opened via URL params (from actor page etc.), go back instead of staying here
            if (hasUrlParams) {
              navigate(-1);
            }
          }}
          initialQuery={initialQuery}
          initialMediaType={initialMediaType}
        />
      )}
    </div>
  );
}

// ── Request Card ──

interface RequestCardProps {
  request: ContentRequest;
  isAdmin: boolean;
  mobile: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onDismiss: () => void;
  formatDate: (ts: number) => string;
}

function RequestCard({
  request,
  isAdmin,
  mobile,
  onApprove,
  onDecline,
  onDismiss,
  formatDate,
}: RequestCardProps) {
  const posterUrl = getTmdbImageUrl(request.posterPath, "w92");

  const statusStyle: React.CSSProperties =
    request.status === "approved"
      ? { color: "var(--success)", background: "rgba(76,175,80,0.1)" }
      : request.status === "declined"
        ? { color: "var(--error)", background: "rgba(229,57,53,0.1)" }
        : { color: "var(--accent)", background: "rgba(229,160,13,0.1)" };

  return (
    <div style={{
      ...styles.card,
      ...(mobile ? { flexDirection: "column" } : {}),
    }}>
      <div style={styles.cardContent}>
        {posterUrl && (
          <img src={posterUrl} alt="" style={styles.cardPoster} />
        )}
        <div style={styles.cardInfo}>
          <div style={styles.cardTitleRow}>
            <span style={styles.cardTitle}>{request.title}</span>
            <span style={{ ...styles.statusBadge, ...statusStyle }}>
              {request.status}
            </span>
          </div>
          <div style={styles.cardMeta}>
            {request.year && <span>{request.year}</span>}
            <span>{request.mediaType === "movie" ? "Movie" : "TV Show"}</span>
            <span>Requested {formatDate(request.requestedAt)}</span>
            {request.targetServerName && (
              <span>→ {request.targetServerName}</span>
            )}
          </div>
          {isAdmin && request.requesterUsername && (
            <div style={styles.requesterRow}>
              {request.requesterThumb && (
                <img
                  src={request.requesterThumb}
                  alt=""
                  style={styles.requesterThumb}
                />
              )}
              <span style={styles.requesterName}>
                {request.requesterUsername}
              </span>
            </div>
          )}
          {request.overview && (
            <p style={styles.cardOverview}>
              {request.overview.length > 150
                ? request.overview.slice(0, 150) + "..."
                : request.overview}
            </p>
          )}
          {request.adminNote && (
            <p style={styles.adminNote}>
              <strong>Note:</strong> {request.adminNote}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={styles.cardActions}>
        {isAdmin && request.status === "pending" && (
          <>
            <button onClick={onApprove} style={styles.approveButton}>
              Approve
            </button>
            <button onClick={onDecline} style={styles.declineButton}>
              Decline
            </button>
          </>
        )}
        {request.status !== "pending" && (
          <button onClick={onDismiss} style={styles.dismissButton}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
    maxWidth: "800px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    margin: 0,
  },
  relayWarning: {
    fontSize: "0.75rem",
    color: "var(--error)",
    margin: "0.25rem 0 0",
  },
  requestButton: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.85rem",
    fontWeight: 600,
    padding: "0.5rem 1rem",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  filterRow: {
    display: "flex",
    gap: "0.25rem",
    marginBottom: "1rem",
    overflowX: "auto",
    paddingBottom: "2px",
  },
  filterTab: {
    padding: "0.4rem 0.75rem",
    fontSize: "0.8rem",
    fontWeight: 500,
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
  },
  filterTabActive: {
    background: "var(--accent)",
    color: "#000",
    borderColor: "var(--accent)",
    fontWeight: 600,
  },
  filterCount: {
    fontSize: "0.7rem",
    opacity: 0.8,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  card: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.75rem",
    background: "var(--bg-card)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  cardContent: {
    display: "flex",
    gap: "0.75rem",
    flex: 1,
    overflow: "hidden",
  },
  cardPoster: {
    width: "46px",
    height: "69px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
    background: "rgba(255,255,255,0.05)",
  },
  cardInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    overflow: "hidden",
    flex: 1,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  cardTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  statusBadge: {
    fontSize: "0.65rem",
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: "4px",
    textTransform: "capitalize",
    flexShrink: 0,
  },
  cardMeta: {
    display: "flex",
    gap: "0.5rem",
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  requesterRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    marginTop: "0.15rem",
  },
  requesterThumb: {
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    objectFit: "cover",
  },
  requesterName: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  cardOverview: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
    lineHeight: 1.3,
    margin: "0.15rem 0 0",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  adminNote: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
    fontStyle: "italic",
    margin: "0.15rem 0 0",
  },
  cardActions: {
    display: "flex",
    gap: "0.35rem",
    flexShrink: 0,
    alignItems: "center",
  },
  approveButton: {
    padding: "0.35rem 0.75rem",
    fontSize: "0.75rem",
    fontWeight: 600,
    borderRadius: "4px",
    background: "var(--success)",
    color: "#fff",
    border: "none",
    cursor: "pointer",
  },
  declineButton: {
    padding: "0.35rem 0.75rem",
    fontSize: "0.75rem",
    fontWeight: 600,
    borderRadius: "4px",
    background: "transparent",
    color: "var(--error)",
    border: "1px solid var(--error)",
    cursor: "pointer",
  },
  dismissButton: {
    padding: "0.35rem 0.6rem",
    fontSize: "0.7rem",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    cursor: "pointer",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.75rem",
    padding: "3rem 1rem",
  },
  emptyText: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    margin: 0,
  },
};

export default Requests;
