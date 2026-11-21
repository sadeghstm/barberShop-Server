'use strict';

// اجرای تست‌ها به تفکیک دسته:
//   npm test              همه دسته‌ها به ترتیب unit ← component ← api
//   npm test unit         فقط تست‌های واحد (توابع helpers)
//   npm test component    فقط تست‌های کامپوننت (سرویس/middleware با ردیس و مدل ساختگی)
//   npm test api          فقط تست‌های API (نیاز به مونگو و ردیس تست؛ .env.test.example را ببینید)
// گزینه‌های mocha بعد از -- می‌آیند:  npm test api -- --grep "ورود"
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const KINDS = ['unit', 'component', 'api'];
const root = path.resolve(__dirname, '..');

const argv = process.argv.slice(2).filter((arg) => arg !== '--'); // npm خودش -- را برمی‌دارد، اجرای مستقیم نه
const [first, ...rest] = argv;
const kinds = KINDS.includes(first) ? [first] : KINDS;
const mochaArgs = KINDS.includes(first) ? rest : argv;

if (first && !first.startsWith('-') && !KINDS.includes(first)) {
  console.error(`دسته نامعتبر: ${first}\nدسته‌های مجاز: ${KINDS.join(' | ')}`);
  process.exit(1);
}

const mochaBin = require.resolve('mocha/bin/mocha.js');
let failed = false;

for (const kind of kinds) {
  console.log(`\n===== ${kind} =====`);
  const args = [mochaBin, '--spec', `test/${kind}/**/*.test.js`];
  const setup = path.join('test', 'setup', `${kind}.js`);
  if (fs.existsSync(path.join(root, setup))) args.push('--require', setup);

  const result = spawnSync(process.execPath, [...args, ...mochaArgs], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
