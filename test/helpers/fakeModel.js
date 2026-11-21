'use strict';

/**
 * یک «مدل مونگوس» ساده در حافظه، فقط برای تست‌های component سرویس‌ها (بدون MongoDB).
 * فقط همان قابلیت‌هایی را دارد که سرویس‌های پروژه استفاده می‌کنند:
 *  - فیلتر: برابری، $in $ne $lt $lte $gt $gte $or
 *  - find / findOne / findById / exists / countDocuments / create / findOneAndUpdate
 *  - زنجیره‌ی select/lean/sort/skip/limit
 *  - ایندکس یکتا (با شرط جزئی) و خطای ۱۱۰۰۰ مثل مونگو
 * مقدارهای پیش‌فرض و ایندکس‌ها را هر تست خودش می‌دهد؛ اعتبارسنجی schema را ندارد (آن در تست‌های unit مدل‌هاست).
 */

const isDate = (x) => x instanceof Date;
const norm = (x) => (isDate(x) ? x.getTime() : x === undefined ? null : x);
const equal = (a, b) => (norm(a) === null && norm(b) === null) || String(norm(a)) === String(norm(b));
const num = (x) => (isDate(x) ? x.getTime() : x);

function matchesCondition(value, cond) {
  const isOperators = cond && typeof cond === 'object' && !isDate(cond) && Object.keys(cond).some((k) => k.startsWith('$'));
  if (!isOperators) return equal(value, cond);

  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$in': return arg.some((a) => equal(value, a));
      case '$ne': return !equal(value, arg);
      case '$lt': return value != null && num(value) < num(arg);
      case '$lte': return value != null && num(value) <= num(arg);
      case '$gt': return value != null && num(value) > num(arg);
      case '$gte': return value != null && num(value) >= num(arg);
      default: throw new Error(`fakeModel: عملگر ${op} پشتیبانی نمی‌شود`);
    }
  });
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((f) => matches(doc, f));
    return matchesCondition(doc[key], cond);
  });
}

function duplicateError(name) {
  const err = new Error(`E11000 duplicate key error collection index: ${name} dup key`);
  err.code = 11000;
  return err;
}

/**
 * unique: [{ name, fields: ['customerId'], when?: (doc) => boolean }]
 * defaults: () => ({ ... }) مقدارهای پیش‌فرض سند تازه
 * onCreate: (doc) => void  مثل hook مدل واقعی، قبل از بررسی یکتایی
 */
function createFakeModel({ unique = [], defaults = () => ({}), onCreate = () => {} } = {}) {
  let rows = [];
  let seq = 0;

  function assertUnique(candidate, ignore) {
    for (const index of unique) {
      if (index.when && !index.when(candidate)) continue;
      const clash = rows.some(
        (r) => r !== ignore && (!index.when || index.when(r)) && index.fields.every((f) => equal(r[f], candidate[f])),
      );
      if (clash) throw duplicateError(index.name);
    }
  }

  function wrap(doc) {
    const hidden = {
      save: async () => {
        assertUnique(doc, doc);
        return doc;
      },
      set: (changes) => Object.assign(doc, changes),
      toObject: () => ({ ...doc }),
      deleteOne: async () => {
        rows = rows.filter((r) => r !== doc);
      },
    };
    for (const [key, fn] of Object.entries(hidden)) Object.defineProperty(doc, key, { value: fn, enumerable: false, configurable: true });
    return doc;
  }

  /** نتیجه‌ی قابل await با زنجیره‌ی select/lean/sort/skip/limit */
  function query(list, { single = false } = {}) {
    let items = list;
    const q = {
      select: () => q,
      lean: () => q,
      sort: (spec) => {
        const [[field, dir]] = Object.entries(spec);
        items = [...items].sort((a, b) => (num(a[field]) > num(b[field]) ? 1 : num(a[field]) < num(b[field]) ? -1 : 0) * dir);
        return q;
      },
      skip: (n) => ((items = items.slice(n)), q),
      limit: (n) => ((items = items.slice(0, n)), q),
      then: (resolve, reject) => Promise.resolve(single ? (items[0] ?? null) : items).then(resolve, reject),
    };
    return q;
  }

  const model = {
    rows: () => rows,
    reset() {
      rows = [];
      seq = 0;
    },
    async create(data) {
      const doc = wrap({ _id: String(++seq).padStart(24, '0'), createdAt: new Date(), ...defaults(), ...data });
      onCreate(doc);
      assertUnique(doc, null);
      rows.push(doc);
      return doc;
    },
    find: (filter = {}) => query(rows.filter((r) => matches(r, filter))),
    findOne: (filter = {}) => query(rows.filter((r) => matches(r, filter)), { single: true }),
    findById: (id) => query(rows.filter((r) => equal(r._id, id)), { single: true }),
    async exists(filter) {
      const found = rows.find((r) => matches(r, filter));
      return found ? { _id: found._id } : null;
    },
    async countDocuments(filter = {}) {
      return rows.filter((r) => matches(r, filter)).length;
    },
    async findOneAndUpdate(filter, update, { new: returnNew = false } = {}) {
      const doc = rows.find((r) => matches(r, filter));
      if (!doc) return null;
      const before = wrap({ ...doc });
      const changes = update.$set ?? update;
      const original = { ...doc };
      Object.assign(doc, changes);
      try {
        assertUnique(doc, doc);
      } catch (err) {
        for (const key of Object.keys(changes)) doc[key] = original[key];
        throw err;
      }
      return returnNew ? doc : before;
    },
  };
  return model;
}

module.exports = { createFakeModel };
