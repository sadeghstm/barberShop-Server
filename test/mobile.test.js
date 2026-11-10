'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMobile } = require('../src/helpers/mobile');

test('قالب‌های مختلف یک شماره به شکل استاندارد درمی‌آیند', () => {
  for (const input of ['09121234567', '9121234567', '+989121234567', '00989121234567', '989121234567', '0912 123 4567', '0912-123-4567']) {
    assert.equal(normalizeMobile(input), '09121234567', input);
  }
});

test('ارقام فارسی و عربی پذیرفته می‌شوند', () => {
  assert.equal(normalizeMobile('۰۹۱۲۱۲۳۴۵۶۷'), '09121234567');
  assert.equal(normalizeMobile('٠٩١٢١٢٣٤٥٦٧'), '09121234567');
});

test('شماره نامعتبر null می‌شود', () => {
  for (const input of ['', null, undefined, '0912123456', '091212345678', '08121234567', 'abc', '02112345678']) {
    assert.equal(normalizeMobile(input), null, String(input));
  }
});
