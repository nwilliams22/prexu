# Prexu Remote Access Setup Guide

How to enable all Prexu features (including Watch Together and TMDb actor info) for friends outside your local network.

---

## What Works Without the Relay

These features work remotely out of the box — Plex handles the networking:

- Browsing libraries, search, filtering
- Viewing item details (ratings, chapters, cast list from Plex)
- Video playback (direct play and transcoding)
- Playlists, collections, watch history
- Mark as watched/unwatched
- Content requests

## What Requires the Relay Server

These features need the relay server to be reachable:

- **Watch Together** — synchronized group playback via WebSocket
- **Actor detail pages** — biography, filmography, known-for (TMDb data)
- **Content request search** — searching TMDb for movies/shows to request

---

## Option A: Tailscale (Recommended — Easiest)

Since you already have Tailscale installed, this is the simplest path. No domain, no certs, no port forwarding needed. Traffic is encrypted end-to-end.

### Steps

1. **Ensure Tailscale is running on the relay server**
   ```bash
   tailscale status
   ```
   Note your Tailscale IP (e.g., `100.x.x.x`).

2. **Have each friend install Tailscale**
   - They create a Tailscale account and install the client
   - You share your Tailscale network with them (or they join your tailnet)

3. **Friends set the relay URL in Prexu Settings**
   - Open Prexu > Settings > Relay Server
   - Enter: `ws://100.x.x.x:9847/ws` (your Tailscale IP)

4. **Ensure UFW allows Tailscale traffic** (already done if you have the `wg0` rules)

### Pros
- Zero configuration on router/firewall
- Encrypted end-to-end automatically
- No domain or certs needed
- Friends can also access Plex directly via Tailscale IP

### Cons
- Each friend needs Tailscale installed
- Relies on Tailscale service availability

---

## Option B: Domain + Let's Encrypt + Port Forwarding

The "proper" way — friends connect directly over the internet with TLS encryption.

### Prerequisites
- A domain name (e.g., `relay.yourdomain.com`) — ~$10/year from Namecheap, Cloudflare, etc.
- Ability to set DNS records
- Ability to port forward on your router

### Steps

1. **Get a domain and point it to your public IP**
   ```
   relay.yourdomain.com → A record → your-public-ip
   ```
   If your IP changes, use a dynamic DNS service (e.g., DuckDNS, Cloudflare DDNS).

2. **Port forward 9847 on your router**
   - Forward external port 9847 TCP → internal 192.168.0.62:9847

3. **Install certbot and get Let's Encrypt certs**
   ```bash
   sudo apt install certbot
   sudo certbot certonly --standalone -d relay.yourdomain.com
   ```
   Certs will be at:
   - `/etc/letsencrypt/live/relay.yourdomain.com/fullchain.pem`
   - `/etc/letsencrypt/live/relay.yourdomain.com/privkey.pem`

4. **Update the relay service to use TLS**
   ```bash
   sudo nano /etc/systemd/system/prexu-relay.service
   ```
   Change the ExecStart line:
   ```
   ExecStart=/usr/local/bin/prexu-relay --port 9847 \
     --cert /etc/letsencrypt/live/relay.yourdomain.com/fullchain.pem \
     --key /etc/letsencrypt/live/relay.yourdomain.com/privkey.pem
   ```
   Note: The relay user needs read access to the cert files:
   ```bash
   sudo chmod 755 /etc/letsencrypt/live/
   sudo chmod 755 /etc/letsencrypt/archive/
   ```

5. **Reload and restart**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart prexu-relay
   ```

6. **Set up auto-renewal** (certs expire every 90 days)
   ```bash
   sudo certbot renew --dry-run
   ```
   Certbot installs a systemd timer by default. Add a post-renewal hook to restart the relay:
   ```bash
   sudo nano /etc/letsencrypt/renewal-hooks/post/restart-relay.sh
   ```
   ```bash
   #!/bin/bash
   systemctl restart prexu-relay
   ```
   ```bash
   sudo chmod +x /etc/letsencrypt/renewal-hooks/post/restart-relay.sh
   ```

7. **Friends set the relay URL in Prexu Settings**
   - Enter: `wss://relay.yourdomain.com:9847/ws`

### Pros
- No software needed on friends' machines
- Standard TLS encryption
- Works from anywhere

### Cons
- Requires a domain name
- Requires port forwarding
- Cert renewal management
- Public IP exposure

---

## Option C: Cloudflare Tunnel (No Port Forwarding)

Uses Cloudflare's free tunnel service. No port forwarding, automatic TLS.

### Prerequisites
- A domain name managed by Cloudflare (free plan works)
- Cloudflare account

### Steps

1. **Install cloudflared on the relay server**
   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
   sudo dpkg -i cloudflared.deb
   ```

2. **Authenticate and create a tunnel**
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create prexu-relay
   ```

3. **Configure the tunnel** (`~/.cloudflared/config.yml`)
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: /home/bad-dong/.cloudflared/<tunnel-id>.json

   ingress:
     - hostname: relay.yourdomain.com
       service: http://localhost:9847
     - service: http_status:404
   ```

4. **Add DNS record**
   ```bash
   cloudflared tunnel route dns prexu-relay relay.yourdomain.com
   ```

5. **Run as a service**
   ```bash
   sudo cloudflared service install
   sudo systemctl start cloudflared
   ```

6. **Friends set the relay URL in Prexu Settings**
   - Enter: `wss://relay.yourdomain.com/ws`
   - Note: Cloudflare handles TLS, so use `wss://` with default port 443

### Pros
- No port forwarding needed
- Automatic TLS via Cloudflare
- Hides your public IP
- Free tier is sufficient

### Cons
- Requires a domain on Cloudflare
- Adds latency (traffic routes through Cloudflare)
- WebSocket support requires proper Cloudflare configuration
- Dependent on Cloudflare service

---

## Client-Side Configuration

Regardless of which option you choose, friends need to set the relay URL in Prexu:

1. Open **Settings** (gear icon or sidebar)
2. Find **Relay Server** section
3. Enter the relay URL:
   - Tailscale: `ws://100.x.x.x:9847/ws`
   - Domain with TLS: `wss://relay.yourdomain.com:9847/ws`
   - Cloudflare Tunnel: `wss://relay.yourdomain.com/ws`

If no relay URL is set, the app auto-derives it from the Plex server address, which only works on the local network.

---

## Checklist Before Going Remote

- [ ] Relay server running and accessible from outside the network
- [ ] `TMDB_API_KEY` (v4 read access token) set in relay service environment
- [ ] UFW/firewall allows the relay port from external sources
- [ ] Test with `curl https://relay.yourdomain.com:9847/tmdb/status` from outside
- [ ] Test WebSocket with a Watch Together session from a remote client
- [ ] Distribute the installer to friends (build with `npm run tauri build`)
- [ ] Tell friends to set the relay URL in Settings after first login
