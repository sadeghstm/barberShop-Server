'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/helpers/logger');

function capture(opts = {}) {
  const lines = [];
  const stream = { write: (s) => lines.push(JSON.parse(s)) };
  const logger = createLogger({ stream, now: () => new Date('2026-11-05T20:00:00Z'), ...opts });
  return { logger, lines };
}

test('پیام ساده با level و time', () => {
  const { logger, lines } = capture();
  logger.info('سلام');
  assert.deepEqual(lines[0], { level: 'info', time: '2026-11-05T20:00:00.000Z', msg: 'سلام' });
});

test('سطح پایین‌تر از آستانه نوشته نمی‌شود', () => {
  const { logger, lines } = capture({ level: 'warn' });
  logger.debug('a');
  logger.info('b');
  logger.warn('c');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].msg, 'c');
});

test('silent هیچ‌چیز نمی‌نویسد', () => {
  const { logger, lines } = capture({ level: 'silent' });
  logger.error('x');
  assert.equal(lines.length, 0);
});

test('آبجکت + پیام', () => {
  const { logger, lines } = capture();
  logger.info({ appointmentId: 'a1' }, 'ok');
  assert.equal(lines[0].appointmentId, 'a1');
  assert.equal(lines[0].msg, 'ok');
});

test('Error سریالایز می‌شود (هم مستقیم و هم داخل err)', () => {
  const { logger, lines } = capture();
  logger.error(new Error('boom'), 'm1');
  logger.error({ err: new Error('boom2') }, 'm2');
  assert.equal(lines[0].err.message, 'boom');
  assert.ok(lines[0].err.stack);
  assert.equal(lines[1].err.message, 'boom2');
});

test('child فیلدها را به ارث می‌برد', () => {
  const { logger, lines } = capture({ base: { app: 'x' } });
  logger.child({ module: 'audit' }).info('hi');
  assert.equal(lines[0].app, 'x');
  assert.equal(lines[0].module, 'audit');
});

test('getContext (مثل requestId) به هر خط اضافه می‌شود', () => {
  const { logger, lines } = capture({ getContext: () => ({ requestId: 'r-1' }) });
  logger.info('hi');
  assert.equal(lines[0].requestId, 'r-1');
});

test('payload غیرقابل سریالایز (حلقوی) لاگر را نمی‌شکند', () => {
  const { logger, lines } = capture();
  const loop = {};
  loop.self = loop;
  assert.doesNotThrow(() => logger.info(loop, 'circular'));
  assert.equal(lines[0].logError, 'unserializable log payload');
});
