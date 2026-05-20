#!/usr/bin/env bash
# =============================================================================
#  VPS deploy — run ON the VPS (Ubuntu), from the repo root, as root:
#     sudo bash deploy-vps.sh <your-domain.duckdns.org>
#
#  Prereqs (do these first):
#   1. The domain must already point to THIS server's public IP (set it in
#      DuckDNS) — Let's Encrypt verifies it over port 80.
#   2. A .env file must exist here with your real TRUNK_* credentials
#      (copy .env.example -> .env and fill the trunk block).
#
#  This script: installs Docker + certbot, issues a real TLS cert, sets
#  PUBLIC_IP/PUBLIC_HOST in .env, opens the OS firewall, and brings the stack
#  up. (You must ALSO open the same ports in your cloud provider's firewall.)
# =============================================================================
set -euo pipefail

DOMAIN="${1:?Usage: sudo bash deploy-vps.sh <your-domain.duckdns.org>}"
PUBIP="$(curl -fsS ifconfig.me || curl -fsS ipinfo.io/ip)"
echo "==> Public IP: ${PUBIP}   Domain: ${DOMAIN}"

if [ ! -f .env ]; then
  echo "ERROR: no .env found. Copy .env.example to .env and fill TRUNK_* first." >&2
  exit 1
fi

echo "==> 1/5  Docker"
command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh

echo "==> 2/5  TLS certificate (Let's Encrypt)"
apt-get update -y
apt-get install -y certbot ufw
# Standalone challenge needs port 80 free (our stack doesn't use it).
certbot certonly --standalone -d "${DOMAIN}" --non-interactive --agree-tos \
  -m "admin@${DOMAIN}" --keep-until-expiring
mkdir -p infra/kamailio/certs
cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" infra/kamailio/certs/cert.pem
cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem"  infra/kamailio/certs/key.pem
echo "    cert installed for ${DOMAIN}"

echo "==> 3/5  .env (PUBLIC_IP + PUBLIC_HOST)"
sed -i "s/^PUBLIC_IP=.*/PUBLIC_IP=${PUBIP}/" .env
sed -i "s/^PUBLIC_HOST=.*/PUBLIC_HOST=${DOMAIN}/" .env
grep -E '^PUBLIC_(IP|HOST)=' .env

echo "==> 4/5  OS firewall (also open these in your cloud security group!)"
ufw allow 22/tcp        # SSH — keep this or you'll lock yourself out
ufw allow 80/tcp        # certbot renewals
ufw allow 5173/tcp      # web app (HTTPS)
ufw allow 8443/tcp      # Kamailio WSS
ufw allow 30000:30050/udp   # RTPEngine media
ufw allow 10000:10050/udp   # Asterisk RTP
ufw allow 3478           # coturn STUN/TURN
ufw allow 49160:49200/udp   # coturn relay
ufw --force enable

echo "==> 5/5  Build & start"
docker compose up -d --build
docker compose ps

cat <<EOF

---------------------------------------------------------------
 Deployed. Open:  https://${DOMAIN}:5173   (login: agent / agent123)

 Verify trunk:
   docker compose exec asterisk asterisk -rx "pjsip show registrations"
 Then dial 600 (echo test) — you should hear your own voice with
 audio flowing both ways (no NAT here).

 REMEMBER: open these ports in the CLOUD provider firewall too:
   5173/tcp 8443/tcp 80/tcp 3478 30000-30050/udp 10000-10050/udp 49160-49200/udp
---------------------------------------------------------------
EOF
