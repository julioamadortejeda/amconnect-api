-- Campos comunes adicionales para pólizas — ver análisis de tipos de póliza individuales (2026-07-12)
alter table policies
  add column if not exists coinsurance text,      -- coaseguro global (ej. '10%') — hermano del deducible, clave en GMM
  add column if not exists seniority_date date,    -- antigüedad reconocida (GMM/Vida) — distinta de start_date/issue_date, no se reinicia en renovación
  add column if not exists insured_item text,      -- descripción corta del objeto asegurado (Auto/Hogar/Mascotas) — null en pólizas de personas
  add column if not exists policy_version text;    -- número de endoso/versión del documento vigente
