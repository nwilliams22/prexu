import {
  deriveRelayUrl,
  getDefaultPreferences,
  getClientIdentifier,
  saveAuth,
  getAuth,
  clearAuth,
  saveServer,
  getServer,
  clearServer,
  getPreferences,
  savePreferences,
  getUserPreferences,
  saveUserPreferences,
  getRelayUrl,
  saveRelayUrl,
  clearRelayUrl,
  hasManualRelayUrl,
  saveAdminAuth,
  getAdminAuth,
  clearAdminAuth,
  saveActiveUser,
  getActiveUser,
  clearActiveUser,
} from "./storage";
import { createAuthData, createServerData, createActiveUser, createPreferences } from "../__tests__/mocks/plex-data";

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── Pure functions ──

  describe("deriveRelayUrl", () => {
    it("extracts hostname and returns ws URL with default relay port", () => {
      expect(deriveRelayUrl("https://192.168.1.100:32400")).toBe(
        "ws://192.168.1.100:9847/ws"
      );
    });

    it("works with HTTP URIs", () => {
      expect(deriveRelayUrl("http://10.0.0.5:32400")).toBe(
        "ws://10.0.0.5:9847/ws"
      );
    });

    it("works with domain names", () => {
      expect(deriveRelayUrl("https://plex.example.com:32400")).toBe(
        "ws://plex.example.com:9847/ws"
      );
    });

    it("works with localhost", () => {
      expect(deriveRelayUrl("http://localhost:32400")).toBe(
        "ws://localhost:9847/ws"
      );
    });

    it("ignores the original port", () => {
      expect(deriveRelayUrl("https://server:12345")).toBe(
        "ws://server:9847/ws"
      );
    });

    it("falls back to localhost for invalid URL", () => {
      expect(deriveRelayUrl("not-a-valid-url")).toBe(
        "ws://localhost:9847/ws"
      );
    });

    it("falls back to localhost for empty string", () => {
      expect(deriveRelayUrl("")).toBe("ws://localhost:9847/ws");
    });
  });

  describe("getDefaultPreferences", () => {
    it("returns a complete Preferences object", () => {
      const prefs = getDefaultPreferences();
      expect(prefs).toHaveProperty("playback");
      expect(prefs).toHaveProperty("appearance");
    });

    it("has correct playback defaults", () => {
      const prefs = getDefaultPreferences();
      expect(prefs.playback).toEqual({
        quality: "1080p",
        preferredAudioLanguage: "",
        preferredSubtitleLanguage: "",
        defaultSubtitles: "auto",
        subtitleSize: 100,
        audioBoost: 100,
        directPlayPreference: "never",
        volumeBoost: 1.0,
        normalizationPreset: "off",
        audioOffsetMs: 0,
        skipIntroEnabled: true,
        skipCreditsEnabled: true,
        subtitleStyle: {
          fontFamily: "sans-serif",
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          backgroundOpacity: 0.75,
          outlineColor: "#000000",
          outlineWidth: 2,
          shadowEnabled: true,
        },
      });
    });

    it("has correct appearance defaults", () => {
      const prefs = getDefaultPreferences();
      expect(prefs.appearance).toEqual({
        posterSize: "medium",
        sidebarCollapsed: false,
        skipSingleSeason: true,
        minCollectionSize: 2,
        dashboardSections: {
          continueWatching: true,
          recentMovies: true,
          recentShows: true,
        },
      });
    });

    it("returns a new object each time (not a shared reference)", () => {
      const prefs1 = getDefaultPreferences();
      const prefs2 = getDefaultPreferences();
      expect(prefs1).toEqual(prefs2);
      expect(prefs1).not.toBe(prefs2);
      prefs1.playback.quality = "720p";
      expect(prefs2.playback.quality).toBe("1080p");
    });
  });

  // ── getClientIdentifier ──

  describe("getClientIdentifier", () => {
    it("generates and returns a UUID", async () => {
      const id = await getClientIdentifier();
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
    });

    it("caches the UUID in localStorage", async () => {
      const id = await getClientIdentifier();
      const stored = localStorage.getItem("client_identifier");
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toBe(id);
    });

    it("returns the same ID on subsequent calls", async () => {
      const id1 = await getClientIdentifier();
      const id2 = await getClientIdentifier();
      expect(id1).toBe(id2);
    });
  });

  // ── Auth data ──

  describe("saveAuth / getAuth / clearAuth", () => {
    it("round-trips auth data", async () => {
      const auth = createAuthData({ authToken: "my-token-123" });
      await saveAuth(auth);
      const result = await getAuth();
      expect(result).toEqual(auth);
    });

    it("returns null when no auth saved", async () => {
      const result = await getAuth();
      expect(result).toBeNull();
    });

    it("clearAuth removes auth, server, admin auth, and active user", async () => {
      await saveAuth(createAuthData());
      await saveServer(createServerData());
      await saveAdminAuth(createAuthData({ authToken: "admin-token" }));
      await saveActiveUser(createActiveUser());

      await clearAuth();

      expect(await getAuth()).toBeNull();
      expect(await getServer()).toBeNull();
      expect(await getAdminAuth()).toBeNull();
      expect(await getActiveUser()).toBeNull();
    });
  });

  // ── Server data ──

  describe("saveServer / getServer / clearServer", () => {
    it("round-trips server data", async () => {
      const server = createServerData({ name: "My Plex Server" });
      await saveServer(server);
      const result = await getServer();
      expect(result).toEqual(server);
    });

    it("returns null when no server saved", async () => {
      expect(await getServer()).toBeNull();
    });

    it("clearServer only removes server data", async () => {
      await saveAuth(createAuthData());
      await saveServer(createServerData());

      await clearServer();

      expect(await getServer()).toBeNull();
      expect(await getAuth()).not.toBeNull(); // auth preserved
    });
  });

  // ── Admin auth ──

  describe("saveAdminAuth / getAdminAuth / clearAdminAuth", () => {
    it("round-trips admin auth data", async () => {
      const auth = createAuthData({ authToken: "admin-token" });
      await saveAdminAuth(auth);
      const result = await getAdminAuth();
      expect(result).toEqual(auth);
    });

    it("returns null when no admin auth saved", async () => {
      expect(await getAdminAuth()).toBeNull();
    });

    it("clearAdminAuth removes admin auth only", async () => {
      await saveAuth(createAuthData());
      await saveAdminAuth(createAuthData({ authToken: "admin" }));

      await clearAdminAuth();

      expect(await getAdminAuth()).toBeNull();
      expect(await getAuth()).not.toBeNull();
    });
  });

  // ── Active user ──

  describe("saveActiveUser / getActiveUser / clearActiveUser", () => {
    it("round-trips active user data", async () => {
      const user = createActiveUser({ title: "John", isAdmin: true });
      await saveActiveUser(user);
      const result = await getActiveUser();
      expect(result).toEqual(user);
    });

    it("returns null when no active user saved", async () => {
      expect(await getActiveUser()).toBeNull();
    });

    it("clearActiveUser removes active user only", async () => {
      await saveAuth(createAuthData());
      await saveActiveUser(createActiveUser());

      await clearActiveUser();

      expect(await getActiveUser()).toBeNull();
      expect(await getAuth()).not.toBeNull();
    });
  });

  // ── Preferences ──

  describe("getPreferences / savePreferences", () => {
    it("returns defaults when nothing saved", async () => {
      const prefs = await getPreferences();
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it("round-trips preferences", async () => {
      const prefs = createPreferences({
        playback: { quality: "720p" },
      });
      await savePreferences(prefs);
      const result = await getPreferences();
      expect(result.playback.quality).toBe("720p");
    });

    it("merges saved preferences with defaults (handles missing keys)", async () => {
      // Simulate an old save that's missing new keys
      localStorage.setItem(
        "prexu_preferences",
        JSON.stringify({
          playback: { quality: "480p" },
          appearance: { posterSize: "large" },
        })
      );

      const prefs = await getPreferences();
      // Saved values preserved
      expect(prefs.playback.quality).toBe("480p");
      expect(prefs.appearance.posterSize).toBe("large");
      // Defaults applied for missing keys
      expect(prefs.playback.subtitleSize).toBe(100);
      expect(prefs.appearance.dashboardSections.continueWatching).toBe(true);
    });

    it("deep merges dashboardSections", async () => {
      localStorage.setItem(
        "prexu_preferences",
        JSON.stringify({
          playback: { quality: "1080p" },
          appearance: {
            posterSize: "medium",
            sidebarCollapsed: false,
            dashboardSections: { continueWatching: false },
          },
        })
      );

      const prefs = await getPreferences();
      expect(prefs.appearance.dashboardSections.continueWatching).toBe(false);
      expect(prefs.appearance.dashboardSections.recentMovies).toBe(true);
      expect(prefs.appearance.dashboardSections.recentShows).toBe(true);
    });
  });

  // ── Per-user preferences ──

  describe("getUserPreferences / saveUserPreferences", () => {
    it("returns defaults when nothing saved for user", async () => {
      const prefs = await getUserPreferences(42);
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it("falls back to global prefs when no per-user prefs exist", async () => {
      await savePreferences(
        createPreferences({ playback: { quality: "480p" } })
      );
      const prefs = await getUserPreferences(42);
      expect(prefs.playback.quality).toBe("480p");
    });

    it("returns per-user prefs when saved", async () => {
      await savePreferences(
        createPreferences({ playback: { quality: "480p" } })
      );
      await saveUserPreferences(
        42,
        createPreferences({ playback: { quality: "720p" } })
      );

      const prefs = await getUserPreferences(42);
      expect(prefs.playback.quality).toBe("720p");
    });

    it("merges per-user prefs with defaults", async () => {
      localStorage.setItem(
        "prexu_preferences_42",
        JSON.stringify({
          playback: { quality: "720p" },
          appearance: { posterSize: "large" },
        })
      );

      const prefs = await getUserPreferences(42);
      expect(prefs.playback.quality).toBe("720p");
      expect(prefs.playback.subtitleSize).toBe(100); // default
    });
  });

  // ── Relay URL ──

  describe("getRelayUrl / saveRelayUrl / clearRelayUrl / hasManualRelayUrl", () => {
    it("returns derived URL when no manual override", async () => {
      const url = await getRelayUrl("https://192.168.1.100:32400");
      expect(url).toBe("ws://192.168.1.100:9847/ws");
    });

    it("returns localhost fallback when no server URI and no manual override", async () => {
      const url = await getRelayUrl();
      expect(url).toBe("ws://localhost:9847/ws");
    });

    it("returns manual override when set", async () => {
      await saveRelayUrl("ws://custom-relay:9999/ws");
      const url = await getRelayUrl("https://192.168.1.100:32400");
      expect(url).toBe("ws://custom-relay:9999/ws");
    });

    it("clearRelayUrl reverts to auto-discovery", async () => {
      await saveRelayUrl("ws://custom:9999/ws");
      await clearRelayUrl();
      const url = await getRelayUrl("https://192.168.1.100:32400");
      expect(url).toBe("ws://192.168.1.100:9847/ws");
    });

    it("hasManualRelayUrl returns false when not set", async () => {
      expect(await hasManualRelayUrl()).toBe(false);
    });

    it("hasManualRelayUrl returns true when set", async () => {
      await saveRelayUrl("ws://custom:9999/ws");
      expect(await hasManualRelayUrl()).toBe(true);
    });
  });
});
