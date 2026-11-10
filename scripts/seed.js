'use strict';

// استفاده:  npm run seed
// کاتالوگ پیش‌فرض خدمات و لیبل‌های نظرسنجی را می‌سازد (idempotent؛ اجرای دوباره داده تکراری نمی‌سازد).
const { connectMongo, disconnectMongo } = require('../src/db/mongo');
const { ensureDefaultCatalog, ensureDefaultSurveyLabels } = require('../src/services/seed');

async function main() {
  await connectMongo();
  const services = await ensureDefaultCatalog();
  const labels = await ensureDefaultSurveyLabels();
  console.log(`کاتالوگ خدمات: ${services} مورد جدید — لیبل‌های نظرسنجی: ${labels} مورد جدید`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
