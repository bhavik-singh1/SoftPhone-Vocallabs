# SoftPhone · Vocallabs

A browser-based **softphone dashboard** that places **real outbound PSTN calls**.
The browser is a true WebRTC SIP endpoint; signaling and media flow through a
**Kamailio + Asterisk** carrier stack out to a SIP trunk.

```
Browser (React + SIP.js)  ──WSS/DTLS-SRTP──►  Kamailio + RTPEngine  ──SIP/RTP──►  Asterisk  ──SIP trunk──►  PSTN
        │  HTTPS /api, /ws (live status)                                              │  AMI events + MixMonitor recording
        └───────────────────────────►  Node/Express backend  ◄────────────────────────┘
                                              │
                                         PostgreSQL (call logs)
```

**Features:** WebRTC in-browser audio · live call status (Asterisk AMI) ·
server-side call recording with playback · in-call mute / DTMF / timer ·
call history · provider-agnostic trunk (one `.env` block).

---

## 1. Prerequisites — Docker via WSL2 (no Docker Desktop)

Docker needs Linux; on Windows that means WSL2. **You do NOT need Docker Desktop.**
The distro + Docker + images total ~6–8 GB, so install them on a drive with
space (e.g. `E:`) rather than a cramped `C:`.

Run in an **elevated PowerShell** on Windows:

```powershell
wsl --install --no-distribution        # WSL2 engine only, then REBOOT
```

After reboot:

```powershell
wsl --update
wsl --install -d Ubuntu --location E:\wsl\ubuntu   # distro + Docker images live on E:
```

> If `--location` errors on an older WSL build, install normally
> (`wsl --install -d Ubuntu`) then move it: `wsl --export`, `wsl --unregister`,
> `wsl --import Ubuntu E:\wsl\ubuntu <exported.tar>`.

Then open **Ubuntu** and install Docker Engine + Node:

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER        # then close & reopen the Ubuntu shell
docker compose version               # verify

# Node 20 (for local dev outside containers, optional)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Clone the repo **inside the WSL filesystem** (faster + correct permissions):

```bash
cd ~ && git clone <your-repo-url> SoftPhone-Vocallabs && cd SoftPhone-Vocallabs
```

> Editing from VS Code: install the **WSL** extension and open the folder with
> `code .` from inside Ubuntu.

---

## 2. Configure

1. **Env:** `cp .env.example .env` and fill it in. The trunk block is already
   set for the provided credentials. **Set `PUBLIC_IP`** to your machine's LAN
   IP (`ip addr` in WSL, or `ipconfig` in Windows → IPv4).

2. **TLS cert** (WebRTC needs HTTPS/WSS) — see
   [infra/kamailio/certs/README.md](infra/kamailio/certs/README.md). In short:

   ```bash
   mkcert -install
   mkcert -cert-file infra/kamailio/certs/cert.pem \
          -key-file  infra/kamailio/certs/key.pem \
          softphone.local localhost 127.0.0.1 <YOUR_LAN_IP>
   ```

3. **Hosts file** — map the domain so the browser resolves it.
   Windows `C:\Windows\System32\drivers\etc\hosts` (edit as Admin):

   ```
   127.0.0.1   softphone.local
   ```

---

## 3. Run

```bash
docker compose up -d --build
docker compose ps          # all 7 services should be healthy/up
```

Open **https://softphone.local:5173** and accept the (locally-trusted) cert.
Log in with the demo account from `.env` (`agent` / `agent123`).

---

## 4. Use it

1. Wait for the status dot to turn green (**Registered**).
2. Type a number on the dialer and press **Call**.
3. Watch the status badge: **dialing → ringing → in call** (driven live by the
   backend via Asterisk AMI).
4. Use **mute**, the **DTMF keypad** (for IVRs), and **hang up**.
5. After the call, it appears in **Call history** with duration and a
   **▶ Recording** button to play back the server-side recording.

---

## 5. Verify (acceptance test)

| # | Check | How |
|---|-------|-----|
| 1 | All services up | `docker compose ps` |
| 2 | Trunk registered | `docker compose exec asterisk asterisk -rx "pjsip show registrations"` → `Registered` |
| 3 | Softphone registered | green dot in UI; `pjsip show contacts` |
| 4 | Outbound rings a real phone | dial your mobile |
| 5 | Two-way audio | talk both ways |
| 6 | Live status updates | badge transitions in UI |
| 7 | Recording + CDR | history row + playable `▶ Recording` |

