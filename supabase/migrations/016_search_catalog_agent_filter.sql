-- ─── Índices trigram para búsqueda por proximidad ────────────────────────────
-- contacts ya tiene su índice en 003_core_entities.sql

create index idx_carriers_name_trgm  on carriers  using gin(name gin_trgm_ops);
create index idx_branches_name_trgm  on branches  using gin(name gin_trgm_ops);
create index idx_products_name_trgm  on products  using gin(name gin_trgm_ops);

-- ─── search_catalog actualizado ──────────────────────────────────────────────
-- Usa word_similarity() en lugar de similarity():
--   similarity("AXA", "AXA Seguros")      → mejor match para nombre exacto parcial
--   word_similarity("Gastos", "Gastos Médicos Mayores") → mejor match para substring
-- El OR combina ambas para que funcione en los dos casos.
-- p_agent_id: si se pasa, filtra por agente (catálogos por asesor).
--             Si es null no filtra (catálogos globales).

create or replace function search_catalog(
  p_table_name  text,
  p_query       text,
  p_threshold   float  default 0.3,
  p_agent_id    uuid   default null
)
returns table (
  id         uuid,
  name       text,
  similarity float
)
language plpgsql stable
as $$
begin
  return query execute format(
    'select id, name,
            greatest(similarity(name, %L), word_similarity(%L, name)) as similarity
     from %I
     where (similarity(name, %L) >= %s or %L <%% name)
       and is_active = true
       %s
     order by similarity desc
     limit 10',
    p_query, p_query,
    p_table_name,
    p_query, p_threshold, p_query,
    case when p_agent_id is not null
         then format('and agent_id = %L', p_agent_id)
         else ''
    end
  );
end;
$$;
