# مستند API — بک‌اند نوبت‌دهی آرایشگاه

- همه مسیرها JSON هستند. احراز هویت با **کوکی HTTP-only** به نام `token` انجام می‌شود (پس درخواست‌های
  مرورگر باید `credentials: 'include'` داشته باشند).
- خطاها بدنه‌ای به شکل `{ error: { code, message, requestId, details? } }` دارند. `code` انگلیسی و پایدار
  است و `message` فارسی و قابل نمایش.
- هر نوبت در پاسخ به شکل زیر برمی‌گردد (خلاصه‌شده):

```json
{
  "id": "…",
  "status": "confirmed",
  "source": "online",
  "dayKey": "2026-11-12",
  "bookedStart":     { "iso": "2026-11-12T06:30:00.000Z", "dayKey": "2026-11-12", "time": "10:00" },
  "bookedEnd":       { "iso": "2026-11-12T07:00:00.000Z", "dayKey": "2026-11-12", "time": "10:30" },
  "estimatedStart":  { "...": "..." },
  "estimatedEnd":    { "...": "..." },
  "priceSnapshot": 200000,
  "durationSnapshot": 30,
  "depositAmount": 30000,
  "heldUntil": null,
  "noShowHold": false,
  "cancelRequest": null
}
```

`time` ساعت تهران است؛ تبدیل به تاریخ شمسی در کلاینت انجام می‌شود.

---

## سلامت

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/health/ready` | readiness (اتصال مونگو/ردیس) |

## احراز هویت — `/api/auth`

| متد | مسیر | بدنه | توضیح |
|---|---|---|---|
| POST | `/send-otp` | `{ mobile }` | ارسال کد ۵ رقمی (در dev: `12345`) |
| POST | `/verify` | `{ mobile, code }` | ورود/ثبت‌نام + ست‌کردن کوکی `token` |
| POST | `/logout` | — | پاک‌کردن نشست |
| GET | `/me` | — | کاربر جاری (شامل `roles`، `shopId`، `barberId`) |
| PATCH | `/profile` | `{ name }` | ویرایش نام نمایشی |

## آرایشگاه‌ها — `/api/shops`

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/` | عمومی | فهرست فعال؛ `?city=&q=&page=&limit=` (q = جستجوی نام) |
| GET | `/slug/:slug` | عمومی | پروفایل عمومی با slug |
| GET | `/id/:shopId` | واردشده + عضو | جزئیات (پنل) |
| POST | `/` | واردشده | ساخت آرایشگاه؛ سازنده مالک می‌شود. `{ name, slug, city, address, phone, settings? }` |
| PATCH | `/:shopId` | مالک/آرایشگر همان shop/ادمین | `name, city, address, phone, isActive, settings` |
| PUT | `/:shopId/working-hours` | مالک | `{ workingHours: [{ weekday: 0..6, intervals: [{ start: "09:00", end: "18:00" }] }] }` (0=شنبه). اگر با نوبت موجود تداخل کند ۴۰۹ |
| POST | `/:shopId/holidays` | مالک | `{ date: "YYYY-MM-DD", note? }` |
| DELETE | `/:shopId/holidays/:date` | مالک | حذف تعطیلی |
| GET | `/:shopId/barbers` | عمومی | آرایشگران فعال (صفحه رزرو) |
| GET | `/:shopId/booking-board` | عمومی | یک‌جا: اطلاعات shop + آرایشگران + خدمات هرکدام با قیمت/مدت |
| GET | `/:shopId/staff` | عضو | کارکنان شامل غیرفعال‌ها |
| POST | `/:shopId/barbers` | مالک | `{ mobile, displayName? }` — افزودن آرایشگر (کاربر در صورت نبود ساخته می‌شود) |
| DELETE | `/:shopId/barbers/:barberId` | مالک | غیرفعال‌سازی (اگر نوبت آینده داشته باشد ۴۰۹) |
| POST | `/:shopId/walk-ins` | عضو | `{ barberId, serviceId, walkInName?, walkInMobile?, customerId? }` — مشتری حضوری |
| GET | `/:shopId/barbers/:barberId/availability` | عمومی | `?serviceId=&dayKey=YYYY-MM-DD` → `{ dayKey, durationMinutes, price, slots: [{ start, time, dayKey }] }` |
| GET | `/:shopId/barbers/:barberId/services` | عمومی | خدمات فعال آرایشگر (`?all=true` برای همه — پنل) |
| PUT | `/:shopId/barbers/:barberId/services/:serviceId` | عضو (آرایشگر فقط خودش) | `{ price, durationMinutes, isActive }` — مدت مضرب ۵ |
| DELETE | `/:shopId/barbers/:barberId/services/:serviceId` | عضو | غیرفعال‌سازی خدمت |
| POST | `/:shopId/service-requests` | آرایشگر | `{ title, description? }` — درخواست خدمت جدید |
| GET | `/:shopId/survey-stats` | عضو | آمار نظرسنجی آرایشگاه |
| GET | `/:shopId/appointments` | عضو | فهرست نوبت‌ها؛ `?from=&to=` (dayKey تهران)، `status`، `barberId`، `page`، `limit` |

