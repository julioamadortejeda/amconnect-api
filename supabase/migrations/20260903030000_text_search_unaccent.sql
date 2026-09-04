-- ─── Buscar por tema sin que el acento decida ─────────────────────────────────
--
-- `search_reminders` filtraba con `title ilike '%X%' or description ilike '%X%'`,
-- e `ilike` NO ignora acentos. El asesor escribe desde el telefono, sin acentos,
-- y lo que guardo el asistente si los trae:
--
--   'Sesion de diagnostico con Maria'  <- lo que el asesor teclea
--   'Sesión de diagnóstico con María'  <- lo que esta en la tabla
--
-- ilike da 0 filas. Y el fallo es SILENCIOSO, igual que el de search_contacts
-- (20260828130000): el asistente contesta "no encontre nada de diagnostico"
-- con toda confianza, mientras el asesor esta viendo el recordatorio en la
-- pantalla. Caso real reportado por el asesor de pruebas el 2026-09-02.
--
-- Se arregla para las DOS tablas donde el asesor pregunta por tema:
-- recordatorios y compromisos. Compromisos lo estrena — hasta hoy no se podia
-- buscar por texto ahi, solo por fecha o cliente.
--
-- Por que devuelven solo ids y no las filas completas: los repositorios ya
-- arman su propio select con los joins de catalogo y contacto, y duplicar ese
-- shape aqui obligaria a mantener dos definiciones en sincronia — justo el
-- error que 20260801230114 tuvo que ir a arreglar. El repositorio filtra con
-- `.in("id", ids)` y su select se queda como estaba.
--
-- SECURITY INVOKER (el default): el RLS de cada tabla sigue aplicando con el
-- JWT del asesor, sin necesidad de filtrar por agent_id en el TypeScript
-- (RULES §3 — nunca service role en servicios). El `p_agent_id` que reciben es
-- redundante a proposito: hace la intencion explicita y permite el indice.

create extension if not exists unaccent;

create or replace function search_reminder_ids(
  p_agent_id uuid,
  p_query    text
)
returns setof uuid
language sql stable
as $$
  select r.id
  from reminders r
  where r.agent_id = p_agent_id
    and r.is_active
    and (
      unaccent(lower(r.title)) like '%' || unaccent(lower(p_query)) || '%'
      or unaccent(lower(coalesce(r.description, ''))) like '%' || unaccent(lower(p_query)) || '%'
    );
$$;

create or replace function search_commitment_ids(
  p_agent_id uuid,
  p_query    text
)
returns setof uuid
language sql stable
as $$
  select cc.id
  from client_commitments cc
  where cc.agent_id = p_agent_id
    and cc.is_active
    and (
      unaccent(lower(cc.label)) like '%' || unaccent(lower(p_query)) || '%'
      or unaccent(lower(cc.quote)) like '%' || unaccent(lower(p_query)) || '%'
    );
$$;

grant execute on function search_reminder_ids(uuid, text)   to authenticated;
grant execute on function search_commitment_ids(uuid, text) to authenticated;
