import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { logger } from "./logger.js";

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "api listening");
});

// Graceful shutdown: stop accepting new connections, let in-flight requests finish,
// then release the pool. Without this a redeploy or `docker compose down` can cut a
// request off mid-write, which for an upsert means an ambiguous outcome.
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  // Backstop: never hang a container forever waiting on a wedged connection.
  setTimeout(() => {
    logger.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000).unref();

  server.close((err) => {
    if (err) logger.error({ err }, "error closing http server");
    pool
      .end()
      .then(() => process.exit(err ? 1 : 0))
      .catch((poolErr: unknown) => {
        logger.error({ err: poolErr }, "error closing db pool");
        process.exit(1);
      });
  });

  // server.close() only stops new connections; idle keep-alive sockets (the Vite
  // proxy holds several) would keep it pending until the force-exit timer fired,
  // turning every shutdown into a 10 second wait.
  server.closeIdleConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
