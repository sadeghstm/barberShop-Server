'use strict';

// مدل‌های سبک در حافظه برای تست سرویس‌ها بدون اتصال به MongoDB.
// فقط متدهایی که سرویس‌های پروژه استفاده می‌کنند پیاده‌سازی شده‌اند.

const mongoose = require('mongoose');

const oid = () => new mongoose.Types.ObjectId();

/** مقایسه سازگار با عدد، تاریخ و رشته (dayKey). */
function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date || b instanceof Date) return new Date(a) - new Date(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function makeSingleQuery(doc) {
  const p = Promise.resolve(doc);
  p.sort = () => p;
  p.lean = () => Promise.resolve(doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
  return p;
}

function makeQuery(rows) {
  const p = Promise.resolve(rows);
  p.sort = () => p;
  p.skip = () => p;
  p.limit = () => p;
  p.lean = () => Promise.resolve(rows);
  return p;
}

function matches(doc, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    const value = doc[key];
    if (expected && typeof expected === 'object' && !(expected instanceof mongoose.Types.ObjectId) && !(expected instanceof Date) && !Array.isArray(expected)) {
      if ('$in' in expected) return expected.$in.includes(value);
      if ('$lte' in expected) return value != null && cmp(value, expected.$lte) <= 0;
      if ('$gte' in expected) return value != null && cmp(value, expected.$gte) >= 0;
      if ('$gt' in expected) return value != null && cmp(value, expected.$gt) > 0;
      if ('$lt' in expected) return value != null && cmp(value, expected.$lt) < 0;
      if ('$ne' in expected) return String(value) !== String(expected.$ne);
      if ('$type' in expected) return value != null;
    }
    if (value instanceof mongoose.Types.ObjectId || expected instanceof mongoose.Types.ObjectId) {
      return String(value) === String(expected);
    }
    return value === expected;
  });
}

function applyUpdate(doc, update = {}) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) {
    for (const [key, delta] of Object.entries(update.$inc)) doc[key] = (doc[key] ?? 0) + delta;
  }
}

/** مدل ساختگی با API محدودی که سرویس نوبت استفاده می‌کند. */
function fakeModel({ defaults = {} } = {}) {
  const rows = [];
  const hydrate = (data) => {
    const doc = {
      ...structuredCloneSafe(defaults),
      ...data,
      _id: data._id ?? oid(),
      async save() {
        return this;
      },
      validate() {
        return undefined;
      },
      toObject() {
        return { ...this };
      },
    };
    return doc;
  };
  return {
    rows,
    hydrate,
    async create(data) {
      const doc = hydrate(data);
      rows.push(doc);
      return doc;
    },
    find(query) {
      return makeQuery(rows.filter((doc) => matches(doc, query)));
    },
    findOne(query) {
      return makeSingleQuery(rows.find((doc) => matches(doc, query)) ?? null);
    },
    findById(id) {
      return makeSingleQuery(rows.find((doc) => String(doc._id) === String(id)) ?? null);
    },
    async findOneAndUpdate(filter, update, options = {}) {
      let doc = rows.find((d) => matches(d, filter));
      if (!doc) {
        if (!options.upsert) return null;
        doc = hydrate({ ...filter, ...(update.$set ?? {}) });
        applyUpdate(doc, update);
        rows.push(doc);
        return doc;
      }
      applyUpdate(doc, update);
      return doc;
    },
    async updateOne(filter, update) {
      const doc = rows.find((d) => matches(d, filter));
      if (!doc) return { modifiedCount: 0 };
      applyUpdate(doc, update);
      return { modifiedCount: 1 };
    },
    async countDocuments(query = {}) {
      return rows.filter((doc) => matches(doc, query)).length;
    },
    async updateMany(query, update) {
      let modifiedCount = 0;
      for (const doc of rows) {
        if (matches(doc, query)) {
          applyUpdate(doc, update);
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    },
  };
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}


module.exports = { oid, makeQuery, makeSingleQuery, matches, fakeModel };
