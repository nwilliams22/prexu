import { validateToken, getPlexUser, getHomeUsers, switchHomeUser, getPlexFriends, timedFetch, isTimeoutError } from "./plex-api";

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

function xmlResponse(xml: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(xml),
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

  // ── timedFetch ──
  // Uses real timers with short timeouts (10ms) — fake timers don't play
  // nicely with AbortSignal abort events resolving via microtasks.

  describe("timedFetch", () => {
    /** Mock fetch that hangs until the signal aborts, then rejects with reason. */
    function abortableHang() {
      return (_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            reject(opts.signal.reason ?? new Error("aborted"));
          });
        });
    }

    it("rejects with TimeoutError carrying url + elapsed when timeout fires", async () => {
      mockFetch.mockImplementation(abortableHang());

      const url = `https://example.test/slow-${Date.now()}-${Math.random()}`;
      let caught: unknown;
      try {
        await timedFetch(url, { timeoutMs: 10, retries: 0 });
      } catch (err) {
        caught = err;
      }

      expect(isTimeoutError(caught)).toBe(true);
      expect((caught as DOMException).message).toContain("Request timed out");
      expect((caught as DOMException).message).toContain(url);
    });

    it("retries once on timeout when retries > 0", async () => {
      let calls = 0;
      mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        calls++;
        if (calls === 1) {
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () =>
              reject(opts.signal.reason ?? new Error("aborted")),
            );
          });
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      });

      const url = `https://example.test/retry-success-${Date.now()}-${Math.random()}`;
      const response = await timedFetch(url, { timeoutMs: 10, retries: 1 });

      expect(response.ok).toBe(true);
      expect(calls).toBe(2);
    });

    it("does not retry when retries=0", async () => {
      let calls = 0;
      mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        calls++;
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(opts.signal.reason ?? new Error("aborted")),
          );
        });
      });

      const url = `https://example.test/no-retry-${Date.now()}-${Math.random()}`;
      await expect(
        timedFetch(url, { timeoutMs: 10, retries: 0 }),
      ).rejects.toThrow(/Request timed out/);
      expect(calls).toBe(1);
    });

    it("does not retry on non-timeout errors", async () => {
      let calls = 0;
      mockFetch.mockImplementation(() => {
        calls++;
        return Promise.reject(new Error("Network error"));
      });

      const url = `https://example.test/network-fail-${Date.now()}-${Math.random()}`;
      await expect(
        timedFetch(url, { retries: 1 }),
      ).rejects.toThrow("Network error");
      expect(calls).toBe(1);
    });
  });

  // ── getPlexFriends (prexu-0wq: merges v2 friends + v1 shared users) ──

  describe("getPlexFriends", () => {
    /** Route mockFetch by URL so the order of v2/v1 resolution doesn't matter. */
    function setupFetch(routes: {
      v2?: () => Promise<Response>;
      v1?: () => Promise<Response>;
    }) {
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("/api/v2/friends")) {
          return routes.v2?.() ?? Promise.reject(new Error("v2 not stubbed"));
        }
        if (typeof url === "string" && url.includes("/api/users")) {
          return routes.v1?.() ?? Promise.reject(new Error("v1 not stubbed"));
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });
    }

    it("merges v2 friends + v1 shared users, de-duped by id (v2 wins on collision)", async () => {
      setupFetch({
        v2: () =>
          Promise.resolve(
            jsonResponse([
              { id: 1, username: "alice-v2", email: "a@v2", friendlyName: "Alice V2", thumb: "t1" },
              { id: 2, username: "bob", email: "b@e", friendlyName: "Bob", thumb: "t2" },
            ]),
          ),
        v1: () =>
          Promise.resolve(
            xmlResponse(`<?xml version="1.0"?><MediaContainer>
              <User id="1" username="alice-v1" email="a@v1" friendlyName="Alice V1" thumb="t1v1" status="accepted" home="0" />
              <User id="3" username="carol" email="c@e" friendlyName="Carol" thumb="t3" status="accepted" home="0" />
            </MediaContainer>`),
          ),
      });

      const friends = await getPlexFriends("token");

      // 3 unique users: alice (1), bob (2), carol (3)
      expect(friends).toHaveLength(3);
      const byId = Object.fromEntries(friends.map((f) => [f.id, f]));
      // v2 wins for alice (collision on id=1)
      expect(byId[1].username).toBe("alice-v2");
      expect(byId[1].friendlyName).toBe("Alice V2");
      // bob comes from v2 only
      expect(byId[2].username).toBe("bob");
      // carol comes from v1 only
      expect(byId[3].username).toBe("carol");
    });

    it("returns v1 results when v2 fails", async () => {
      setupFetch({
        v2: () => Promise.reject(new Error("v2 down")),
        v1: () =>
          Promise.resolve(
            xmlResponse(`<?xml version="1.0"?><MediaContainer>
              <User id="3" username="carol" email="c@e" friendlyName="Carol" thumb="t3" status="accepted" home="0" />
            </MediaContainer>`),
          ),
      });

      const friends = await getPlexFriends("token");
      expect(friends).toHaveLength(1);
      expect(friends[0].username).toBe("carol");
    });

    it("returns v2 results when v1 fails", async () => {
      setupFetch({
        v2: () =>
          Promise.resolve(
            jsonResponse([
              { id: 1, username: "alice", email: "a@e", friendlyName: "Alice", thumb: "t1" },
            ]),
          ),
        v1: () => Promise.reject(new Error("v1 down")),
      });

      const friends = await getPlexFriends("token");
      expect(friends).toHaveLength(1);
      expect(friends[0].username).toBe("alice");
    });

    it("throws a combined error when both endpoints fail", async () => {
      setupFetch({
        v2: () => Promise.reject(new Error("v2 down")),
        v1: () => Promise.reject(new Error("v1 down")),
      });

      await expect(getPlexFriends("token")).rejects.toThrow(/v2 down/);
      await expect(getPlexFriends("token")).rejects.toThrow(/v1 down/);
    });

    it("REGRESSION (prexu-0wq): v2 returning 200 with empty array does NOT prevent v1 from contributing", async () => {
      // Pre-fix behavior: v2 200 + empty array → return [] without ever trying v1.
      // Post-fix: v1 results are merged in too.
      setupFetch({
        v2: () => Promise.resolve(jsonResponse([])),
        v1: () =>
          Promise.resolve(
            xmlResponse(`<?xml version="1.0"?><MediaContainer>
              <User id="3" username="carol" email="c@e" friendlyName="Carol" thumb="t3" status="accepted" home="0" />
            </MediaContainer>`),
          ),
      });

      const friends = await getPlexFriends("token");
      expect(friends).toHaveLength(1);
      expect(friends[0].username).toBe("carol");
    });
  });
});
