'use strict';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی و عربی را به انگلیسی تبدیل می‌کند. */
function toEnglishDigits(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, (ch) => {
    const i = PERSIAN_DIGITS.indexOf(ch);
    return String(i >= 0 ? i : ARABIC_DIGITS.indexOf(ch));
  });
}

/**
 * شماره موبایل ایران را به شکل استاندارد 09123456789 درمی‌آورد؛ نامعتبر → null.
 * قبول می‌کند: 09123456789، 9123456789، +989123456789، 00989123456789، ارقام فارسی، فاصله و خط تیره.
 */
function normalizeMobile(input) {
  let s = toEnglishDigits(input).replace(/[\s\-()]/g, '');
  if (s.startsWith('+98')) s = s.slice(3);
  else if (s.startsWith('0098')) s = s.slice(4);
  else if (s.startsWith('98') && s.length === 12) s = s.slice(2);
  if (s.length === 10 && s.startsWith('9')) s = `0${s}`;
  return /^09\d{9}$/.test(s) ? s : null;
}

module.exports = { normalizeMobile, toEnglishDigits };
