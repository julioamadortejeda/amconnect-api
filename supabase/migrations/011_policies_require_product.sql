-- ─── Pólizas: product_id obligatorio, quitar redundancia carrier/branch ────────
-- El carrier y branch se derivan del producto via JOIN.
-- El AI usa function calling para resolver o crear los IDs del catálogo antes
-- de crear la póliza, por lo que siempre existirá un product_id.

alter table policies
  drop column carrier_id,
  drop column branch_id,
  alter column product_id set not null;
