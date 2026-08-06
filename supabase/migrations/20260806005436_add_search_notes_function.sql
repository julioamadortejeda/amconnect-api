-- Reemplaza el `.or('content.ilike.*x*,summary.ilike.*x*')` de
-- NoteRepository.searchNotes: (1) no buscaba en el nombre de archivo, así
-- que buscar "poliza.pdf" o el nombre de un audio no encontraba nada aunque
-- existiera; (2) el texto de búsqueda se interpolaba crudo en el string del
-- filtro de PostgREST — una coma o paréntesis en lo que el asesor escribe
-- rompe el parseo del `.or()`. Una función SQL con parámetro bindeado evita
-- ambos problemas y permite el join a document_metadata para el nombre de
-- archivo. Búsqueda por nombre de cliente queda pendiente (join a contacts
-- vía .or() no es trivial) — se agrega después.

create or replace function search_notes(
  p_query  text default null,
  p_limit  int  default 20,
  p_offset int  default 0
)
returns table (
  id           uuid,
  contact_id   uuid,
  policy_id    uuid,
  source_type  text,
  created_at   timestamptz,
  content      text,
  summary      text,
  file_name    text,
  storage_path text,
  full_name    text
)
language sql
stable
as $$
  with q as (
    select '%' || replace(replace(coalesce(p_query, ''), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select
    an.id,
    an.contact_id,
    an.policy_id,
    an.source_type,
    an.created_at,
    an.content,
    an.summary,
    dm.file_name,
    dm.storage_path,
    c.full_name
  from agent_notes an
  left join document_metadata dm on dm.id = an.document_metadata_id
  left join contacts c on c.id = an.contact_id
  cross join q
  where an.is_active = true
    and (
      coalesce(btrim(p_query), '') = ''
      or an.content ilike q.pattern
      or an.summary ilike q.pattern
      or dm.file_name ilike q.pattern
    )
  order by an.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function search_notes(text, int, int) to authenticated;
