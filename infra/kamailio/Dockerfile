# Kamailio (Debian bookworm) — built from packages so the exact modules we
# need are guaranteed present: websocket, tls, rtpengine, xhttp, jsonrpcs, etc.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      kamailio \
      kamailio-extra-modules \
      kamailio-tls-modules \
      kamailio-websocket-modules \
      kamailio-utils-modules \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

EXPOSE 5060/udp 8443

# kamailio.cfg, tls.cfg and certs/ are bind-mounted by docker-compose.
# -DD = run in foreground (don't daemonize); -E = log to stderr.
CMD ["kamailio", "-DD", "-E"]
