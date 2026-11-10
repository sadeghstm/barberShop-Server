'use strict';

const mongoose = require('mongoose');
const { config } = require('../config');
const { logger } = require('../helpers/logger');

/** اتصال به مونگو. آدرس (که ممکن است رمز داشته باشد) هرگز لاگ نمی‌شود. */
async function connectMongo() {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('mongo reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'mongo error'));

  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  logger.info('mongo connected');
}

async function pingMongo() {
  if (mongoose.connection.readyState !== 1) return false;
  await mongoose.connection.db.command({ ping: 1 });
  return true;
}

async function disconnectMongo() {
  await mongoose.disconnect();
}

module.exports = { connectMongo, pingMongo, disconnectMongo };
