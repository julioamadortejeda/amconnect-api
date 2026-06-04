-- ─── Árbol de referidos en contacts ──────────────────────────────────────────
-- referred_by_id  → FK a un contacto ya registrado en la cartera
-- external_referrer_source → texto libre cuando el referidor aún no es contacto

alter table contacts
  add column referred_by_id uuid references contacts(id),
  add column external_referrer_source text;
