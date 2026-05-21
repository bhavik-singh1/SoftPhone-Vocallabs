import pg from "pg";
import crypto from "crypto";
import { config } from "./config.js";

export const pool = new pg.Pool(config.db);

// Two tables:
//   users  — app accounts (login). Passwords are scrypt-hashed (no plaintext).
//   calls  — call detail records (CDR), each tagged with the app-user who owns
//            it (the dialer for outbound; the connected agent for inbound) so
//            every user sees only their own history.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  pass_hash  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id          SERIAL PRIMARY KEY,
  uniqueid    TEXT UNIQUE NOT NULL,
  owner       TEXT,                              -- users.username this call belongs to
  direction   TEXT NOT NULL DEFAULT 'outbound',
  number      TEXT,
  caller_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'dialing',   -- dialing|ringing|answered|ended|failed|no-answer
  recording   TEXT,                              -- "<uniqueid>.wav" once recorded
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  duration    INTEGER DEFAULT 0                  -- seconds, talk time
);

CREATE INDEX IF NOT EXISTS idx_calls_owner_started
  ON calls (owner, started_at DESC);
`;

// --- password hashing (scrypt; built-in, no extra dependency) ---
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, derived] = stored.split(":");
  const check = crypto.scryptSync(plain, salt, 64).toString("hex");
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(check, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function initDb() {
  // Retry: Postgres may still be coming up even with healthcheck.
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query(SCHEMA);
      await seedUsers();
      console.log("[db] schema ready");
      return;
    } catch (err) {
      console.warn(`[db] init attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("[db] could not initialize after retries");
}

// Seed the default accounts the first time only. Comma-separated pairs in
// SEED_USERS ("user:pass,user2:pass2"); defaults to admin/admin123.
async function seedUsers() {
  const spec = process.env.SEED_USERS || "admin:admin123";
  for (const pair of spec.split(",")) {
    const [username, password] = pair.split(":");
    if (!username || !password) continue;
    await pool.query(
      `INSERT INTO users (username, pass_hash) VALUES ($1, $2)
       ON CONFLICT (username) DO NOTHING`,
      [username.trim(), hashPassword(password.trim())]
    );
  }
}

export async function findUser(username) {
  const { rows } = await pool.query(
    "SELECT username, pass_hash FROM users WHERE username = $1",
    [username]
  );
  return rows[0];
}

// Upsert a call row as its state evolves through AMI events. `owner` is only
// set on the first insert (never overwritten) so a later event can't drop it.
export async function upsertCall(c) {
  const sql = `
    INSERT INTO calls (uniqueid, owner, direction, number, caller_id, status,
                       recording, started_at, answered_at, ended_at, duration)
    VALUES ($1,$2,$3,$4,$5,$6,$7,
            COALESCE($8, now()), $9, $10, COALESCE($11,0))
    ON CONFLICT (uniqueid) DO UPDATE SET
      owner       = COALESCE(calls.owner, EXCLUDED.owner),
      number      = COALESCE(EXCLUDED.number, calls.number),
      caller_id   = COALESCE(EXCLUDED.caller_id, calls.caller_id),
      status      = EXCLUDED.status,
      recording   = COALESCE(EXCLUDED.recording, calls.recording),
      answered_at = COALESCE(EXCLUDED.answered_at, calls.answered_at),
      ended_at    = COALESCE(EXCLUDED.ended_at, calls.ended_at),
      duration    = GREATEST(EXCLUDED.duration, calls.duration)
    RETURNING *;
  `;
  const vals = [
    c.uniqueid, c.owner || null, c.direction || "outbound", c.number || null,
    c.caller_id || null, c.status, c.recording || null, c.started_at || null,
    c.answered_at || null, c.ended_at || null, c.duration || 0,
  ];
  const { rows } = await pool.query(sql, vals);
  return rows[0];
}

// One page of a user's history, plus the total count for pagination.
export async function listCalls(owner, { limit = 15, offset = 0 } = {}) {
  const [{ rows: items }, { rows: count }] = await Promise.all([
    pool.query(
      `SELECT * FROM calls WHERE owner = $1
       ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
      [owner, limit, offset]
    ),
    pool.query("SELECT COUNT(*)::int AS total FROM calls WHERE owner = $1", [owner]),
  ]);
  return { items, total: count[0].total };
}

export async function getCall(uniqueid) {
  const { rows } = await pool.query(
    "SELECT * FROM calls WHERE uniqueid = $1",
    [uniqueid]
  );
  return rows[0];
}
