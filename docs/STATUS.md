# چک‌لیست پیاده‌سازی بک‌اند در برابر سند طراحی

این فایل هر بند از سند طراحی را به کد و تست متناظر وصل می‌کند. علامت ✅ یعنی پیاده و تست‌شده،
◻️ یعنی طبق خود سند عمداً به نسخه بعد موکول شده است (فهرست کامل در [BACKLOG](BACKLOG.md)).

## فاز ۱ — هسته

| بند سند | وضعیت | محل پیاده‌سازی | تست |
|---|---|---|---|
| اسکلت Express، اتصال مونگو/ردیس، مدیریت خطا، لاگ، middleware audit | ✅ | `src/app.js`، `src/middlewares/*`، `src/server.js` | `app.smoke.test.js`، `errorHandler.test.js`، `logger.test.js` |
| مدل داده و ایندکس‌ها | ✅ | `src/models/*` | `models.test.js` |
| احراز هویت OTP (کد ثابت در توسعه)، نقش‌ها، محدودسازی آرایشگاه | ✅ | `services/otp.js`، `middlewares/auth.js`، `helpers/roles.js` | `auth.test.js`، `roles.test.js` |
| آرایشگاه، آرایشگر و مالک، ساعت کاری، تعطیلی | ✅ | `services/shop.js`، `services/barber.js` | `shop-rules.test.js` |
| کاتالوگ خدمات (ادمین) + قیمت/مدت هر آرایشگر + نمایش قیمت در API | ✅ | `services/catalog.js`، `helpers/serialize.js` | `serialize.test.js`، `appointment-flow.test.js` |
| تابع محاسبه زمان آزاد (خالص، با تست) | ✅ | `services/availability.js` | `availability.test.js` |
| رزرو: قفل ردیس، بررسی هم‌پوشانی، وضعیت موقت، پرداخت شبیه‌سازی‌شده، تایید خودکار، پاکسازی منقضی‌ها | ✅ | `services/appointment.js`، `services/lock.js`، `services/scheduler.js` | `lock.test.js`، `appointment-flow.test.js` (شامل هم‌زمانی) |
| موارد مسدودسازی: تغییر ساعت کاری، تعطیلی، غیرفعال‌سازی آرایشگر/خدمت/آرایشگاه | ✅ | `services/shop.js`، `services/barber.js`، `services/catalog.js` | `shop-rules.test.js`، `appointment-flow.test.js` |
| ماشین وضعیت، حاضر شد/شروع/پایان، مشتری حضوری، عدم حضور خودکار | ✅ | `services/appointment.js` | `settings.test.js`، `appointment-flow.test.js` |
| محاسبه مجدد زمان پیش‌بینی‌شده + پیامک تاخیر + هشدار عبور از ساعت کاری | ✅ | `services/appointment.js` | `appointment-flow.test.js` |
| رابط Vue | ◻️ | پروژه جداگانه (خارج از این مخزن) | — |
| تست‌های هسته (هم‌زمانی و هم‌پوشانی) | ✅ | `test/*` | ۱۶۴ تست |

## فاز ۲ — قابلیت‌های توافق‌شده و مدیریت

