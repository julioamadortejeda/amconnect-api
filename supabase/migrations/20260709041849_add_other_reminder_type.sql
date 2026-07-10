-- ─── Insertar tipo de recordatorio genérico (OTHER) ───────────────────────────
-- Esto corrige el bug donde los recordatorios no categorizados fallaban en la base de datos
-- y se auto-asignaban de forma aleatoria al tipo ANNIVERSARY (Aniversario) por orden físico en el disco.

INSERT INTO public.reminder_types (id, code, name, is_active)
VALUES (
  'e3c5915e-847d-4fd6-beeb-2970afc94f11',
  'OTHER',
  'Other',
  true
) ON CONFLICT (code) DO NOTHING;
