'use strict';

/**
 * هر check یک تابع (async) است: false یا throw/timeout یعنی down.
 * خروجی: { healthy, checks: { mongo: 'up' | 'down', ... } }
 */
async function runHealthChecks(checks, { timeoutMs = 2000 } = {}) {
  const results = {};

  await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      let timer;
      try {
        const ok = await Promise.race([
          Promise.resolve().then(check),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
          }),
        ]);
        results[name] = ok === false ? 'down' : 'up';
      } catch {
        results[name] = 'down';
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const healthy = Object.values(results).every((status) => status === 'up');
  return { healthy, checks: results };
}

module.exports = { runHealthChecks };
