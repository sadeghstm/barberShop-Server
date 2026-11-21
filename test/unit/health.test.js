'use strict';

const assert = require('node:assert/strict');
const { runHealthChecks } = require('../../src/helpers/health');

describe('runHealthChecks', () => {
  it('همه up → healthy', async () => {
    const r = await runHealthChecks({ mongo: async () => true, redis: () => true });
    assert.equal(r.healthy, true);
    assert.deepEqual(r.checks, { mongo: 'up', redis: 'up' });
  });

  it('false، throw و timeout هر کدام down حساب می‌شوند', async () => {
    const r = await runHealthChecks(
      {
        a: async () => false,
        b: async () => {
          throw new Error('x');
        },
        c: () => new Promise(() => {}),
        d: async () => true,
      },
      { timeoutMs: 20 },
    );
    assert.equal(r.healthy, false);
    assert.deepEqual(r.checks, { a: 'down', b: 'down', c: 'down', d: 'up' });
  });

  it('بدون check ها healthy است', async () => {
    assert.equal((await runHealthChecks({})).healthy, true);
  });
});
