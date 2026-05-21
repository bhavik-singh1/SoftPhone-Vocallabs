#!/usr/bin/env bash
# Render config templates with ONLY the whitelisted env vars, then start
# Asterisk in the foreground. The whitelist is critical: it leaves dialplan
# variables like ${EXTEN}, ${UNIQUEID}, ${CALLERID(num)} untouched.
set -euo pipefail

VARS='${TRUNK_HOST} ${TRUNK_PORT} ${TRUNK_USERNAME} ${TRUNK_PASSWORD} ${TRUNK_PREFIX} ${TRUNK_CALLER_ID} ${SOFTPHONE_USER} ${SOFTPHONE_PASSWORD} ${AMI_USER} ${AMI_PASSWORD} ${PUBLIC_IP} ${METERED_TURN_USER} ${METERED_TURN_CRED}'

mkdir -p /var/spool/asterisk/recordings

for tpl in /etc/asterisk/templates/*.conf; do
  name="$(basename "$tpl")"
  echo "[entrypoint] rendering $name"
  envsubst "$VARS" < "$tpl" > "/etc/asterisk/$name"
done

echo "[entrypoint] starting Asterisk..."
exec asterisk -f -vvvg
