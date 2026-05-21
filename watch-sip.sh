#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  watch-sip.sh  —  Live SIP call monitor (sngrep) for the SoftPhone VPS.
#
#  Opens sngrep on the server so you SEE every call in real time. Dial a call
#  (inbound or outbound) and watch, message by message, whether it succeeds
#  (100/180/200) or fails (4xx/5xx) — i.e. "is this call possible".
#
#  Shows the decodable SIP on port 5060 (carrier<->Asterisk, Asterisk<->Kamailio).
#  The browser<->Kamailio leg is WSS-encrypted (8443) and is NOT shown — use the
#  browser DevTools console for that side.
#
#  Usage (Git Bash / WSL / macOS / Linux), from the project folder:
#      bash watch-sip.sh
#
#  Override defaults if needed:
#      SOFTPHONE_SSH_KEY=/c/path/softphone1.pem SOFTPHONE_VPS=ubuntu@1.2.3.4 bash watch-sip.sh
# ---------------------------------------------------------------------------
set -euo pipefail
KEY="${SOFTPHONE_SSH_KEY:-/c/Users/Public/.ssh/softphone1.pem}"
# Use the DuckDNS domain (not a hard IP) so an Elastic-IP change won't break this.
TARGET="${SOFTPHONE_VPS:-ubuntu@vocallabs-bhavik.duckdns.org}"

echo "Opening live SIP monitor (sngrep) on ${TARGET} ..."
echo "  Up/Down = pick a call   Enter = see the call flow   Esc = back   q = quit"
echo

# -t : allocate a terminal so sngrep's full-screen UI works over SSH.
ssh -t -i "${KEY}" -o StrictHostKeyChecking=no "${TARGET}" "sudo sngrep -d any 'port 5060'"
