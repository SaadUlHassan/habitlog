import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db.js";
import type { HabitLog } from "../domain/dashboard.js";
import type { DatedValue } from "../domain/streak.js";
import type { Aggregation, Habit, HabitKind } from "../types.js";

// Every query lives here rather than inline in a route, so "is anything unparameterised
// or unscoped by user" is a question you answer by reading one file. Columns are always
// listed explicitly: `SELECT *` couples the API's response shape to the table's.

function toHabit(row: RowDataPacket): Habit {
  // mysql2 hands back driver-typed values; the enums are narrowed by comparison rather
  // than assertion so an unexpected value cannot slip through as the wrong type.
  const kind: HabitKind = row.kind === "boolean" ? "boolean" : "quantity";
  const aggregation: Aggregation = row.aggregation === "sum" ? "sum" : "last";

  return {
    id: Number(row.id),
    name: String(row.name),
    kind,
    targetValue: Number(row.target_value),
    unit: String(row.unit),
    aggregation,
  };
}

export async function listActiveHabits(userId: number): Promise<Habit[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, kind, target_value, unit, aggregation
       FROM habits
      WHERE user_id = ? AND archived_at IS NULL
      ORDER BY id`,
    [userId],
  );

  return rows.map(toHabit);
}

/**
 * Scoped by user_id, not just habit id. Ownership is part of the lookup rather than a
 * separate check a caller could forget, so "not yours" and "does not exist" are the
 * same query returning nothing — and therefore the same 404.
 */
export async function findHabitForUser(habitId: number, userId: number): Promise<Habit | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, kind, target_value, unit, aggregation
       FROM habits
      WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
    [habitId, userId],
  );

  const row = rows[0];
  return row === undefined ? null : toHabit(row);
}

export async function insertHabit(userId: number, habit: Omit<Habit, "id">): Promise<Habit> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO habits (user_id, name, kind, target_value, unit, aggregation)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, habit.name, habit.kind, habit.targetValue, habit.unit, habit.aggregation],
  );

  return { ...habit, id: result.insertId };
}

/**
 * One query for every habit's logs, filtered by the denormalised user_id.
 *
 * Scoping by user rather than by a list of habit ids means there is no `IN (?)` to
 * expand, no empty-array special case when a user has no habits, and it rides
 * idx_logs_user_date. Logs belonging to archived habits come back too and are dropped
 * during grouping, which is a cheaper trade than a second round trip.
 */
export async function listLogsForUserSince(
  userId: number,
  sinceLocalDate: string,
): Promise<HabitLog[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT habit_id, local_date, value
       FROM habit_logs
      WHERE user_id = ? AND local_date >= ?
      ORDER BY local_date`,
    [userId, sinceLocalDate],
  );

  return rows.map((row) => ({
    habitId: Number(row.habit_id),
    localDate: String(row.local_date),
    value: Number(row.value),
  }));
}

export async function listLogsForHabitSince(
  habitId: number,
  sinceLocalDate: string,
): Promise<DatedValue[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT local_date, value
       FROM habit_logs
      WHERE habit_id = ? AND local_date >= ?
      ORDER BY local_date`,
    [habitId, sinceLocalDate],
  );

  return rows.map((row) => ({
    localDate: String(row.local_date),
    value: Number(row.value),
  }));
}

/**
 * A single atomic statement, not a read-then-write. Two concurrent submissions both
 * reach the database; the unique key on (habit_id, local_date) decides that one
 * inserts and the other takes the update branch, with no window between checking and
 * writing for them to race through.
 *
 * The aggregation rule is bound as a parameter rather than branching into two SQL
 * strings: 'sum' adds the reading to the day's running total, 'last' replaces it.
 *
 * `AS incoming` is the MySQL 8.0.19+ spelling. The older VALUES(col) form still works
 * but has been deprecated since 8.0.20 and warns.
 */
export async function upsertLog(params: {
  habitId: number;
  userId: number;
  value: number;
  localDate: string;
  aggregation: Aggregation;
}): Promise<void> {
  await pool.query(
    `INSERT INTO habit_logs (habit_id, user_id, value, local_date)
     VALUES (?, ?, ?, ?) AS incoming
     ON DUPLICATE KEY UPDATE
       value = IF(?, habit_logs.value + incoming.value, incoming.value),
       logged_at = CURRENT_TIMESTAMP`,
    [
      params.habitId,
      params.userId,
      params.value,
      params.localDate,
      params.aggregation === "sum" ? 1 : 0,
    ],
  );
}