> اگر `settings.showPricesToGuests = false` باشد، `price` در پاسخ‌های عمومی `null` است و فقط برای کاربر
> واردشده برگردانده می‌شود.

## کاتالوگ خدمات — `/api/services`

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/` | عمومی | کاتالوگ (`?q=` جستجو) |
| POST | `/` | ادمین/سوپر ادمین | `{ title, description?, isDefault? }` |
| POST | `/:serviceId/removal` | ادمین | `{ confirm: true }` — درخواست حذف: `active → removing` (نوبت جدید بسته) یا `archived` اگر نوبت آینده نباشد |
| POST | `/:serviceId/archive` | ادمین | `{ confirm: true }` — آرشیو نهایی (بدون نوبت آینده) |
| GET | `/requests` | ادمین | `?status=pending` |
| POST | `/requests/:requestId/decide` | ادمین | `{ approve, rejectReason?, mergeIntoServiceId? }` |

## نوبت‌ها — `/api/appointments`

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| POST | `/hold` | مشتری | `{ shopId, barberId, serviceId, start }` → نوبت `held` با `heldUntil` (۱۰ دقیقه) |
| GET | `/mine` | مشتری | `?status=&page=&limit=` |
| GET | `/:id` | صاحب نوبت / کارکنان shop / ادمین | جزئیات |
| POST | `/:id/pay` | مشتری | `{ useWallet?, idempotencyKey?, simulateFailure? }` → پرداخت mock + `confirmed` (با `simulateFailure: true` پرداخت ناموفق و `expired`) |
| POST | `/:id/cancel` | مشتری | لغو؛ بیش از ۲ ساعت قبل ← بازگشت بیعانه به کیف پول |
| POST | `/:id/cancel-request` | آرایشگر/مالک | ثبت درخواست لغو (نیازمند تصمیم مشتری) |
| POST | `/:id/cancel-request/decide` | مشتری | `{ accept: true|false }` — موافقت ← لغو + بازگشت کامل |
| POST | `/:id/arrived` | کارکنان shop | «حاضر شد» |
| POST | `/:id/start` | کارکنان shop | «شروع خدمت» (اگر حاضر ثبت نشده باشد، هم‌زمان ثبت می‌شود) |
| POST | `/:id/complete` | کارکنان shop | `{ finalPrice, paidInPerson? }` — تکمیل + اعمال پورسانت معرفی |
| POST | `/:id/no-show-hold` | کارکنان shop | `{ hold: true|false }` — جلوگیری/آزادسازی عدم حضور خودکار |
| POST | `/:id/survey` | مشتری | `{ labels: ["clean", ...], comment? }` — فقط برای نوبت `completed` و یک‌بار |

خطاهای مهم این بخش:

- `409 SLOT_TAKEN` (پیام: «این بازه زمانی آزاد نیست») — نوبت هم‌پوشان.
- `409` «شما یک نگه‌داشتن فعال دارید…» — موقت فعال دیگر برای همان مشتری.
- `409` «نگه‌داشتن این نوبت منقضی شده است».
- `409` «گذر از … به … مجاز نیست» — گذر وضعیت نامعتبر.
- `422` «نوبت باید حداقل ۱۵ دقیقه بعد از الان باشد» / «خارج از ساعت کاری».

## آرایشگر — `/api/barbers`

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/:barberId/board?dayKey=` | کارکنان shop / ادمین | تابلوی روز |
| GET | `/:barberId/survey-stats` | عمومی | آمار نظرسنجی آرایشگر |

