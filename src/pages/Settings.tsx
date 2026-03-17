import { useState, useEffect } from "react";
import {
  getRelayUrl,
  saveRelayUrl,
  clearRelayUrl,
  hasManualRelayUrl,
  deriveRelayUrl,
} from "../services/storage";
import { useAuth } from "../hooks/useAuth";
import { useInvites } from "../hooks/useInvites";
import { usePreferences } from "../hooks/usePreferences";
import { open } from "@tauri-apps/plugin-shell";
import type { PlaybackPreferences, AppearancePreferences, NormalizationPreset } from "../types/preferences";
import { LANGUAGES } from "../constants/languages";

function Settings() {
  const { server, activeUser } = useAuth();
  const { isRelayConnected, refreshInvites } = useInvites();
  const isAdmin = activeUser?.isAdmin ?? false;
  const { preferences, updatePreferences } = usePreferences();

  // Relay state
  const [manualUrl, setManualUrl] = useState("");
  const [hasOverride, setHasOverride] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [relaySaved, setRelaySaved] = useState(false);

  const autoUrl = server?.uri ? deriveRelayUrl(server.uri) : null;

  useEffect(() => {
    (async () => {
      const isManual = await hasManualRelayUrl();
      setHasOverride(isManual);
      setShowOverride(isManual);
      if (isManual) {
        const url = await getRelayUrl();
        setManualUrl(url);
      }
    })();
  }, []);

  const handleSaveOverride = async () => {
    await saveRelayUrl(manualUrl);
    setHasOverride(true);
    setRelaySaved(true);
    setTimeout(() => setRelaySaved(false), 2000);
    refreshInvites();
  };

  const handleResetToAuto = async () => {
    await clearRelayUrl();
    setHasOverride(false);
    setShowOverride(false);
    setManualUrl("");
    setRelaySaved(false);
    refreshInvites();
  };

  const pb = preferences.playback;
  const ap = preferences.appearance;

  const updatePlayback = (partial: Partial<PlaybackPreferences>) => {
    updatePreferences({ playback: partial });
  };

  const updateAppearance = (partial: Partial<AppearancePreferences>) => {
    updatePreferences({ appearance: partial });
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Settings</h2>

      {/* ── Playback ── */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Playback</h3>

        <div style={styles.field}>
          <label style={styles.label}>Video Quality</label>
          <select
            value={pb.quality}
            onChange={(e) => updatePlayback({ quality: e.target.value as PlaybackPreferences["quality"] })}
            style={styles.select}
          >
            <option value="original">Original (Direct Play)</option>
            <option value="1080p">1080p (20 Mbps)</option>
            <option value="720p">720p (4 Mbps)</option>
            <option value="480p">480p (2 Mbps)</option>
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Direct Play Preference</label>
          <p style={styles.hint}>
            Auto will direct play compatible files and transcode others.
          </p>
          <select
            value={pb.directPlayPreference}
            onChange={(e) => updatePlayback({ directPlayPreference: e.target.value as PlaybackPreferences["directPlayPreference"] })}
            style={styles.select}
          >
            <option value="auto">Auto</option>
            <option value="always">Always try direct play</option>
            <option value="never">Always transcode</option>
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Preferred Audio Language</label>
          <select
            value={pb.preferredAudioLanguage}
            onChange={(e) => updatePlayback({ preferredAudioLanguage: e.target.value })}
            style={styles.select}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Default Subtitles</label>
          <select
            value={pb.defaultSubtitles}
            onChange={(e) => updatePlayback({ defaultSubtitles: e.target.value as PlaybackPreferences["defaultSubtitles"] })}
            style={styles.select}
          >
            <option value="auto">Auto (use server default)</option>
            <option value="always">Always on</option>
            <option value="off">Off</option>
          </select>
        </div>

        {pb.defaultSubtitles !== "off" && (
          <div style={styles.field}>
            <label style={styles.label}>Preferred Subtitle Language</label>
            <select
              value={pb.preferredSubtitleLanguage}
              onChange={(e) => updatePlayback({ preferredSubtitleLanguage: e.target.value })}
              style={styles.select}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
        )}

        <div style={styles.field}>
          <label style={styles.label}>
            Subtitle Size: {pb.subtitleSize}%
          </label>
          <input
            type="range"
            min={50}
            max={200}
            step={10}
            value={pb.subtitleSize}
            onChange={(e) => updatePlayback({ subtitleSize: Number(e.target.value) })}
            style={styles.slider}
          />
          <div style={styles.sliderLabels}>
            <span>Small</span>
            <span>Normal</span>
            <span>Large</span>
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>
            Audio Boost: {pb.audioBoost}%
          </label>
          <p style={styles.hint}>
            Server-side audio boost applied during transcoding.
          </p>
          <input
            type="range"
            min={0}
            max={200}
            step={10}
            value={pb.audioBoost}
            onChange={(e) => updatePlayback({ audioBoost: Number(e.target.value) })}
            style={styles.slider}
          />
          <div style={styles.sliderLabels}>
            <span>Off</span>
            <span>Normal</span>
            <span>Max</span>
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>
            Volume Boost: {Math.round(pb.volumeBoost * 100)}%
          </label>
          <p style={styles.hint}>
            Client-side amplification via Web Audio API. Values above 200% may
            cause distortion with some audio tracks.
          </p>
          <input
            type="range"
            min={100}
            max={500}
            step={25}
            value={Math.round(pb.volumeBoost * 100)}
            onChange={(e) => updatePlayback({ volumeBoost: Number(e.target.value) / 100 })}
            style={styles.slider}
          />
          <div style={styles.sliderLabels}>
            <span>100%</span>
            <span>300%</span>
            <span>500%</span>
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Audio Normalization</label>
          <p style={styles.hint}>
            Compresses dynamic range so quiet dialogue and loud effects are
            closer in volume. Night mode is more aggressive for late-night viewing.
          </p>
          <select
            value={pb.normalizationPreset}
            onChange={(e) => updatePlayback({ normalizationPreset: e.target.value as NormalizationPreset })}
            style={styles.select}
          >
            <option value="off">Off</option>
            <option value="light">Light</option>
            <option value="night">Night Mode</option>
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>
            Audio Offset: {pb.audioOffsetMs}ms
          </label>
          <p style={styles.hint}>
            Delays audio playback to fix lip-sync issues. Increase if audio
            plays before the video.
          </p>
          <input
            type="range"
            min={0}
            max={500}
            step={10}
            value={pb.audioOffsetMs}
            onChange={(e) => updatePlayback({ audioOffsetMs: Number(e.target.value) })}
            style={styles.slider}
          />
          <div style={styles.sliderLabels}>
            <span>0ms</span>
            <span>250ms</span>
            <span>500ms</span>
          </div>
        </div>
      </section>

      {/* ── Appearance ── */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Appearance</h3>

        <div style={styles.field}>
          <label style={styles.label}>Poster Size</label>
          <div style={styles.radioGroup}>
            {(["small", "medium", "large"] as const).map((size) => (
              <label key={size} style={styles.radioLabel}>
                <input
                  type="radio"
                  name="posterSize"
                  checked={ap.posterSize === size}
                  onChange={() => updateAppearance({ posterSize: size })}
                  style={styles.radio}
                />
                {size.charAt(0).toUpperCase() + size.slice(1)}
              </label>
            ))}
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Sidebar Default</label>
          <div style={styles.radioGroup}>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="sidebar"
                checked={!ap.sidebarCollapsed}
                onChange={() => updateAppearance({ sidebarCollapsed: false })}
                style={styles.radio}
              />
              Expanded
            </label>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="sidebar"
                checked={ap.sidebarCollapsed}
                onChange={() => updateAppearance({ sidebarCollapsed: true })}
                style={styles.radio}
              />
              Collapsed
            </label>
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Dashboard Sections</label>
          <div style={styles.checkboxGroup}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={ap.dashboardSections.continueWatching}
                onChange={(e) =>
                  updatePreferences({
                    appearance: {
                      dashboardSections: { continueWatching: e.target.checked },
                    },
                  })
                }
                style={styles.checkbox}
              />
              Continue Watching
            </label>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={ap.dashboardSections.recentMovies}
                onChange={(e) =>
                  updatePreferences({
                    appearance: {
                      dashboardSections: { recentMovies: e.target.checked },
                    },
                  })
                }
                style={styles.checkbox}
              />
              Recently Added Movies
            </label>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={ap.dashboardSections.recentShows}
                onChange={(e) =>
                  updatePreferences({
                    appearance: {
                      dashboardSections: { recentShows: e.target.checked },
                    },
                  })
                }
                style={styles.checkbox}
              />
              Recently Added TV Shows
            </label>
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>TV Show Navigation</label>
          <div style={styles.checkboxGroup}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={ap.skipSingleSeason}
                onChange={(e) =>
                  updateAppearance({ skipSingleSeason: e.target.checked })
                }
                style={styles.checkbox}
              />
              Skip seasons page for single-season shows
            </label>
          </div>
          <p style={styles.hint}>
            When enabled, shows with only one season go directly to the episode
            list instead of showing a seasons page.
          </p>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Minimum Collection Size</label>
          <select
            value={ap.minCollectionSize}
            onChange={(e) =>
              updateAppearance({ minCollectionSize: Number(e.target.value) })
            }
            style={styles.select}
          >
            {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n} items
              </option>
            ))}
          </select>
          <p style={styles.hint}>
            Collections with fewer items than this will be hidden from the
            collections browser and library view.
          </p>
        </div>
      </section>

      {/* ── Watch Together ── */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Watch Together</h3>

        <div style={styles.field}>
          <label style={styles.label}>Relay Server</label>
          <p style={styles.hint}>
            The relay server coordinates Watch Together sessions. By default,
            Prexu auto-detects the relay from your Plex server address.
          </p>

          <div style={styles.autoRow}>
            <span style={styles.autoLabel}>
              {hasOverride ? "Auto-detected:" : "Connected via:"}
            </span>
            <code style={styles.autoUrl}>
              {autoUrl ?? "No server selected"}
            </code>
            {!hasOverride && <span style={styles.autoBadge}>Auto</span>}
          </div>

          <div style={styles.statusRow}>
            <div
              style={{
                ...styles.statusDot,
                background: isRelayConnected ? "var(--success)" : "var(--error)",
              }}
            />
            <span style={styles.statusText}>
              {isRelayConnected ? "Connected to relay" : "Not connected"}
            </span>
          </div>

          {!showOverride ? (
            <button
              onClick={() => setShowOverride(true)}
              style={styles.linkButton}
            >
              Use custom relay URL
            </button>
          ) : (
            <div style={styles.overrideSection}>
              <label style={styles.overrideLabel}>Custom Relay URL</label>
              <div style={styles.inputRow}>
                <input
                  type="text"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="ws://your-server:9847/ws"
                  style={styles.input}
                />
                <button onClick={handleSaveOverride} style={styles.saveButton}>
                  {relaySaved ? "Saved!" : "Save"}
                </button>
              </div>
              {hasOverride && (
                <button onClick={handleResetToAuto} style={styles.linkButton}>
                  Reset to auto-detect
                </button>
              )}
              {!hasOverride && (
                <button
                  onClick={() => setShowOverride(false)}
                  style={styles.linkButton}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Content Requests (Admin only) ── */}
      {isAdmin && (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Content Requests</h3>
          <p style={styles.hint}>
            Content search is powered by TMDb via the relay server.
            The relay server admin must set the TMDB_API_KEY environment
            variable to enable search functionality.
          </p>
        </section>
      )}

      {/* ── About ── */}
      <section style={{ ...styles.section, borderBottom: "none" }}>
        <h3 style={styles.sectionTitle}>About</h3>
        <div style={styles.aboutRow}>
          <span style={styles.aboutLabel}>Prexu</span>
          <span style={styles.aboutVersion}>v0.1.0</span>
        </div>
        <p style={styles.hint}>A custom cross-platform Plex client.</p>
        <button
          onClick={() => open("https://github.com/nwilliams22/prexu/issues/new")}
          style={styles.bugButton}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ marginRight: "0.4rem" }}>
            <circle cx={12} cy={12} r={10} />
            <line x1={12} y1={8} x2={12} y2={12} />
            <line x1={12} y1={16} x2={12.01} y2={16} />
          </svg>
          Report a Bug
        </button>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
    maxWidth: "600px",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    marginBottom: "1.5rem",
  },
  section: {
    marginBottom: "1.75rem",
    paddingBottom: "1.5rem",
    borderBottom: "1px solid var(--border)",
  },
  sectionTitle: {
    fontSize: "1.15rem",
    fontWeight: 600,
    marginBottom: "1rem",
    color: "var(--accent)",
  },
  field: {
    marginBottom: "1.25rem",
  },
  label: {
    fontSize: "0.9rem",
    fontWeight: 500,
    marginBottom: "0.35rem",
    display: "block",
  },
  hint: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    marginBottom: "0.75rem",
    lineHeight: 1.4,
  },
  select: {
    width: "100%",
    padding: "0.5rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.9rem",
    outline: "none",
  },
  slider: {
    width: "100%",
    accentColor: "var(--accent)",
  },
  sliderLabels: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    marginTop: "0.15rem",
  },
  radioGroup: {
    display: "flex",
    gap: "1.25rem",
  },
  radioLabel: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.9rem",
    color: "var(--text-primary)",
    cursor: "pointer",
  },
  radio: {
    accentColor: "var(--accent)",
  },
  checkboxGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.9rem",
    color: "var(--text-primary)",
    cursor: "pointer",
  },
  checkbox: {
    accentColor: "var(--accent)",
  },

  // Watch Together
  autoRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  autoLabel: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  autoUrl: {
    fontSize: "0.8rem",
    color: "var(--text-primary)",
    background: "var(--bg-card)",
    padding: "0.2rem 0.5rem",
    borderRadius: "4px",
    fontFamily: "monospace",
  },
  autoBadge: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "#000",
    background: "var(--accent)",
    padding: "0.1rem 0.4rem",
    borderRadius: "4px",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.75rem",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
  },
  statusText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  linkButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    fontSize: "0.8rem",
    textDecoration: "underline",
    cursor: "pointer",
    padding: 0,
    marginTop: "0.5rem",
    display: "block",
  },
  overrideSection: {
    marginTop: "0.5rem",
    padding: "0.75rem",
    background: "var(--bg-card)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
  },
  overrideLabel: {
    fontSize: "0.85rem",
    fontWeight: 500,
    marginBottom: "0.5rem",
    display: "block",
  },
  inputRow: {
    display: "flex",
    gap: "0.5rem",
  },
  input: {
    flex: 1,
    padding: "0.5rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.9rem",
    outline: "none",
  },
  saveButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "8px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  // About
  aboutRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
    marginBottom: "0.25rem",
  },
  aboutLabel: {
    fontSize: "1rem",
    fontWeight: 600,
  },
  aboutVersion: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  bugButton: {
    display: "inline-flex",
    alignItems: "center",
    background: "transparent",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.85rem",
    cursor: "pointer",
    marginTop: "0.5rem",
  },
};

export default Settings;
