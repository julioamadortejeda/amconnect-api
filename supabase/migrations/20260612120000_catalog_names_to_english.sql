-- Migrate all system catalog name fields to English.
-- Display names are now handled by the Flutter app via ARB i18n (l10n.currency(), l10n.reminderType(), etc.)

-- ─── currencies ───────────────────────────────────────────────────────────────
update currencies set name = 'Mexican Peso'  where code = 'MXN';
update currencies set name = 'US Dollar'     where code = 'USD';

-- ─── payment_methods ──────────────────────────────────────────────────────────
update payment_methods set name = 'Direct Debit'   where code = 'DIRECT_DEBIT';
update payment_methods set name = 'Bank Transfer'  where code = 'BANK_TRANSFER';
update payment_methods set name = 'Check'          where code = 'CHECK';
update payment_methods set name = 'Cash'           where code = 'CASH';
update payment_methods set name = 'Credit Card'    where code = 'CREDIT_CARD';

-- ─── payment_frequencies ──────────────────────────────────────────────────────
update payment_frequencies set name = 'Monthly'    where code = 'MONTHLY';
update payment_frequencies set name = 'Quarterly'  where code = 'QUARTERLY';
update payment_frequencies set name = 'Semiannual' where code = 'SEMIANNUAL';
update payment_frequencies set name = 'Annual'     where code = 'ANNUAL';

-- ─── participant_roles ────────────────────────────────────────────────────────
update participant_roles set name = 'Holder'       where code = 'HOLDER';
update participant_roles set name = 'Insured'      where code = 'INSURED';
update participant_roles set name = 'Policyholder' where code = 'POLICYHOLDER';
update participant_roles set name = 'Dependent'    where code = 'DEPENDENT';

-- ─── policy_statuses ──────────────────────────────────────────────────────────
update policy_statuses set name = 'Active'    where code = 'ACTIVE';
update policy_statuses set name = 'Cancelled' where code = 'CANCELLED';
update policy_statuses set name = 'Expired'   where code = 'EXPIRED';
update policy_statuses set name = 'Pending'   where code = 'PENDING';
update policy_statuses set name = 'Suspended' where code = 'SUSPENDED';

-- ─── reminder_types ───────────────────────────────────────────────────────────
update reminder_types set name = 'Payment'           where code = 'PAYMENT';
update reminder_types set name = 'Renewal'           where code = 'RENEWAL';
update reminder_types set name = 'Cancellation'      where code = 'CANCELLATION';
update reminder_types set name = 'Follow-up'         where code = 'FOLLOW_UP';
update reminder_types set name = 'Call'              where code = 'CALL';
update reminder_types set name = 'Appointment'       where code = 'APPOINTMENT';
update reminder_types set name = 'Policy Anniversary' where code = 'ANNIVERSARY';
update reminder_types set name = 'Other'             where code = 'OTHER';

-- ─── reminder_statuses ────────────────────────────────────────────────────────
update reminder_statuses set name = 'Created'     where code = 'CREATED';
update reminder_statuses set name = 'Pending'     where code = 'PENDING';
update reminder_statuses set name = 'In Progress' where code = 'IN_PROGRESS';
update reminder_statuses set name = 'Done'        where code = 'DONE';
update reminder_statuses set name = 'Cancelled'   where code = 'CANCELLED';
