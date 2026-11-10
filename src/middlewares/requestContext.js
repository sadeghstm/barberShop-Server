'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const storage = new AsyncLocalStorage();

// شناسه ورودی از بیرون فقط وقتی پذیرفته می‌شود که شکل امن و معقولی داشته باشد (جلوگیری از تزریق در لاگ)
const ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/** برای هر درخواست یک requestId می‌سازد و در کل زنجیره async در دسترس می‌گذارد. */
function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  const requestId = incoming && ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  storage.run({ requestId }, next);
}

/** فیلدهایی که لاگر به هر خط اضافه می‌کند. بیرون از درخواست: {} */
function getContext() {
  const store = storage.getStore();
  return store ? { requestId: store.requestId } : {};
}

module.exports = { requestContext, getContext };
