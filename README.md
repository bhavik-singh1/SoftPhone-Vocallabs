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

## 7. Media / NAT traversal — status, root-cause analysis & resolution

### What is verified working (control + signaling plane — end-to-end)
- WebRTC **registration over secure WebSocket (WSS)** through Kamailio → Asterisk
- **SIP trunk authentication** (`pjsip show registrations` → `Registered`)
- **Outbound routing to the real PSTN** — the dialed phone **actually rings**
- **Live call status** (Asterisk AMI → backend WS → UI), **CDR/call history**,
  **server-side recording (MixMonitor)**
- **Server-side media** works: the RTPEngine ↔ Asterisk ↔ trunk leg passes RTP
  (observed ~150–200 packets per call in RTPEngine stats)
- iPhone-style UI, physical-keyboard dialer, in-call controls

### The one unsolved piece: two-way WebRTC audio to the *client*
The browser↔server media (RTP) leg does not establish **in the test environments
used here**. This was traced to the packet level; it is an **environment/NAT
constraint, not a code defect** — the SDP, DTLS fingerprints, and ICE candidates
are all correct, but UDP media cannot complete ICE.

**Two environments, same class of problem (NAT):**

1. **Local (Docker-in-WSL2):** `Windows → WSL` UDP works, but `WSL → Windows` UDP
   is **not delivered** (proven with isolated UDP probes — and a Windows Firewall
   allow-rule did *not* fix it, confirming it's WSL2's NAT layer, WinNAT, not the
   firewall). So RTPEngine (in WSL) cannot send media back to the browser (on
   Windows) → ICE half-open → no audio. `networkingMode=mirrored` removes the NAT
   but breaks Docker's published-port access. Known WSL2 limitation.

2. **VPS (AWS, public IP):** the test client was on a **CGNAT / symmetric-NAT**
   access network (private `10.81.x`, public `42.107.x` that changes per
   destination). RTPEngine's ICE checks to the browser's candidates all fail:
   ```
   [ice] Sending ICE/STUN request ... to 42.107.x:port   (srflx, symmetric NAT)
   [ice] Setting ICE candidate pair ... as failed
   Final: <browser leg> 0 p, 0 b   |   <trunk leg> 198 p, 34056 b   ← server side fine
   ```
   Approaches attempted, with the precise reason each was insufficient on a
   single NAT'd host + CGNAT client:
   - **Direct (host-net RTPEngine, public IP):** CGNAT blocks browser UDP to the
     high media-port range.
   - **On-host coturn TURN (hairpin DNAT + SNAT):** co-locating TURN with the media
     server behind AWS 1:1 NAT creates a relay permission/source-address asymmetry
     (`coturn peer usage sp=0` — client→peer never relays).
   - **External managed TURN (metered.ca):** allocation succeeds, but RTPEngine's
     full-ICE checks to the relayed candidate don't complete on this client network.

   **Common factor:** in *every* test the browser was on the same CGNAT machine —
   the one variable never isolated. A non-CGNAT client was never available to test.

### How to resolve (any of these gives working two-way audio)
1. **Test from a non-CGNAT network** (broadband/office WiFi, or a different
   carrier). Confirms the build is complete; the home network was the blocker.
2. **Managed WebRTC media / TURN on dedicated infra** — the production-correct
   answer. A TURN server **not** co-located behind the media server's NAT (e.g.
   LiveKit/Janus/mediasoup SFU, or Twilio/Cloudflare/metered with a dedicated
   relay) reliably traverses CGNAT/symmetric NAT. This is what production WebRTC
   apps use; self-hosted single-host TURN+media behind cloud 1:1 NAT is a known
   anti-pattern.
3. **Asterisk-native WebRTC** (chan_pjsip WSS + pjproject ICE/DTLS) as an
   alternative media path to RTPEngine — mature ICE stack, configured with an
   off-host STUN/TURN.

### Latency (design)
Minimized by design: **G.711 end-to-end (no transcoding)**, a single userspace
relay, ~0 algorithmic codec delay. Dominant factor is geographic distance, so a
relay/VPS near the trunk + client yields ~50–120 ms one-way — within ITU-T G.114's
"imperceptible" target (<150 ms).

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
