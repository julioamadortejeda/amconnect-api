-- ─── Una sola FK por relación: quitar la simple donde ya hay compuesta ───────
--
-- EL PROBLEMA
-- 20261121051742_tenant_integrity agregó FKs compuestas
-- `(agent_id, x_id) -> padre (agent_id, id)` JUNTO a las FKs simples
-- `x_id -> padre (id)` que ya existían. Para Postgres no hay conflicto, pero
-- PostgREST arma sus relaciones de embed desde pg_constraint: con dos FKs
-- entre el mismo par de tablas, todo embed sin hint se vuelve ambiguo y
-- responde PGRST201 ("more than one relationship was found"). En integración:
-- GET /reminders y GET /policies en 500, el asistente sin poder leer
-- recordatorios, pólizas ni adjuntos de notas
-- ('reminders' y 'agent_notes', 'agent_notes' y 'document_metadata').
--
-- LA SOLUCIÓN
-- Borrar la FK simple de cada columna que ya está cubierta por una
-- `*_same_agent_fkey`. La compuesta ya repite su ON DELETE (cascade, o
-- `set null (x_id)` sin tocar agent_id), así que la semántica de borrado no
-- cambia, y la compuesta también garantiza que el padre exista: es
-- estrictamente más fuerte que la simple. Queda exactamente UNA relación por
-- par de tablas y los embeds vuelven a resolverse solos.
--
-- Por qué no triggers en lugar de FKs compuestas: el trigger no lo ve
-- PostgREST (no habría ambigüedad), pero vuelve imperativo lo que hoy es
-- declarativo y hay que replicarlo por relación. Quitar la simple resuelve la
-- ambigüedad sin perder nada.
--
-- Caso borde: si la compuesta quedó NOT VALID por datos viejos cruzados
-- (local: policies.product_id, 5 filas e2e), las filas viejas ya no tienen la
-- garantía de existencia de la simple. Las escrituras nuevas sí. Es el mismo
-- pendiente que ya avisa el WARNING de la migración anterior: corregir esas
-- filas y validar.
--
-- Las relaciones entre tablas de asesor se buscan en el catálogo, no a mano.
-- Re-ejecutable: si ya no hay simple que borrar, no hace nada.

do $$
declare
  r record;
begin
  for r in
    select s.conrelid::regclass as child, s.conname as simple_fk, c.conname as composite_fk
      from pg_constraint c
      join pg_constraint s
        on s.conrelid = c.conrelid
       and s.confrelid = c.confrelid
       and s.contype = 'f'
       and array_length(s.conkey, 1) = 1
       and s.conkey[1] = c.conkey[2]
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and c.conname like '%\_same\_agent\_fkey'
  loop
    execute format('alter table %s drop constraint %I', r.child, r.simple_fk);
    raise notice 'single_fk_per_relation: % drop % (cubierta por %)', r.child, r.simple_fk, r.composite_fk;
  end loop;
end $$;

-- PostgREST cachea el esquema: que recargue las relaciones ya.
notify pgrst, 'reload schema';
