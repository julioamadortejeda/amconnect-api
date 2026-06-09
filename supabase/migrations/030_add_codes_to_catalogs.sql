-- ─── 1. Tabla payment_frequencies ───
ALTER TABLE payment_frequencies ADD COLUMN IF NOT EXISTS code text;

UPDATE payment_frequencies SET code = 'MONTHLY' WHERE name = 'Mensual';
UPDATE payment_frequencies SET code = 'QUARTERLY' WHERE name = 'Trimestral';
UPDATE payment_frequencies SET code = 'SEMIANNUAL' WHERE name = 'Semestral';
UPDATE payment_frequencies SET code = 'ANNUAL' WHERE name = 'Anual';

ALTER TABLE payment_frequencies ALTER COLUMN code SET NOT NULL;
ALTER TABLE payment_frequencies ADD CONSTRAINT payment_frequencies_code_key UNIQUE (code);


-- ─── 2. Tabla payment_methods ───
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS code text;

UPDATE payment_methods SET code = 'DIRECT_DEBIT' WHERE name = 'Domiciliación';
UPDATE payment_methods SET code = 'BANK_TRANSFER' WHERE name = 'Transferencia Bancaria';
UPDATE payment_methods SET code = 'CHECK' WHERE name = 'Cheque';
UPDATE payment_methods SET code = 'CASH' WHERE name = 'Efectivo';
UPDATE payment_methods SET code = 'CREDIT_CARD' WHERE name = 'Tarjeta de Crédito';

ALTER TABLE payment_methods ALTER COLUMN code SET NOT NULL;
ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_code_key UNIQUE (code);


-- ─── 3. Tabla participant_roles ───
ALTER TABLE participant_roles ADD COLUMN IF NOT EXISTS code text;

UPDATE participant_roles SET code = 'HOLDER' WHERE name = 'Titular';
UPDATE participant_roles SET code = 'INSURED' WHERE name = 'Asegurado';
UPDATE participant_roles SET code = 'POLICYHOLDER' WHERE name = 'Contratante';
UPDATE participant_roles SET code = 'DEPENDENT' WHERE name = 'Dependiente';

ALTER TABLE participant_roles ALTER COLUMN code SET NOT NULL;
ALTER TABLE participant_roles ADD CONSTRAINT participant_roles_code_key UNIQUE (code);