---

## 6. Debugging

```bash
docker compose logs -f kamailio     # WSS handshake / routing
docker compose logs -f asterisk     # registration, dialplan
docker compose logs -f backend      # AMI events, CDR writes
docker compose exec asterisk asterisk -rvvv   # live Asterisk CLI
#   pjsip set logger on    — trace SIP
#   core show channels     — active calls
```

- **No SIP register from browser:** cert not trusted / wrong `PUBLIC_HOST`,
  or Kamailio WSS not up. Check `kamailio` logs + browser console.
- **Call connects but no audio:** RTPEngine flag tuning in
  [infra/kamailio/kamailio.cfg](infra/kamailio/kamailio.cfg) (`route[RTPENGINE]`
  / `onreply_route`), or the trunk-leg NAT issue below.
- **Trunk rejects the call:** adjust `TRUNK_PREFIX` / `TRUNK_CALLER_ID` in
  `.env` (the only place trunk specifics live).

---

## 7. Known limitations

### Audio does not work when running locally under WSL2 (by design of the env)
Everything else works locally — WebRTC **registration over WSS**, real **trunk
auth**, **outbound call routing** (the PSTN call progresses to ringing), **live
status**, **call records**, and **recording**. Only **two-way audio** is blocked
locally, and the cause is proven from RTPEngine's own ICE logs:

```
[ice] Sending ICE/STUN request ... from 172.18.0.4 to 172.23.64.1:54752   (repeats)
[ice] Setting ICE candidate pair ... as failed
Final: Port 172.18.0.4:30010 <> 172.23.64.1:54752 ... 0 p, 0 b   ← 0 UDP packets
```

The SDP is valid WebRTC (DTLS fingerprint + ICE candidates present), but **no UDP
media packets cross the browser↔container boundary**. This is a **WSL2 limitation**:
its default NAT networking doesn't reliably forward UDP, and `networkingMode=mirrored`
(the documented fix) breaks Docker's localhost port access on this setup. This is an
*environment* constraint, not a defect in the stack.

### The fix: deploy on a VPS (no NAT → audio + low latency just work)
On a public-IP Linux server the media path has no NAT to cross:
1. Provision a small VPS (1 vCPU/1–2 GB is plenty), preferably **in the same region
   as the trunk** (`20.193.182.13` is in India) to keep latency low.
2. Install Docker (`curl -fsSL https://get.docker.com | sh`), copy the project up.
3. In `.env` set `PUBLIC_IP=<server public IP>` and `PUBLIC_HOST=<your domain>`.
4. Replace the mkcert cert with a real **Let's Encrypt** cert for the domain.
5. Open these ports in the cloud firewall/security group:
   `8443/tcp` (WSS), `30000-30050/udp` (RTPEngine media), `3478` + `49160-49200/udp`
   (coturn), and the Asterisk RTP range `10000-10050/udp`.
6. `docker compose up -d --build` → two-way PSTN audio works.

### Latency
Latency is minimized by design: **G.711 end-to-end (no transcoding)**, a single
userspace RTPEngine relay, and ~0 algorithmic codec delay. The dominant factor is
network distance, so a VPS near the trunk yields ~50–120 ms one-way — within the
ITU‑T G.114 "imperceptible" target (<150 ms). The `600` echo test demonstrates the
app adds negligible latency; real-call delay is network, not the code.

### Other
- **Demo auth:** single hardcoded user; the softphone SIP password is sent to
  the browser (inherent to client-side SIP). Use a real user store + short-lived
  SIP credentials for production.

---

## 8. Project structure

```
docker-compose.yml      # 7-service stack
.env / .env.example     # all config + secrets (.env gitignored)
infra/
  asterisk/             # Dockerfile, entrypoint, pjsip/extensions/manager/rtp conf
  kamailio/             # kamailio.cfg (WSS+RTPEngine), tls.cfg, certs/
backend/                # Node: auth, AMI bridge, WS push, CDR/recordings API
frontend/               # React + Vite + SIP.js softphone UI
```
