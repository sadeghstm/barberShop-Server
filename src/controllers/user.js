'use strict';

const v = require('../helpers/validate');
const User = require('../models/User');

/** PATCH /api/users/me  { name } — کاربر مشخصات خودش را ویرایش می‌کند */
exports.updateMe = async (req, res) => {
  const name = v.string(req.body?.name, 'name', { min: 2, max: 80 });

  const user = await User.findById(req.auth.userId);
  const before = user.toObject();
  user.name = name;
  await user.save();

  await req.audit({ action: 'user.update', entityType: 'users', entityId: user._id, before, after: user });
  res.json({ user: { id: user._id, mobile: user.mobile, name: user.name } });
};
