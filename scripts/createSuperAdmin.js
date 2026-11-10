'use strict';

// استفاده:  npm run create-superadmin -- 09121234567
// اولین سوپر ادمین را می‌سازد (یا به کاربر موجود این نقش را می‌دهد). بعدش با همین شماره وارد شوید.
const { connectMongo, disconnectMongo } = require('../src/db/mongo');
const User = require('../src/models/User');
const auditService = require('../src/services/audit');
const { normalizeMobile } = require('../src/helpers/mobile');
const { ROLES, SYSTEM_ACTOR } = require('../src/constants/roles');

async function main() {
  const mobile = normalizeMobile(process.argv[2]);
  if (!mobile) throw new Error('شماره موبایل معتبر بدهید: npm run create-superadmin -- 09121234567');

  await connectMongo();
  const before = await User.findOne({ mobile });
  const user = before
    ? await User.findOneAndUpdate({ mobile }, { $addToSet: { roles: ROLES.SUPER_ADMIN } }, { new: true })
    : await User.create({ mobile, roles: [ROLES.SUPER_ADMIN, ROLES.CUSTOMER] });

  await auditService.record({
    actor: { role: SYSTEM_ACTOR },
    action: 'user.grantSuperAdmin',
    entityType: 'users',
    entityId: user._id,
    before,
    after: user,
  });
  console.log(`سوپر ادمین آماده است: ${mobile}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
