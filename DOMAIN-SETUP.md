# Pointing SoftPad at `softpad.tech` (Cloudflare DNS + Let's Encrypt)

This guide moves the app from `vocallabs-bhavik.duckdns.org` to your own domain
**`softpad.tech`**, with DNS managed in **Cloudflare**.

A built-in **Caddy** reverse proxy serves the whole app at a clean
**`https://softpad.tech`** (no `:5173` / `:8443` in the URL). Caddy gets its own
Let's Encrypt cert automatically; you only run certbot for Kamailio's direct
`:8443` fallback path.

You will:

1. Point `softpad.tech` at the VPS in Cloudflare (**DNS only** — proxy OFF).
2. Re-issue the Kamailio TLS cert for `softpad.tech` with Let's Encrypt.
3. Update `.env` and restart the stack (Caddy auto-issues the `:443` cert).
4. Verify register + a test call at `https://softpad.tech`.

> **Why proxy must be OFF (grey cloud):** Cloudflare's proxy (orange cloud) only
> carries standard HTTP/HTTPS — it cannot pass SoftPad's real-time **RTP/UDP
> media** (or the SIP WebSocket reliably). Our own Caddy already provides clean
> TLS on `:443`, so Cloudflare just needs to resolve the name to the VPS. Every
> record below is **DNS only**.

---

## 0. What you need

- The VPS public IP. Current Elastic IP: **`13.200.147.29`** (confirm it hasn't
  changed: `curl -s ifconfig.me` on the VPS).
- `softpad.tech` added as a zone in Cloudflare (nameservers already pointing to
  Cloudflare — Cloudflare shows "Active" for the zone).
- SSH access to the VPS.

---

## 1. Cloudflare DNS records (proxy OFF)

In the Cloudflare dashboard → **softpad.tech** → **DNS** → **Records**, create:

| Type | Name             | Content (value)   | Proxy status      | TTL  |
|------|------------------|-------------------|-------------------|------|
| A    | `softpad.tech`   | `13.200.147.29`   | **DNS only** (grey) | Auto |
| A    | `www` (optional) | `13.200.147.29`   | **DNS only** (grey) | Auto |

- "Name = `softpad.tech`" (or `@`) is the **root/apex** record — that's the
  hostname the app uses.
- Click the **orange cloud** so it turns **grey** ("DNS only"). This is the most
  important step — leave it orange and WSS/media will silently fail.

### SSL/TLS mode (avoid the redirect loop)

Cloudflare → **SSL/TLS** → **Overview**: since traffic isn't proxied this mostly
doesn't apply, but if you ever enable proxying later, set it to **Full
(strict)**. For now (DNS only) you can leave defaults; do **not** enable
"Always Use HTTPS" at the zone level in a way that rewrites the `:5173` / `:8443`
ports.

### Verify DNS resolves to the VPS

From your laptop:

```bash
nslookup softpad.tech
# or
dig +short softpad.tech
```

You must see **`13.200.147.29`** (the VPS IP), not a Cloudflare `104.x`/`172.x`
address. If you see a Cloudflare IP, the proxy is still ON — turn it grey and
wait a minute. **Do not continue until this returns the VPS IP** — Let's Encrypt
will fail otherwise.

---

## 2. Cloud firewall / Security Group

The OS firewall (ufw) is left disabled; the **cloud Security Group is the real
firewall**. In AWS EC2 → the instance's Security Group → **Inbound rules**,
make sure these are open to `0.0.0.0/0`:

| Port / range          | Proto | Purpose                                       |
|-----------------------|-------|-----------------------------------------------|
| `443`                 | TCP   | Clean `https://softpad.tech` (Caddy) + its cert |
| `80`                  | TCP   | certbot HTTP-01 challenge (Kamailio :8443 cert) |
| `5173`                | TCP   | Dashboard direct (transition fallback)        |
| `8443`                | TCP   | SIP over WSS direct (transition fallback)     |
| `3478`                | TCP+UDP | coturn STUN/TURN                            |
| `10000-10050`         | UDP   | Asterisk RTP media                            |
| `49160-49200`         | UDP   | coturn relay range                            |

(`80` only needs to be open during cert issuance/renewal; leaving it open is
fine. `5173`/`8443` are the pre-Caddy direct ports — keep them open during the
switch, close them later once `:443` is confirmed working.)

---

## 3. Issue the cert + switch the domain (on the VPS)

SSH in and go to the repo:

```bash
ssh ubuntu@softpad.tech            # works once DNS from step 1 resolves
# (or ssh ubuntu@13.200.147.29 if DNS hasn't propagated yet)
cd ~/SoftPhone-Vocallabs
git pull
```

