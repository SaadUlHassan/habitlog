import type { PoolConnection } from "mysql2/promise";

/**
 * Empties every table, children first.
 *
 * TRUNCATE rather than DELETE so AUTO_INCREMENT restarts and ids are predictable.
 * MySQL refuses to truncate a table that another table references, hence the toggle —
 * and it has to run on a single connection, because FOREIGN_KEY_CHECKS is
 * session-scoped and pool.query would spread these statements across connections.
 *
 * Table names are written out rather than looped over a list, so this file contains no
 * SQL string interpolation of any kind.
 */
export async function truncateAllTables(connection: PoolConnection): Promise<void> {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  await connection.query("TRUNCATE TABLE habit_logs");
  await connection.query("TRUNCATE TABLE habits");
  await connection.query("TRUNCATE TABLE users");
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
}
