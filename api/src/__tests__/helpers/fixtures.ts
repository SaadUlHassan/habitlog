import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { truncateAllTables } from "../../data/reset.js";
import { pool } from "../../db.js";
import type { Aggregation, HabitKind } from "../../types.js";

// These tests run against the Docker MySQL rather than a fake, because what they are
// checking — that a unique key serialises concurrent writes, that ownership filtering
// happens in the query — is behaviour of the database itself. A stub would only prove
// the stub agrees with me.
//
// They truncate between cases, which means `npm test` clears the development data.
// `npm run db:seed:force` puts it back. Isolating them in their own database would be
// better and is noted in the README.

export type SeededUser = {
  id: number;
  token: string;
};

export type Fixture = {
  alice: SeededUser;
  bob: SeededUser;
  aliceBoolean: number;
  aliceSum: number;
  aliceLast: number;
  bobBoolean: number;
};

async function insertUser(
  connection: PoolConnection,
  email: string,
  displayName: string,
  timezone: string,
): Promise<SeededUser> {
  const [result] = await connection.query<ResultSetHeader>(
    "INSERT INTO users (email, display_name, timezone) VALUES (?, ?, ?)",
    [email, displayName, timezone],
  );
  return { id: result.insertId, token: `Bearer dev-user-${result.insertId}` };
}

async function insertHabit(
  connection: PoolConnection,
  userId: number,
  name: string,
  kind: HabitKind,
  targetValue: number,
  aggregation: Aggregation,
): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO habits (user_id, name, kind, target_value, unit, aggregation)
     VALUES (?, ?, ?, ?, '', ?)`,
    [userId, name, kind, targetValue, aggregation],
  );
  return result.insertId;
}

export async function resetToFixture(): Promise<Fixture> {
  const connection = await pool.getConnection();

  try {
    await truncateAllTables(connection);

    const alice = await insertUser(connection, "alice@example.com", "Alice", "Asia/Singapore");
    const bob = await insertUser(connection, "bob@example.com", "Bob", "America/New_York");

    return {
      alice,
      bob,
      aliceBoolean: await insertHabit(connection, alice.id, "Run", "boolean", 1, "last"),
      aliceSum: await insertHabit(connection, alice.id, "Water", "quantity", 2000, "sum"),
      aliceLast: await insertHabit(connection, alice.id, "Sleep", "quantity", 7, "last"),
      bobBoolean: await insertHabit(connection, bob.id, "Meditate", "boolean", 1, "last"),
    };
  } finally {
    connection.release();
  }
}

export async function countLogs(habitId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM habit_logs WHERE habit_id = ?",
    [habitId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function storedValue(habitId: number): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT value FROM habit_logs WHERE habit_id = ?",
    [habitId],
  );
  const row = rows[0];
  return row === undefined ? null : Number(row.value);
}
