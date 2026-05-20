#!/usr/bin/env bash
# =============================================================================
#  One-shot local setup (run inside Ubuntu/WSL2 from the project root):
#    ./setup.sh             # uses PUBLIC_IP=127.0.0.1 (mirrored networking)
#    ./setup.sh 203.0.113.5 # override PUBLIC_IP (e.g. a VPS public IP)
#
#  It: ensures .env exists, sets PUBLIC_IP, installs mkcert, generates the
#  WSS/HTTPS cert, copies the mkcert root CA to the project root (so you can
#  trust it on Windows), then builds and starts the stack.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

PUBLIC_IP="${1:-127.0.0.1}"

echo "==> 1/5  .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    created .env from .env.example"
fi
sed -i "s/^PUBLIC_IP=.*/PUBLIC_IP=${PUBLIC_IP}/" .env
echo "    PUBLIC_IP=${PUBLIC_IP}"

echo "==> 2/5  mkcert"
if ! command -v mkcert >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y libnss3-tools
  curl -fsSL https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64 -o /tmp/mkcert
  sudo install /tmp/mkcert /usr/local/bin/mkcert
fi
mkcert -install >/dev/null 2>&1 || true

echo "==> 3/5  TLS certificate"
mkdir -p infra/kamailio/certs
mkcert -cert-file infra/kamailio/certs/cert.pem \
       -key-file  infra/kamailio/certs/key.pem \
       softphone.local localhost 127.0.0.1 "${PUBLIC_IP}"
# Copy the root CA next to the project so it can be trusted on Windows.
cp "$(mkcert -CAROOT)/rootCA.pem" ./mkcert-rootCA.pem
echo "    cert written; root CA copied to ./mkcert-rootCA.pem"

echo "==> 4/5  build & start"
docker compose up -d --build

echo "==> 5/5  status"
docker compose ps

cat <<EOF

---------------------------------------------------------------
 Almost there. Two manual steps ON WINDOWS:

 1) Trust the cert: open the project's  mkcert-rootCA.pem  and
    Install Certificate -> Local Machine -> Trusted Root
    Certification Authorities.  (Or, in an admin PowerShell:
       certutil -addstore -f ROOT mkcert-rootCA.pem )

 2) Hosts entry (admin): add to
    C:\\Windows\\System32\\drivers\\etc\\hosts
       127.0.0.1   softphone.local

 Then open  https://softphone.local:5173   (login: agent / agent123)
---------------------------------------------------------------
EOF
