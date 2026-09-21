# Relay configuration and remote access

Audited 2026-09-20 against `relay-server/src/main.rs`, `server.rs`, and
`src/services/storage/server.ts`. These are application configuration examples;
DNS, firewall, certificates, and service deployment depend on the actual host.

## Features and endpoints

Plex browsing and playback communicate with Plex. Watch Together needs the
relay WebSocket endpoint; TMDb search, actor details, and TMDb-backed request
search use the relay HTTP proxy. Set `TMDB_API_KEY` in the relay environment
for TMDb access; the server sends it as a Bearer token.

| Endpoint | Purpose |
| --- | --- |
| `/ws` | Watch Together WebSocket |
| `/health` | Relay health |
| `/tmdb/status` | Whether the TMDb key is configured |
| `/tmdb/*` | TMDb proxy routes used by the client |

## Start the relay

The binary defaults to `--host 0.0.0.0 --port 8080`. The desktop client's
fallback URL uses port **9847**, so explicitly align the port or configure a
client override. For a local-only development relay matching that fallback:

```bash
cargo run --manifest-path relay-server/Cargo.toml -- --host 127.0.0.1 --port 9847 \
  --public-url ws://localhost:9847/ws
curl http://127.0.0.1:9847/health
curl http://127.0.0.1:9847/tmdb/status
```

For another machine to connect, bind the relay to the intended reachable
interface and allow the chosen port in that host's network policy.

The implemented TLS options are `--tls-cert` and `--tls-key`; both are required
together. The older `--cert` / `--key` examples were invalid.

```bash
prexu-relay --host 0.0.0.0 --port 9847 \
  --public-url wss://relay.example.com:9847/ws \
  --tls-cert /path/to/fullchain.pem \
  --tls-key /path/to/privkey.pem
```

The service account must be able to read its certificate and private key.
The process loads them at startup; restart after replacing them. If a reverse
proxy or tunnel terminates TLS, the relay can listen on a local HTTP address;
the public endpoint must forward WebSocket upgrades and the HTTP routes above.
This guide does not assume a particular proxy provider or an existing firewall.

## Desktop configuration

In Settings, set the Relay Server URL to the address clients can actually reach:

| Deployment | Example |
| --- | --- |
| Local development | `ws://localhost:9847/ws` |
| Existing private network | `ws://relay-private-host:9847/ws` |
| Relay serving TLS directly | `wss://relay.example.com:9847/ws` |
| TLS reverse proxy on port 443 | `wss://relay.example.com/ws` |

URL priority is manual override, then a URL derived from the Plex server URI,
then `ws://localhost:9847/ws`. Auto-derivation uses the Plex host, port 9847,
and `ws://`; it does not discover a public relay or configure TLS. TMDb derives
its HTTP base from this URL (`ws`→`http`, `wss`→`https`, trailing `/ws` removed).

Validate health and TMDb status from the client network, then exercise a real
Watch Together session. A successful HTTP health response alone does not verify
WebSocket forwarding or synchronization.

## Invitation trust and limits

Set `--public-url` to the WebSocket endpoint all recipients should use. It must
be `ws://host[:port]/ws` or `wss://host[:port]/ws`, without credentials, query,
or fragment. For TLS termination at a proxy, advertise the public `wss://`
endpoint even if the relay's own listener uses HTTP. The value is operator
configuration; it is never taken from an invite or a request Host header.

**Deployment change:** without `--public-url`, invitations are disabled and
return a session error. Authentication, session operations and TMDb proxying
remain available. Existing service units must add this argument to enable
invites; the example unit leaves it unset until an operator supplies a real URL.

The relay derives sender identity from Plex authentication and media metadata
from the session, and checks that the sender belongs to that session. Older
clients can still send the legacy invite fields, but those fields are ignored.

Offline invites expire after ten minutes and deduplicate by recipient, session
and sender. Limits are 20 per recipient, 100 per sender, and 10,000 total;
serialized metadata is limited to 8 KiB per invite and targets to 256 bytes.
Quota checking, insertion, delivery removal, and expiry share one locked store.
Idle WebSockets are disconnected after 90 seconds without an inbound frame;
server-generated keepalives do not extend that deadline.

TMDb external-ID lookup accepts only `tt` or `nm` followed by ASCII digits.
Invalid identifiers return HTTP 400 before an upstream request. TMDb routes
still have the existing global request-rate limit and are not authenticated.

These protections implement `prexu-9f4s.4` in the source tree; they take effect
when the updated relay is deployed. Remaining review work includes client
socket churn (`9f4s.3`) and relay connection/session lifecycle (`9f4s.5`).
