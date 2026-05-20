# Asterisk 18 (Ubuntu 22.04) — PBX, PSTN trunk, recording, AMI.
# (Debian bookworm dropped the asterisk package, so we use Ubuntu's, which
# ships chan_pjsip, app_mixmonitor, format_wav, AMI, etc.)
# WebRTC/DTLS is terminated upstream by Kamailio+RTPEngine, so Asterisk only
# needs plain chan_pjsip + G.711 (ulaw/alaw) — no Opus build required.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      asterisk asterisk-modules \
      gettext-base ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Recordings live on a shared volume so the backend can serve them.
RUN mkdir -p /var/spool/asterisk/recordings

EXPOSE 5060/udp 5038 10000-10050/udp

# entrypoint.sh is bind-mounted at /entrypoint.sh by docker-compose.
ENTRYPOINT ["bash", "/entrypoint.sh"]
