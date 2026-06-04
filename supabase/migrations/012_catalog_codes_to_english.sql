-- ─── Normalizar códigos de catálogos a inglés ────────────────────────────────
-- Los códigos se usan en lógica de negocio y en el AI; deben ser en inglés.
-- Los campos name/description conservan el español para la UI.

-- branches
update branches set code = 'LIFE'           where code = 'VIDA';
update branches set code = 'MAJOR_MEDICAL'  where code = 'GMM';
-- AUTO ya es inglés
update branches set code = 'PROPERTY'       where code = 'DANOS';
update branches set code = 'RETIREMENT'     where code = 'RETIRO';
update branches set code = 'EDUCATION'      where code = 'EDUCACION';

-- policy_statuses
update policy_statuses set code = 'ACTIVE'     where code = 'VIGENTE';
update policy_statuses set code = 'CANCELLED'  where code = 'CANCELADA';
update policy_statuses set code = 'EXPIRED'    where code = 'VENCIDA';
update policy_statuses set code = 'PENDING'    where code = 'EN_TRAMITE';
update policy_statuses set code = 'SUSPENDED'  where code = 'SUSPENDIDA';

-- reminder_types
update reminder_types set code = 'PAYMENT'       where code = 'PAGO';
update reminder_types set code = 'RENEWAL'       where code = 'RENOVACION';
update reminder_types set code = 'CANCELLATION'  where code = 'CANCELACION';
update reminder_types set code = 'FOLLOW_UP'     where code = 'SEGUIMIENTO';
update reminder_types set code = 'CALL'          where code = 'LLAMADA';
update reminder_types set code = 'APPOINTMENT'   where code = 'CITA';
