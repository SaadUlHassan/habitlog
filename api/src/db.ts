import mysql from "mysql2/promise";
import { config } from "./config.js";

// The two non-obvious options here are the highest-value lines in the project:
// both of mysql2's defaults would silently undo correctness work done elsewhere.
export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  // mysql2 hydrates DATE into a JS Date at the *Node process* timezone. That would
  // re-parse a calendar date as an instant and reintroduce exactly the off-by-one-day
  // bug that storing local_date exists to prevent. A calendar date is not a moment,
  // so it stays a string all the way to the client.
  dateStrings: ["DATE"],

  // TIMESTAMP round-trips as UTC rather than through whatever TZ the host happens to
  // be set to, so logged_at means the same thing on my laptop and in a container.
  timezone: "Z",

  // DECIMAL arrives as a *string* by default (mysql2 preserves precision). Left alone,
  // `value >= target_value` becomes a lexicographic comparison, and "9.00" >= "10.00"
  // evaluates true — a quantity habit at 9 of 10 would silently count as met.
  decimalNumbers: true,
});

export async function pingDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}
