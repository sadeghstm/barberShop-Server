'use strict';

// نقطه واحد دسترسی به همه مدل‌ها و ثابت‌ها
module.exports = {
  User: require('./User'),
  Shop: require('./Shop'),
  Barber: require('./Barber'),
  ServiceCatalog: require('./ServiceCatalog'),
  BarberService: require('./BarberService'),
  ServiceRequest: require('./ServiceRequest'),
  Appointment: require('./Appointment'),
  Payment: require('./Payment'),
  Refund: require('./Refund'),
  Wallet: require('./Wallet'),
  WalletTransaction: require('./WalletTransaction'),
  Referral: require('./Referral'),
  SurveyLabel: require('./SurveyLabel'),
  Survey: require('./Survey'),
  Settings: require('./Settings'),
  AuditLog: require('./AuditLog'),
};
