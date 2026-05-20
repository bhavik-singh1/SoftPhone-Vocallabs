import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool(config.db);

// One table: call detail records (CDR) for the call-history view.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id          SERIAL PRIMARY KEY,
  uniqueid    TEXT UNIQUE NOT NULL,
  direction   TEXT NOT NULL DEFAULT 'outbound',
  number      TEXT,
  caller_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'dialing',  -- dialing|ringing|answered|ended|failed
  recording   TEXT,                              -- "<uniqueid>.wav" once recorded
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  duration    INTEGER DEFAULT 0                  -- seconds, talk time
);
`;

export async function initDb() {
  // Retry: Postgres may still be coming up even with healthcheck.
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query(SCHEMA);
      console.log("[db] schema ready");
      return;
    } catch (err) {
      console.warn(`[db] init attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("[db] could not initialize after retries");
}

// Upsert a call row as its state evolves through AMI events.
export async function upsertCall(c) {
  const sql = `
    INSERT INTO calls (uniqueid, direction, number, caller_id, status, recording,
                       started_at, answered_at, ended_at, duration)
    VALUES ($1,$2,$3,$4,$5,$6,
            COALESCE($7, now()), $8, $9, COALESCE($10,0))
    ON CONFLICT (uniqueid) DO UPDATE SET
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
    c.uniqueid, c.direction || "outbound", c.number || null, c.caller_id || null,
    c.status, c.recording || null, c.started_at || null,
    c.answered_at || null, c.ended_at || null, c.duration || 0,
  ];
  const { rows } = await pool.query(sql, vals);
  return rows[0];
}

export async function listCalls(limit = 100) {
  const { rows } = await pool.query(
    "SELECT * FROM calls ORDER BY started_at DESC LIMIT $1",
    [limit]
  );
  return rows;
}

export async function getCall(uniqueid) {
  const { rows } = await pool.query(
    "SELECT * FROM calls WHERE uniqueid = $1",
    [uniqueid]
  );
  return rows[0];
}