## نظرسنجی — `/api/surveys`

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/labels` | عمومی | لیبل‌های فعال `{ key, title, order }` |
| PUT | `/labels/:key` | ادمین | `{ title, order?, isActive? }` |

## ادمین — `/api/admin`

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| POST | `/admins` | **سوپر ادمین** | `{ mobile }` — ساخت ادمین (کاربر در صورت نبود ساخته می‌شود) |
| GET | `/settings` | ادمین | تنظیمات سراسری |
| PUT | `/settings` | **سوپر ادمین** | `depositPercent, noShowGraceMinutes, minBookingLeadMinutes, holdMinutes, delayNotifyThresholdMinutes, cancelRefundHoursBefore, referralCommissionPercent` |
| GET | `/payments` | ادمین | `?status=` |
| POST | `/payments/:paymentId/refund` | ادمین | `{ amount, destination: "wallet"|"bank", reason, idempotencyKey? }` |
| GET | `/refunds` | ادمین | فهرست بازگشت‌ها |
| GET | `/users` | ادمین | `?q=` جستجوی موبایل |
| PUT | `/users/:userId/roles` | **سوپر ادمین** | `{ roles: ["admin","customer"] }` |
| PUT | `/users/:userId/active` | ادمین | `{ isActive: true|false }` — غیرفعال‌سازی ورود |
| GET | `/users/:userId/wallet` | ادمین | موجودی + دفتر کل |
| GET | `/audit-logs` | ادمین | `?entityType=&entityId=&action=&actorId=&page=&limit=` |
| GET | `/stats` | ادمین | تعداد کاربران/نوبت‌ها/درآمد بیعانه |
| GET | `/stats/daily` | ادمین | `?from=&to=` — آمار روزانه به تفکیک وضعیت و درآمد خدمات تکمیل‌شده |
| GET | `/shops` | ادمین | `?city=&isActive=&page=&limit=` — همه آرایشگاه‌ها (شامل غیرفعال) |
| POST | `/shops/:shopId/deactivate` | ادمین | `{ reason? }` — با بررسی نوبت‌های آینده |
| POST | `/shops/:shopId/activate` | ادمین | فعال‌سازی دوباره |
| POST | `/shops/:shopId/transfer-ownership` | **سوپر ادمین** | `{ newOwnerUserId }` |
| GET | `/appointments` | ادمین | `?status=&shopId=&barberId=&customerId=&from=&to=&page=&limit=` |
| GET | `/cancel-requests` | ادمین | درخواست‌های لغو در انتظار تصمیم مشتری |
| POST | `/appointments/:id/cancel` | ادمین | `{ reason }` — لغو اجباری (مثلاً وقتی مشتری به درخواست لغو پاسخ نمی‌دهد) + بازگشت کامل بیعانه |
| POST | `/appointments/:id/revert` | ادمین | `{ reason }` — برگشت «تکمیل شده» + خنثی‌سازی پورسانت |
| POST | `/jobs/expire-holds` | ادمین | اجرای دستی پاک‌سازی موقت‌ها |
| POST | `/jobs/no-show` | ادمین | اجرای دستی بررسی عدم حضور |

## من — `/api/me`

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/barber` | پروفایل آرایشگر جاری |
| GET | `/referral` | کد و لینک معرفی، تعداد دعوت‌شده، مجموع پورسانت و تاریخ آن |
| POST | `/referral/apply` | `{ code }` — فقط یک‌بار و فقط قبل از داشتن معرف |
| GET | `/wallet` | موجودی + ۵۰ تراکنش آخر |

---

## نمونه جریان کامل رزرو با curl

```bash
BASE=http://localhost:3000
JAR=cookies.txt

# ورود (در dev کد ثابت 12345)
curl -s -c $JAR -H 'content-type: application/json' -d '{"mobile":"09121234567"}' $BASE/api/auth/send-otp
curl -s -c $JAR -H 'content-type: application/json' -d '{"mobile":"09121234567","code":"12345"}' $BASE/api/auth/verify

# زمان‌های آزاد
curl -s -b $JAR "$BASE/api/shops/$SHOP/barbers/$BARBER/availability?serviceId=$SERVICE&dayKey=2026-11-12"

# نوبت موقت
curl -s -b $JAR -H 'content-type: application/json' \
  -d "{\"shopId\":\"$SHOP\",\"barberId\":\"$BARBER\",\"serviceId\":\"$SERVICE\",\"start\":\"2026-11-12T06:30:00.000Z\"}" \
  $BASE/api/appointments/hold

# پرداخت بیعانه (mock) → confirmed
curl -s -b $JAR -H 'content-type: application/json' -d '{"useWallet":true}' \
  $BASE/api/appointments/$APPOINTMENT/pay
```