The deploy script is already domain-parameterized. Run it with the new domain —
it re-issues the Let's Encrypt cert for `softpad.tech`, rewrites `PUBLIC_HOST`
in `.env`, fixes the EC2 NAT hairpin, and restarts the stack:

```bash
sudo bash deploy-vps.sh softpad.tech
```

> If you'd rather do it by hand instead of the script, the only domain-specific
> steps are:
> ```bash
> # a) cert
> sudo certbot certonly --standalone -d softpad.tech \
>   --non-interactive --agree-tos -m admin@softpad.tech --keep-until-expiring
> sudo cp /etc/letsencrypt/live/softpad.tech/fullchain.pem infra/kamailio/certs/cert.pem
> sudo cp /etc/letsencrypt/live/softpad.tech/privkey.pem  infra/kamailio/certs/key.pem
>
> # b) point the app at the new host
> sed -i 's/^PUBLIC_HOST=.*/PUBLIC_HOST=softpad.tech/' .env
>
> # c) restart the pieces that bake PUBLIC_HOST/cert at boot
> sudo docker compose up -d --force-recreate kamailio asterisk coturn frontend backend
> ```

`PUBLIC_HOST` is the single source of truth — the backend hands
`wss://softpad.tech:8443` to the browser via `/api/sip-config`, and Kamailio
serves WSS using the cert in `infra/kamailio/certs/`.

---

## 4. Verify

1. **Cert is for the new domain:**
   ```bash
   echo | openssl s_client -connect softpad.tech:8443 -servername softpad.tech 2>/dev/null \
     | openssl x509 -noout -subject -dates
   ```
   Subject should be `CN = softpad.tech` and not expired.

2. **Open the app:** <https://softpad.tech> — log in (`admin` / `admin123`).
   The status pill should go to **Registered** within a few seconds. (The direct
   `https://softpad.tech:5173` also still works as a fallback.)

3. **Trunk still registered:**
   ```bash
   sudo docker compose exec asterisk asterisk -rx "pjsip show registrations"
   ```

4. **Place a test call** from the dialer; **receive one** on your inbound DID.
   Two-way audio confirms WSS + media are flowing over the new domain.

---

## 5. Cert auto-renewal

`certbot` installs a renewal timer, but the renewed cert lands in
`/etc/letsencrypt/live/...` — it must be copied into `infra/kamailio/certs/` and
Kamailio restarted for WSS to pick it up. Add a renewal hook once:

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/softpad.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
cp /etc/letsencrypt/live/softpad.tech/fullchain.pem /home/ubuntu/SoftPhone-Vocallabs/infra/kamailio/certs/cert.pem
cp /etc/letsencrypt/live/softpad.tech/privkey.pem  /home/ubuntu/SoftPhone-Vocallabs/infra/kamailio/certs/key.pem
cd /home/ubuntu/SoftPhone-Vocallabs && docker compose restart kamailio
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/softpad.sh
```

Test it: `sudo certbot renew --dry-run`.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `dig softpad.tech` returns a `104.x`/`172.x` IP | Cloudflare proxy still ON — set the A record to **DNS only** (grey cloud). |
| Cert issuance fails with "challenge failed" | DNS not propagated yet, or port **80** blocked in the Security Group, or proxy ON. Confirm `dig +short softpad.tech` = VPS IP, then retry. |
| Dashboard loads but stuck on "Connecting…" | Browser can't reach WSS. Check `8443/tcp` open in the Security Group and the cert CN matches `softpad.tech`. Open DevTools → Console for the WSS error. |
| Cert warning / `ERR_CERT_AUTHORITY_INVALID` | Old DuckDNS cert still in `infra/kamailio/certs/`. Re-run step 3. |
| "server error" on calls right after the switch | The EC2 NAT hairpin rule may reference the old IP. The deploy script re-adds it; if the public IP changed, see the IP-change steps in the README. |

---

## Notes

- **Clean URL via Caddy.** The bundled Caddy service serves everything at
  `https://softpad.tech` (`:443`): the dashboard, `/api`, `/ws`, and the SIP
  WebSocket at `/ws-sip` (proxied to Kamailio's internal plain-WS). The backend
  hands the browser `wss://softpad.tech/ws-sip` by default. The pre-Caddy direct
  ports `:5173` (dashboard) and `:8443` (WSS) remain open as a fallback — to use
  the direct WSS path instead, set `WS_SERVER=wss://softpad.tech:8443` in `.env`.
  Once `:443` is confirmed working you can close `5173`/`8443` in the Security
  Group.
- **Keep `.env` private.** `PUBLIC_HOST=softpad.tech` is fine to commit in
  `.env.example`, but the real `.env` (with trunk passwords) stays gitignored.
