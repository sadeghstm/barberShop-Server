'use strict';

const { config } = require('./config');
const { logger } = require('./helpers/logger');
const { connectMongo, disconnectMongo } = require('./db/mongo');
const { connectRedis, closeRedis } = require('./db/redis');
const app = require('./app');

async function main() {
  await connectMongo();
  await connectRedis();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'server listening');
  });

  // خاموشی تمیز: اول درخواست‌های در حال انجام تمام می‌شوند، بعد اتصال‌ها بسته می‌شوند
  let shuttingDown = false;
  async function shutdown(reason, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, 'shutting down');

    const forceTimer = setTimeout(() => {
      logger.error('shutdown timed out, forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceTimer.unref();

    try {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections?.();
      });
      await Promise.allSettled([disconnectMongo(), closeRedis()]);
      process.exit(exitCode);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandledRejection');
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException');
    shutdown('uncaughtException', 1);
  });
}

main().catch((err) => {
  // ممکن است لاگر هنوز آماده نباشد (مثلاً env نامعتبر)، پس مستقیم روی کنسول
  console.error(JSON.stringify({ level: 'error', msg: 'startup failed', err: err.message }));
  process.exit(1);
});
