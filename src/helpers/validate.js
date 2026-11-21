'use strict';

const { AppError } = require('./AppError');
const { DAY_KEY_PATTERN } = require('../constants/time');

// بررسی ورودی کاربر. هر تابع مقدار تمیزشده را برمی‌گرداند یا خطای ۴۲۲ (با نام فیلد) پرتاب می‌کند.
// برای فیلد اختیاری optional: true بدهید؛ اگر مقدار ارسال نشده بود undefined برمی‌گردد.

const OBJECT_ID = /^[a-f\d]{24}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;

function fail(field, message) {
  throw AppError.validation(message, [{ field, message }]);
}

function string(value, field, { min = 1, max = 200, optional = false } = {}) {
  if (value === undefined) {
    if (optional) return undefined;
    fail(field, `${field} الزامی است`);
  }
  if (typeof value !== 'string') fail(field, `${field} باید متن باشد`);
  const text = value.trim();
  if (text.length < min || text.length > max) fail(field, `${field} باید بین ${min} تا ${max} حرف باشد`);
  return text;
}

function boolean(value, field, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'boolean') fail(field, `${field} باید true یا false باشد`);
  return value;
}

/** عدد صحیح در بدنه JSON (رشته مثل "30" پذیرفته نمی‌شود). multipleOf مثلاً ۵ برای دقیقه‌ها. */
function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, multipleOf = 1, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (!Number.isInteger(value)) fail(field, `${field} باید عدد صحیح باشد`);
  if (value < min || value > max) fail(field, `${field} باید بین ${min} تا ${max} باشد`);
  if (value % multipleOf !== 0) fail(field, `${field} باید مضرب ${multipleOf} باشد`);
  return value;
}

function objectId(value, field) {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) fail(field, `${field} نامعتبر است`);
  return value;
}

function slug(value, field) {
  const text = string(value, field, { min: 2, max: 61 }).toLowerCase();
  if (!SLUG.test(text)) fail(field, `${field} فقط می‌تواند حروف کوچک انگلیسی، عدد و خط تیره باشد`);
  return text;
}

/** تاریخ میلادی واقعی به شکل YYYY-MM-DD (روز به وقت تهران). فرانت‌اند تاریخ شمسی را تبدیل می‌کند. */
function dayKey(value, field) {
  const text = string(value, field, { min: 10, max: 10 });
  const date = new Date(`${text}T00:00:00Z`);
  // مثلاً 2027-02-29 به 2027-03-01 تبدیل می‌شود؛ پس باید با ورودی یکی باشد. ماه ۱۳ → Invalid Date
  const valid = DAY_KEY_PATTERN.test(text) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
  if (!valid) fail(field, `${field} باید تاریخ معتبر به شکل YYYY-MM-DD باشد`);
  return text;
}

/** عدد صحیح از query string (مثل page). نامعتبر یا خالی → fallback. */
function integer(value, { fallback, min = 1, max = 1000 }) {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** یکی از مقدارهای مجاز (مثل 'success' | 'failure') */
function oneOf(value, field, allowed, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (!allowed.includes(value)) fail(field, `${field} باید یکی از این‌ها باشد: ${allowed.join('، ')}`);
  return value;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** زمان ISO با منطقه زمانی (مثل 2026-11-10T06:30:00.000Z)؛ Date برمی‌گرداند. بدون منطقه زمانی پذیرفته نمی‌شود. */
function datetime(value, field) {
  if (typeof value !== 'string' || !ISO_DATETIME.test(value)) {
    fail(field, `${field} باید زمان ISO همراه با منطقه زمانی باشد (مثل 2026-11-10T06:30:00Z)`);
  }
  const date = new Date(value);
  // V8 روز ناموجود (مثل 02-30) را به ماه بعد سرریز می‌کند؛ پس خودِ تاریخ را جدا بررسی می‌کنیم
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const real = new Date(Date.UTC(year, month - 1, day));
  const dateIsReal = real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === day;
  if (Number.isNaN(date.getTime()) || !dateIsReal) fail(field, `${field} زمان معتبری نیست`);
  return date;
}

module.exports = { string, boolean, int, objectId, slug, dayKey, integer, oneOf, datetime };
