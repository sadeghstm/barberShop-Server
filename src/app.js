'use strict';

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { config } = require('./config');
const { requestContext } = require('./middlewares/requestContext');
const requestLogger = require('./middlewares/requestLogger');
const attachAudit = require('./middlewares/audit');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const routes = require('./routes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// ترتیب مهم است: requestId ← لاگ ← cors ← کوکی ← body ← audit ← مسیرها ← ۴۰۴ ← خطا
app.use(requestContext);
app.use(requestLogger);
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: config.bodyLimit }));
app.use(attachAudit);

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
