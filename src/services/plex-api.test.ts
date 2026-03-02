import { validateToken, getPlexUser, getHomeUsers, switchHomeUser } from "./plex-api";

// Mock storage module
vi.mock("./storage", () => ({
  getClientIdentifier: vi.fn().mockResolvedValue("test-client-id"),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe("plex-api", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── validateToken ──

  describe("validateToken", () => {
    it("returns true when response is ok", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));
      expect(await validateToken("valid-token")).toBe(true);
    });

    it("returns false when response is not ok", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      expect(await validateToken("invalid-token")).toBe(false);
    });

    it("returns false when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      expect(await validateToken("any-token")).toBe(false);
    });

    it("calls the correct endpoint with auth headers", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));
      await validateToken("my-token");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://clients.plex.tv/api/v2/user");
      expect(options.headers["X-Plex-Token"]).toBe("my-token");
      expect(options.headers["X-Plex-Client-Identifier"]).toBe("test-client-id");
    });
  });

  // ── getPlexUser ──

  describe("getPlexUser", () => {
    it("parses user profile from response", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 12345,
          username: "testuser",
          email: "test@example.com",
          friendlyName: "Test User",
          thumb: "https://plex.tv/users/12345/avatar",
        })
      );

      const user = await getPlexUser("valid-token");

      expect(user.id).toBe(12345);
      expect(user.username).toBe("testuser");
      expect(user.email).toBe("test@example.com");
      expect(user.friendlyName).toBe("Test User");
      expect(user.thumb).toBe("https://plex.tv/users/12345/avatar");
    });

    it("handles missing optional fields", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          title: "FallbackName",
        })
      );

      const user = await getPlexUser("valid-token");

      expect(user.id).toBe(1);
      expect(user.username).toBe("FallbackName"); // falls back to title
      expect(user.email).toBe("");
      expect(user.friendlyName).toBe("FallbackName"); // falls back to title
      expect(user.thumb).toBe("");
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(getPlexUser("bad-token")).rejects.toThrow(
        "Failed to fetch user profile: 401"
      );
    });
  });

  // ── getHomeUsers ──

  describe("getHomeUsers", () => {
    it("parses user list from response", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          users: [
            {
              id: 1,
              uuid: "uuid-1",
              title: "Admin",
              username: "admin",
              thumb: "",
              admin: true,
              guest: false,
              restricted: false,
              home: true,
              protected: false,
            },
            {
              id: 2,
              uuid: "uuid-2",
              title: "Kid",
              username: "",
              thumb: "",
              admin: false,
              guest: false,
              restricted: true,
              home: true,
              protected: true,
            },
          ],
        })
      );

      const users = await getHomeUsers("valid-token");

      expect(users).toHaveLength(2);
      expect(users[0].id).toBe(1);
      expect(users[0].admin).toBe(true);
      expect(users[1].id).toBe(2);
      expect(users[1].restricted).toBe(true);
      expect(users[1].protected).toBe(true);
    });

    it("returns empty array on 401", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      const users = await getHomeUsers("bad-token");
      expect(users).toEqual([]);
    });

    it("returns empty array on 403", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 403));
      const users = await getHomeUsers("bad-token");
      expect(users).toEqual([]);
    });

    it("returns empty array on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      const users = await getHomeUsers("any-token");
      expect(users).toEqual([]);
    });

    it("handles array response format (no users wrapper)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          { id: 1, title: "User 1", admin: true },
        ])
      );

      const users = await getHomeUsers("valid-token");
      expect(users).toHaveLength(1);
      expect(users[0].title).toBe("User 1");
    });
  });

  // ── switchHomeUser ──

  describe("switchHomeUser", () => {
    it("returns new auth token on success", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ authToken: "new-user-token" })
      );

      const token = await switchHomeUser("admin-token", 42);
      expect(token).toBe("new-user-token");
    });

    it("sends POST with PIN when provided", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ authToken: "new-token" })
      );

      await switchHomeUser("admin-token", 42, "1234");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/home/users/42/switch");
      expect(options.method).toBe("POST");
      expect(options.body).toContain("pin=1234");
    });

    it("throws 'Incorrect PIN' on 401", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(switchHomeUser("token", 42, "wrong")).rejects.toThrow(
        "Incorrect PIN"
      );
    });

    it("throws on other errors", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(switchHomeUser("token", 42)).rejects.toThrow(
        "Failed to switch user: 500"
      );
    });

    it("throws when no auth token in response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await expect(switchHomeUser("token", 42)).rejects.toThrow(
        "No auth token returned from user switch"
      );
    });

    it("handles authentication_token field (legacy)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ authentication_token: "legacy-token" })
      );

      const token = await switchHomeUser("admin-token", 42);
      expect(token).toBe("legacy-token");
    });
  });
});
