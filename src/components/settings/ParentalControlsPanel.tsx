import { useState, useEffect, useCallback } from "react";
import { useHomeUsers } from "../../hooks/useHomeUsers";
import { useParentalControls } from "../../hooks/useParentalControls";
import { useToast } from "../../hooks/useToast";
import {
  RATING_LEVELS,
  RATING_LABELS,
  DEFAULT_PARENTAL_CONTROLS,
} from "../../types/parental-controls";
import type {
  ContentRatingLevel,
  ParentalControlSettings,
} from "../../types/parental-controls";
import type { HomeUser } from "../../types/home-user";
import { styles as s } from "./settingsStyles";

export function ParentalControlsPanel() {
  const { homeUsers, isPlexHome } = useHomeUsers();
  const { loadForUser, saveForUser } = useParentalControls();
  const { toast } = useToast();

  // Only show non-admin managed users
  const managedUsers = homeUsers.filter((u) => !u.admin);

  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editSettings, setEditSettings] = useState<ParentalControlSettings>(
    DEFAULT_PARENTAL_CONTROLS,
  );
  const [saving, setSaving] = useState(false);

  // Per-user settings cache for display
  const [userSettings, setUserSettings] = useState<
    Record<number, ParentalControlSettings>
  >({});

  // Load settings for all managed users on mount
  useEffect(() => {
    if (managedUsers.length === 0) return;
    let cancelled = false;

    Promise.all(
      managedUsers.map(async (u) => {
        const settings = await loadForUser(u.id);
        return [u.id, settings] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<number, ParentalControlSettings> = {};
      for (const [id, settings] of results) {
        map[id] = settings;
      }
      setUserSettings(map);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedUsers.length]);

  const handleEdit = useCallback(
    async (user: HomeUser) => {
      const settings = await loadForUser(user.id);
      setEditSettings(settings);
      setEditingUserId(user.id);
    },
    [loadForUser],
  );

  const handleSave = useCallback(async () => {
    if (editingUserId === null) return;
    setSaving(true);
    try {
      await saveForUser(editingUserId, editSettings);
      setUserSettings((prev) => ({
        ...prev,
        [editingUserId]: editSettings,
      }));
      const user = managedUsers.find((u) => u.id === editingUserId);
      toast(`Restrictions updated for ${user?.title ?? "user"}`, "success");
      setEditingUserId(null);
    } catch {
      toast("Failed to save restrictions", "error");
    } finally {
      setSaving(false);
    }
  }, [editingUserId, editSettings, saveForUser, managedUsers, toast]);

  if (!isPlexHome || managedUsers.length === 0) return null;

  return (
    <div style={s.section}>
      <h3 style={s.sectionTitle}>Parental Controls</h3>
      <p style={s.hint}>
        Set content rating restrictions for managed users. Restricted users will
        only see content at or below their allowed rating.
      </p>

      <div style={panelStyles.userList}>
        {managedUsers.map((user) => {
          const settings = userSettings[user.id];
          const isEditing = editingUserId === user.id;

          return (
            <div key={user.id} style={panelStyles.userCard}>
              {/* User row */}
              <div style={panelStyles.userRow}>
                <img
                  src={user.thumb}
                  alt=""
                  style={panelStyles.avatar}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <div style={panelStyles.userInfo}>
                  <span style={panelStyles.userName}>
                    {user.title}
                    {user.protected && (
                      <svg
                        width={12}
                        height={12}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--text-secondary)"
                        strokeWidth={2}
                        style={{ marginLeft: 4, verticalAlign: "middle" }}
                      >
                        <rect x={3} y={11} width={18} height={11} rx={2} ry={2} />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    )}
                  </span>
                  <span style={panelStyles.userRestriction}>
                    {settings?.enabled && settings.maxContentRating !== "none"
                      ? `Max: ${settings.maxContentRating}`
                      : "No restrictions"}
                  </span>
                </div>
                <button
                  onClick={() =>
                    isEditing ? setEditingUserId(null) : handleEdit(user)
                  }
                  style={panelStyles.editButton}
                >
                  {isEditing ? "Cancel" : "Edit"}
                </button>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div style={panelStyles.editForm}>
                  <div style={s.field}>
                    <label style={s.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={editSettings.enabled}
                        onChange={(e) =>
                          setEditSettings((prev) => ({
                            ...prev,
                            enabled: e.target.checked,
                          }))
                        }
                        style={s.checkbox}
                      />
                      Enable content restrictions
                    </label>
                  </div>

                  {editSettings.enabled && (
                    <div style={s.field}>
                      <label style={s.label}>Maximum Allowed Rating</label>
                      <select
                        value={editSettings.maxContentRating}
                        onChange={(e) =>
                          setEditSettings((prev) => ({
                            ...prev,
                            maxContentRating: e.target.value as ContentRatingLevel,
                          }))
                        }
                        style={s.select}
                      >
                        {RATING_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {RATING_LABELS[level]}
                          </option>
                        ))}
                      </select>
                      <p style={s.hint}>
                        Content rated above this level will be hidden from this
                        user's library, search results, and dashboard.
                      </p>
                    </div>
                  )}

                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      ...s.saveButton,
                      opacity: saving ? 0.6 : 1,
                    }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const panelStyles: Record<string, React.CSSProperties> = {
  userList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  userCard: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  },
  userRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  userInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  userName: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  userRestriction: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  editButton: {
    background: "transparent",
    color: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: 6,
    padding: "0.3rem 0.75rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  },
  editForm: {
    padding: "0 1rem 1rem",
    borderTop: "1px solid var(--border)",
    paddingTop: "0.75rem",
  },
};
