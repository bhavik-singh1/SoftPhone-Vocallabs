// Central env config. docker-compose passes the whole .env via env_file.
export const config = {
  port: parseInt(process.env.BACKEND_PORT || "3000", 10),
  jwtSecret: process.env.JWT_SECRET || "dev-secret",

  // App users are stored in the `users` table (see db.js seedUsers), seeded
  // from SEED_USERS ("user:pass,..."; defaults to admin:admin123) on first boot.

  // SIP details handed to the browser so SIP.js can register over WSS.
  sip: {
    publicHost: process.env.PUBLIC_HOST || "softphone.local",
    wssPort: 8443,
    user: process.env.SOFTPHONE_USER || "webrtc",
    password: process.env.SOFTPHONE_PASSWORD || "",
  },

  // The two PSTN numbers shown on the dashboard so agents know which number to
  // give out for INBOUND (people call this DID to reach them) and which number
  // their OUTBOUND calls present as the caller ID.
  numbers: {
    inbound: process.env.INBOUND_DID || "",
    outbound: process.env.TRUNK_CALLER_ID || "",
  },

  // ICE servers for the browser (coturn). On a single LAN this is optional.
  turn: {
    publicIp: process.env.PUBLIC_IP || "127.0.0.1",
    secret: process.env.TURN_SECRET || "",
    realm: process.env.TURN_REALM || "softphone.local",
  },

  // External managed TURN (metered.ca). Off-host TURN avoids the same-host
  // NAT-hairpin problem and works on restrictive/CGNAT client networks.
  meteredTurn: {
    host: process.env.METERED_TURN_HOST || "global.relay.metered.ca",
    user: process.env.METERED_TURN_USER || "",
    cred: process.env.METERED_TURN_CRED || "",
  },

  ami: {
    host: process.env.AMI_HOST || "asterisk",
    port: parseInt(process.env.AMI_PORT || "5038", 10),
    user: process.env.AMI_USER || "backend",
    password: process.env.AMI_PASSWORD || "",
  },

  db: {
    host: process.env.POSTGRES_HOST || "db",
    port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
    user: process.env.POSTGRES_USER || "softphone",
    password: process.env.POSTGRES_PASSWORD || "",
    database: process.env.POSTGRES_DB || "softphone",
  },

  recordingsDir: process.env.RECORDINGS_DIR || "/recordings",
};
