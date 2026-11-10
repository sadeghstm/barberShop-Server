'use strict';

// نقطه واحد دسترسی به همه مدل‌ها و ثابت‌ها
module.exports = {
  User: require('./modules/users/User.model'),
  Shop: require('./modules/shops/Shop.model'),
  Barber: require('./modules/barbers/Barber.model'),
  ServiceCatalog: require('./modules/services/ServiceCatalog.model'),
  BarberService: require('./modules/services/BarberService.model'),
  ServiceRequest: require('./modules/services/ServiceRequest.model'),
  Appointment: require('./modules/appointments/Appointment.model'),
  Payment: require('./modules/payments/Payment.model'),
  Refund: require('./modules/payments/Refund.model'),
  Wallet: require('./modules/wallet/Wallet.model'),
  WalletTransaction: require('./modules/wallet/WalletTransaction.model'),
  Referral: require('./modules/referrals/Referral.model'),
  SurveyLabel: require('./modules/surveys/SurveyLabel.model'),
  Survey: require('./modules/surveys/Survey.model'),
  Settings: require('./modules/settings/Settings.model'),
  AuditLog: require('./modules/audit/AuditLog.model'),
};