| بند سند | وضعیت | محل | تست |
|---|---|---|---|
| درخواست خدمت جدید + تایید/رد ادمین با دلیل | ✅ | `services/catalog.js` | `models.test.js` (قواعد مدل) |
| چرخه حذف خدمت (در حال حذف ← آرشیو) + تایید صریح + آرشیو خودکار | ✅ | `services/catalog.js`، `services/scheduler.js` | `scheduler.test.js` |
| بررسی نهایی نمایش قیمت در همه مسیرهای عمومی | ✅ | `controllers/shops.js`، `controllers/catalog.js`، `controllers/appointments.js` | `serialize.test.js` |
| نظرسنجی لیبلی + توضیح، یک‌بار برای هر نوبت | ✅ | `services/survey.js` | `models.test.js` |
| پنل مالک (کارکنان، خدمات، تنظیمات، نوبت‌های آرایشگاه) | ✅ | `controllers/shops.js`، `services/barber.js` | `shop-rules.test.js` |
| مدیریت کاربران (فهرست/غیرفعال‌سازی) و ساخت ادمین توسط سوپر ادمین | ✅ | `services/admin.js` | — |
| انتقال مالکیت/غیرفعال‌سازی آرایشگاه با رعایت نوبت‌های آینده | ✅ | `services/shop.js` | `shop-rules.test.js` |
| سیاست لغو و بیعانه، موجودیت refunds، بازگشت ادمین به کیف پول | ✅ | `services/appointment.js`، `services/admin.js` | `appointment-flow.test.js`، `wallet.test.js` |
| پیامک و صف آن | ✅ | `services/smsQueue.js`، `services/sms.js` | `smsQueue.test.js` |

## فاز ۳ — مالی و تحویل

| بند سند | وضعیت | محل | تست |
|---|---|---|---|
| کیف پول، تراکنش‌های یکتا، خرج برای بیعانه | ✅ | `services/wallet.js` | `wallet.test.js` |
| معرفی مشتری، پورسانت و برگشت آن | ✅ | `services/referral.js`، `services/wallet.js` | `referral.test.js`، `appointment-flow.test.js` |
| تنظیمات سوپر ادمین (پورسانت، مهلت عدم حضور، بیعانه، ...) | ✅ | `services/settings.js` | `settings.test.js` |
| آمار ساده روزانه | ✅ | `services/admin.js` | — |
| مرور بک‌لاگ | ✅ | [`BACKLOG.md`](BACKLOG.md) | — |
| مستندات (دیاگرام فلوها، مدل داده)، تست نهایی، دمو | ✅ | `README.md`، [`ARCHITECTURE.md`](ARCHITECTURE.md)، [`API.md`](API.md)، `scripts/seedDemo.js` | `npm test` |

## قواعد کلیدی بخش ۵

| قاعده | وضعیت | تست |
|---|---|---|
| نوبت آنلاین حداقل ۱۵ دقیقه بعد، شبکه ۵ دقیقه‌ای | ✅ | `availability.test.js`، `appointment-flow.test.js` |
| هر مشتری یک نگه‌داشتن فعال | ✅ | `appointment-flow.test.js` |
| قیمت/مدت در لحظه ثبت snapshot می‌شود | ✅ | `appointment-flow.test.js` |
| زمان رزرو هرگز عوض نمی‌شود؛ فقط زمان پیش‌بینی‌شده | ✅ | `availability.test.js` (عرض ثابت بازه) + `appointment-flow.test.js` |
| نوبت سوخته فقط برای مشتری حضوری | ✅ | `availability.test.js` |
| عدم حضور ۵ دقیقه‌ای و مهلت نگه‌داشتن تا شروع نوبت بعد | ✅ | `appointment-flow.test.js` |
| لغو بیش از ۲ ساعت قبل = بازگشت بیعانه | ✅ | `appointment-flow.test.js` |
| لغو آرایشگر فقط با موافقت مشتری | ✅ | `appointment-flow.test.js` |
| بازگشت «تکمیل شده» فقط ادمین + خنثی‌سازی پورسانت | ✅ | `appointment-flow.test.js` |
| کیف پول هرگز منفی نمی‌شود و تراکنش‌ها idempotent | ✅ | `wallet.test.js` |
| پیامک فقط با کلید یکتا و بدون اثر روی نوبت | ✅ | `smsQueue.test.js` |
| auditLogs فقط افزودنی | ✅ | `audit.test.js` |

> برای اجرای دموی کامل: `npm run seed:demo` سپس ورود با `09120000001` (مالک) یا `09120000003` (مشتری)
> و کد `12345` در development. جزئیات در [README](../README.md#۱-اجرا).
