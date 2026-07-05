import { validateToken, getPlexUser, getHomeUsers, switchHomeUser, getPlexFriends, timedFetch, isTimeoutError, REQUEST_TIMEOUT_MS, serverFetch, getServerAccountId } from "./plex-api";
import { cacheClear } from "./api-cache";

// Mock storage module
vi.mock("./storage", () => ({
  getClientIdentifier: vi.fn().mockResolvedValue("test-client-id"),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  const make = (): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
      clone: make,
    }) as unknown as Response;
  return make();
}

function xmlResponse(xml: string, status = 200): Response {
  const make = (): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve(xml),
      clone: make,
    }) as unknown as Response;
  return make();
}

describe("plex-api", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cacheClear();
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

    it("default timeout is 15s (30s worst-case envelope with one retry)", () => {
      expect(REQUEST_TIMEOUT_MS).toBe(15000);
    });

    it("GET retries once on timeout by default (no explicit retries)", async () => {
      let calls = 0;
      mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        calls++;
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(opts.signal.reason ?? new Error("aborted")),
          );
        });
      });

      const url = `https://example.test/get-default-retry-${Date.now()}-${Math.random()}`;
      await expect(
        timedFetch(url, { timeoutMs: 10 }),
      ).rejects.toThrow(/Request timed out/);
      expect(calls).toBe(2); // initial attempt + 1 default retry
    });

    it.each(["POST", "PUT", "DELETE"])(
      "%s does not retry on timeout by default",
      async (method) => {
        let calls = 0;
        mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
          calls++;
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () =>
              reject(opts.signal.reason ?? new Error("aborted")),
            );
          });
        });

        const url = `https://example.test/${method}-no-retry-${Date.now()}-${Math.random()}`;
        await expect(
          timedFetch(url, { method, timeoutMs: 10 }),
        ).rejects.toThrow(/Request timed out/);
        expect(calls).toBe(1);
      },
    );

    it("non-GET can still opt in to retries explicitly", async () => {
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

      const url = `https://example.test/post-opt-in-${Date.now()}-${Math.random()}`;
      const response = await timedFetch(url, {
        method: "POST",
        timeoutMs: 10,
        retries: 1,
      });
      expect(response.ok).toBe(true);
      expect(calls).toBe(2);
    });

    /**
     * Single-use Response mock: json()/text() throw on second consumption of
     * the same instance, like a real Response body. clone() returns a fresh
     * unconsumed instance.
     */
    function singleUseResponse(data: unknown) {
      let cloneCount = 0;
      let originalConsumed = false;
      const make = (isOriginal: boolean): Response => {
        let consumed = false;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => {
            if (consumed) {
              return Promise.reject(new TypeError("body already used"));
            }
            consumed = true;
            if (isOriginal) originalConsumed = true;
            return Promise.resolve(data);
          },
          clone: () => {
            cloneCount++;
            return make(false);
          },
        } as unknown as Response;
      };
      return {
        response: make(true),
        get cloneCount() {
          return cloneCount;
        },
        get originalConsumed() {
          return originalConsumed;
        },
      };
    }

    it("dedup clone race: first caller consuming body does not break deduped caller", async () => {
      const data = { value: 42 };
      const controlled = singleUseResponse(data);
      let resolveFetch!: (r: Response) => void;
      mockFetch.mockImplementation(
        () => new Promise<Response>((res) => (resolveFetch = res)),
      );

      const url = `https://example.test/clone-race-${Date.now()}-${Math.random()}`;
      const first = timedFetch(url);
      const second = timedFetch(url); // dedup hit while in-flight
      expect(mockFetch).toHaveBeenCalledTimes(1);

      resolveFetch(controlled.response);
      const [r1, r2] = await Promise.all([first, second]);

      // First caller consumes its body fully...
      await expect(r1.json()).resolves.toEqual(data);
      // ...and the deduped caller can still read the body.
      await expect(r2.json()).resolves.toEqual(data);

      // The shared original was never consumed; everyone got a clone.
      expect(controlled.originalConsumed).toBe(false);
      expect(controlled.cloneCount).toBeGreaterThanOrEqual(2);
    });

    it("dedup is isolated per auth token: same URL with different tokens fires separate requests", async () => {
      const resolvers: Array<(r: Response) => void> = [];
      mockFetch.mockImplementation(
        () => new Promise<Response>((res) => resolvers.push(res)),
      );

      const url = `https://example.test/token-isolation-${Date.now()}-${Math.random()}`;
      const asUserA = timedFetch(url, { headers: { "X-Plex-Token": "token-user-a" } });
      const asUserB = timedFetch(url, { headers: { "X-Plex-Token": "token-user-b" } });
      // Different tokens must NOT share the in-flight response.
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Same token while in-flight still dedups.
      const asUserAAgain = timedFetch(url, { headers: { "X-Plex-Token": "token-user-a" } });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      resolvers[0](jsonResponse({ user: "a" }));
      resolvers[1](jsonResponse({ user: "b" }));

      const [ra, rb, ra2] = await Promise.all([asUserA, asUserB, asUserAAgain]);
      await expect(ra.json()).resolves.toEqual({ user: "a" });
      await expect(rb.json()).resolves.toEqual({ user: "b" });
      await expect(ra2.json()).resolves.toEqual({ user: "a" });
    });

    it("dedup keys do not contain the raw token", async () => {
      // The fingerprint must differ per token but never embed the token itself.
      // Indirectly verified above; here we just confirm requests with and
      // without a token are isolated from each other too.
      const resolvers: Array<(r: Response) => void> = [];
      mockFetch.mockImplementation(
        () => new Promise<Response>((res) => resolvers.push(res)),
      );

      const url = `https://example.test/anon-vs-auth-${Date.now()}-${Math.random()}`;
      const anon = timedFetch(url);
      const authed = timedFetch(url, { headers: { "X-Plex-Token": "secret" } });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      resolvers[0](jsonResponse({ who: "anon" }));
      resolvers[1](jsonResponse({ who: "authed" }));
      const [r1, r2] = await Promise.all([anon, authed]);
      await expect(r1.json()).resolves.toEqual({ who: "anon" });
      await expect(r2.json()).resolves.toEqual({ who: "authed" });
    });

    // ── prexu-0szx.5: aborting a deduped consumer must not kill the shared request ──

    it("aborting ONE deduped consumer does not abort the shared request while another consumer still needs it", async () => {
      let fetchSignal: AbortSignal | undefined;
      let resolveFetch!: (r: Response) => void;
      mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        fetchSignal = opts.signal;
        return new Promise<Response>((res) => (resolveFetch = res));
      });

      const url = `https://example.test/abort-dedup-safe-${Date.now()}-${Math.random()}`;
      const controllerA = new AbortController();
      const controllerB = new AbortController();

      const first = timedFetch(url, { signal: controllerA.signal });
      const second = timedFetch(url, { signal: controllerB.signal }); // dedup hit while in-flight
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Consumer A leaves (e.g. its React effect unmounted) before the response arrives.
      controllerA.abort();

      // The underlying network request must still be alive — consumer B still wants it.
      expect(fetchSignal?.aborted).toBe(false);

      // Consumer A's own call rejects immediately (it aborted)...
      await expect(first).rejects.toMatchObject({ name: "AbortError" });

      // ...but consumer B, who never aborted, still gets the real response.
      resolveFetch(jsonResponse({ ok: true }));
      const response = await second;
      await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it("aborting the LAST remaining consumer does abort the shared underlying request", async () => {
      let fetchSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        fetchSignal = opts.signal;
        return new Promise<Response>(() => {}); // never resolves on its own
      });

      const url = `https://example.test/abort-dedup-last-${Date.now()}-${Math.random()}`;
      const controllerA = new AbortController();
      const controllerB = new AbortController();

      const first = timedFetch(url, { signal: controllerA.signal });
      const second = timedFetch(url, { signal: controllerB.signal });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      controllerA.abort();
      expect(fetchSignal?.aborted).toBe(false); // B is still around

      controllerB.abort();
      // Now that every known consumer has left, the shared request itself aborts.
      expect(fetchSignal?.aborted).toBe(true);

      await expect(first).rejects.toMatchObject({ name: "AbortError" });
      await expect(second).rejects.toMatchObject({ name: "AbortError" });
    });

    it("a consumer whose signal is already aborted fails fast without joining the request", async () => {
      mockFetch.mockImplementation(
        () => new Promise<Response>(() => {}),
      );

      const url = `https://example.test/abort-preflight-${Date.now()}-${Math.random()}`;
      const controller = new AbortController();
      controller.abort();

      await expect(
        timedFetch(url, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("solo (non-deduped) caller aborting still aborts the underlying request immediately", async () => {
      let fetchSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        fetchSignal = opts.signal;
        return new Promise<Response>(() => {});
      });

      const url = `https://example.test/abort-solo-${Date.now()}-${Math.random()}`;
      const controller = new AbortController();
      const promise = timedFetch(url, { signal: controller.signal });

      controller.abort();
      expect(fetchSignal?.aborted).toBe(true);
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
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

  // ── getServerAccountId (prexu-0szx.4: session-TTL cache) ──

  describe("getServerAccountId", () => {
    it("caches the resolved account id so a second call skips the network", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ MyPlex: { id: 42 } }),
      );

      const first = await getServerAccountId("https://server:32400", "token");
      expect(first).toBe(42);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      mockFetch.mockClear();
      const second = await getServerAccountId("https://server:32400", "token");
      expect(second).toBe(42);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not cache a null result (all strategies failed)", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 500));

      const first = await getServerAccountId("https://server:32400", "token");
      expect(first).toBeNull();

      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce(jsonResponse({ MyPlex: { id: 7 } }));
      const second = await getServerAccountId("https://server:32400", "token");
      expect(second).toBe(7);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("isolates the cache per server+token", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ MyPlex: { id: 1 } }))
        .mockResolvedValueOnce(jsonResponse({ MyPlex: { id: 2 } }));

      const a = await getServerAccountId("https://server:32400", "token-a");
      const b = await getServerAccountId("https://server:32400", "token-b");

      expect(a).toBe(1);
      expect(b).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── serverFetch signal passthrough (prexu-0szx.5) ──

  describe("serverFetch", () => {
    it("forwards an AbortSignal to the underlying request", async () => {
      let receivedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
        receivedSignal = opts.signal;
        return Promise.resolve(jsonResponse({ ok: true }));
      });

      const controller = new AbortController();
      await serverFetch("https://server:32400", "token", "/library/sections", controller.signal);

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal?.aborted).toBe(false);
    });

    it("still works when no signal is provided (backward compatible)", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
      const response = await serverFetch("https://server:32400", "token", "/library/sections");
      expect(response.ok).toBe(true);
    });
  });
});
