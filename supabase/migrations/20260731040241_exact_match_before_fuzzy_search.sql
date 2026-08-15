-- ─── search_contacts: match exacto antes de fuzzy ────────────────────────────
-- Si el nombre/email dado coincide exacto (case-insensitive) con un contacto,
-- devolver SOLO ese resultado sin pasar por similarity(). Antes, un apellido
-- compartido con otro contacto (ej. "Julio Amador" vs "Andrés Amador") superaba
-- el p_threshold por solape de trigramas y disparaba una desambiguación falsa
-- aunque el usuario ya hubiera dado el nombre completo y exacto.

create or replace function search_contacts(
  p_agent_id  uuid,
  p_query     text,
  p_threshold float default 0.2
)
returns table (
  id          uuid,
  full_name   text,
  email       text,
  phone       text,
  similarity  float
)
language plpgsql stable
as $$
begin
  return query
  select
    c.id,
    c.full_name,
    c.email,
    c.phone,
    1.0::float as similarity
  from contacts c
  where
    c.agent_id = p_agent_id
    and c.is_active = true
    and c.deleted_at is null
    and (lower(c.full_name) = lower(p_query) or lower(coalesce(c.email, '')) = lower(p_query));

  if found then
    return;
  end if;

  return query
  select
    c.id,
    c.full_name,
    c.email,
    c.phone,
    greatest(
      similarity(c.full_name, p_query),
      similarity(coalesce(c.email, ''), p_query)
    ) as similarity
  from contacts c
  where
    c.agent_id = p_agent_id
    and c.is_active = true
    and c.deleted_at is null
    and greatest(
      similarity(c.full_name, p_query),
      similarity(coalesce(c.email, ''), p_query)
    ) >= p_threshold
  order by similarity desc
  limit 10;
end;
$$;

-- ─── search_catalog: match exacto antes de fuzzy ─────────────────────────────
-- Mismo patrón que search_contacts, aplicado a carriers/branches/products.
-- Antes, catalog.skills.ts toma silenciosamente el primer resultado por
-- similarity cuando hay match — con esto un nombre exacto ("AXA Seguros") ya
-- no compite con otro registro que solo comparte una palabra.

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
    'select id, name, 1.0::float as similarity
     from %I
     where lower(name) = lower(%L)
       and is_active = true
       %s
     limit 10',
    p_table_name,
    p_query,
    case when p_agent_id is not null
         then format('and agent_id = %L', p_agent_id)
         else ''
    end
  );

  if found then
    return;
  end if;

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
