import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useHomeUsers } from "../hooks/useHomeUsers";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useFocusTrap } from "../hooks/useFocusTrap";
import PinEntryModal from "./PinEntryModal";
import type { HomeUser } from "../types/home-user";

function UserSwitcher() {
  const { activeUser, server, logout, changeServer } = useAuth();
  const {
    homeUsers,
    isPlexHome,
    isSwitching,
    switchError,
    switchTo,
    clearError,
  } = useHomeUsers();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [pinUser, setPinUser] = useState<HomeUser | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(menuRef, isOpen);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [isOpen]);

  // Close dropdown on Escape + arrow key navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const menu = menuRef.current;
        if (!menu) return;
        const items = Array.from(
          menu.querySelectorAll<HTMLElement>("button:not([disabled])"),
        );
        if (items.length === 0) return;
        const idx = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === "ArrowDown") {
          items[(idx + 1) % items.length].focus();
        } else {
          items[(idx - 1 + items.length) % items.length].focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  const handleUserClick = (user: HomeUser) => {
    if (user.id === activeUser?.id) {
      setIsOpen(false);
      return;
    }
    if (user.protected) {
      setPinUser(user);
      setIsOpen(false);
    } else {
      switchTo(user);
      setIsOpen(false);
    }
  };

  const handlePinSubmit = (pin: string) => {
    if (pinUser) {
      switchTo(pinUser, pin);
    }
  };

  const handlePinCancel = () => {
    setPinUser(null);
    clearError();
  };

  // Close PIN modal on successful switch
  useEffect(() => {
    if (!isSwitching && !switchError && pinUser) {
      setPinUser(null);
    }
  }, [isSwitching, switchError, pinUser]);

  const bp = useBreakpoint();
  const mobile = isMobile(bp);

  const displayName =
    activeUser?.title ?? activeUser?.username ?? "User";
  const displayThumb = activeUser?.thumb ?? "";

  return (
    <div style={styles.container} ref={dropdownRef}>
      {/* Server name — hidden on mobile */}
      {!mobile && <span style={styles.serverName}>{server?.name}</span>}

      {/* Avatar button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={styles.avatarButton}
        title={displayName}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {displayThumb ? (
          <img src={displayThumb} alt="" style={styles.avatarImg} />
        ) : (
          <div style={styles.avatarFallback}>
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div ref={menuRef} role="menu" style={styles.dropdown}>
          {/* Current user info */}
          <div style={styles.currentUser}>
            <span style={styles.currentUserName}>{displayName}</span>
            {activeUser?.isAdmin && (
              <span style={styles.adminBadge}>Admin</span>
            )}
          </div>

          {/* Home users list */}
          {isPlexHome && (
            <>
              <div style={styles.divider} />
              <div style={styles.sectionLabel}>Switch User</div>
              {homeUsers.map((user) => {
                const isActive = user.id === activeUser?.id;
                return (
                  <button
                    key={user.id}
                    onClick={() => handleUserClick(user)}
                    style={{
                      ...styles.userItem,
                      opacity: isSwitching ? 0.5 : 1,
                      cursor: isSwitching ? "wait" : "pointer",
                    }}
                    disabled={isSwitching}
                  >
                    {user.thumb ? (
                      <img
                        src={user.thumb}
                        alt=""
                        style={styles.userItemAvatar}
                      />
                    ) : (
                      <div style={styles.userItemAvatarFallback}>
                        {user.title.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span style={styles.userItemName}>{user.title}</span>
                    {user.protected && !isActive && (
                      <svg
                        width={12}
                        height={12}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--text-secondary)"
                        strokeWidth={2}
                        style={{ marginLeft: "auto", flexShrink: 0 }}
                      >
                        <rect
                          x={3}
                          y={11}
                          width={18}
                          height={11}
                          rx={2}
                          ry={2}
                        />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </svg>
                    )}
                    {isActive && (
                      <svg
                        width={14}
                        height={14}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth={3}
                        style={{ marginLeft: "auto", flexShrink: 0 }}
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </>
          )}

          {/* Actions */}
          <div style={styles.divider} />
          <button
            role="menuitem"
            onClick={() => {
              navigate("/history");
              setIsOpen(false);
            }}
            style={styles.menuAction}
          >
            Watch History
          </button>
          <button
            role="menuitem"
            onClick={() => {
              navigate("/settings");
              setIsOpen(false);
            }}
            style={styles.menuAction}
          >
            Settings
          </button>
          <button
            role="menuitem"
            onClick={() => {
              changeServer();
              setIsOpen(false);
            }}
            style={styles.menuAction}
          >
            Change Server
          </button>
          <button
            role="menuitem"
            onClick={() => {
              logout();
              setIsOpen(false);
            }}
            style={{ ...styles.menuAction, color: "var(--error)" }}
          >
            Sign Out
          </button>
        </div>
      )}

      {/* PIN entry modal */}
      {pinUser && (
        <PinEntryModal
          userName={pinUser.title}
          userThumb={pinUser.thumb}
          error={switchError}
          isLoading={isSwitching}
          onSubmit={handlePinSubmit}
          onCancel={handlePinCancel}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  serverName: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  avatarButton: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "4px",
    borderRadius: "6px",
    color: "var(--text-secondary)",
  },
  avatarImg: {
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    objectFit: "cover",
  },
  avatarFallback: {
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "4px 0",
    minWidth: "220px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
    zIndex: 1200,
    animation: "popIn 0.12s ease-out",
  },
  currentUser: {
    padding: "10px 14px",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  currentUserName: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  adminBadge: {
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "#000",
    background: "var(--accent)",
    padding: "1px 6px",
    borderRadius: "4px",
  },
  divider: {
    height: "1px",
    background: "var(--border)",
    margin: "4px 0",
  },
  sectionLabel: {
    padding: "6px 14px 4px",
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  userItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "6px 14px",
    background: "transparent",
    border: "none",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    textAlign: "left",
    cursor: "pointer",
  },
  userItemAvatar: {
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  userItemAvatarFallback: {
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    background: "var(--bg-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.7rem",
    fontWeight: 600,
    flexShrink: 0,
  },
  userItemName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  menuAction: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 14px",
    fontSize: "0.85rem",
    color: "var(--text-primary)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
  },
};

export default UserSwitcher;
