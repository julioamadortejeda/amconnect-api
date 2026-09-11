-- Tercera rama: tolerar errores de dedo en recordatorios y compromisos.
--
-- Probado el 2026-09-11 en device: el asesor escribió "Maria diagnosito" y no
-- encontró "Sesión de diagnóstico con María". Concluir "no está" cuando sí está
-- es el mismo fallo silencioso de los acentos, con otro disfraz.
--
-- La cascada es la misma que en `search_contacts`: primero exacto, y SOLO si no
-- hubo nada se intenta por similitud. Nunca al revés — una coincidencia exacta
-- jamás debe diluirse entre parecidos.
--
-- El umbral 0.5 sale de medir contra los datos reales, no de elegirlo bien:
--
--   errores de dedo   comidda 0.67 · aniversrio 0.64 · diagnosito 0.64
--                     junnta 0.63 · vetimenta 0.62 · zarha 0.50
--   ruido             comision 0.44 · cocina 0.43 · zzz 0.25 · hipoteca 0.00
--
-- El margen es delgado: `comision` queda a seis centésimas de entrar. Si algún
-- día aparecen falsos positivos, este es el número que hay que subir, y hay que
-- volver a medir antes de moverlo.
--
-- Mínimo 3 caracteres antes de intentar la rama difusa: con una o dos letras
-- todo se parece a todo.
--
-- Sin índice a propósito: la comparación se hace con `>=` sobre una expresión
-- (`unaccent(lower(titulo || descripcion))`), que un índice GIN de trigramas no
-- puede aprovechar — habría que reescribir la consulta con el operador `<%` y
-- fijar `pg_trgm.word_similarity_threshold` por sesión. A los volúmenes de un
-- asesor es un recorrido secuencial de decenas de filas. Ese es el trabajo a
-- hacer el día que se mida un problema, no antes.

-- Las versiones de DOS argumentos se borran primero: `create or replace` con una
-- firma distinta NO reemplaza, crea una segunda función. Postgres se queda con
-- las dos y cualquier llamada de dos argumentos —que es como llama el backend—
-- falla con "function is not unique". Comprobado al aplicar esta migración.
drop function if exists search_reminder_ids(uuid, text);
drop function if exists search_commitment_ids(uuid, text);

create or replace function search_reminder_ids(
  p_agent_id  uuid,
  p_query     text,
  p_threshold real default 0.5
)
returns setof uuid
language plpgsql stable
as $$
declare
  v_palabras text[] := array_remove(string_to_array(btrim(lower(unaccent(p_query))), ' '), '');
begin
  if array_length(v_palabras, 1) is null then
    return query select r.id from reminders r
      where r.agent_id = p_agent_id and r.is_active;
    return;
  end if;

  -- 1) Todas las palabras, tal como se escribieron.
  return query
  select r.id
  from reminders r
  where r.agent_id = p_agent_id
    and r.is_active
    and (
      select bool_and(unaccent(lower(coalesce(r.title,'') || ' ' || coalesce(r.description,'')))
                        like '%' || palabra || '%')
      from unnest(v_palabras) as palabra
    );

  if found then
    return;
  end if;

  if length(btrim(coalesce(p_query, ''))) < 3 then
    return;
  end if;

  -- 2) Cada palabra, exacta O parecida. Por palabra y no sobre la frase entera:
  --    "maria diagnosito" tiene una bien escrita y una mal, y exigirle
  --    similitud al conjunto diluiría a la que sí está.
  return query
  select r.id
  from reminders r
  where r.agent_id = p_agent_id
    and r.is_active
    and (
      select bool_and(
        unaccent(lower(coalesce(r.title,'') || ' ' || coalesce(r.description,'')))
          like '%' || palabra || '%'
        or word_similarity(
             palabra,
             unaccent(lower(coalesce(r.title,'') || ' ' || coalesce(r.description,'')))
           ) >= p_threshold
      )
      from unnest(v_palabras) as palabra
    );
end;
$$;

create or replace function search_commitment_ids(
  p_agent_id  uuid,
  p_query     text,
  p_threshold real default 0.5
)
returns setof uuid
language plpgsql stable
as $$
declare
  v_palabras text[] := array_remove(string_to_array(btrim(lower(unaccent(p_query))), ' '), '');
begin
  if array_length(v_palabras, 1) is null then
    return query select c.id from client_commitments c
      where c.agent_id = p_agent_id and c.is_active;
    return;
  end if;

  return query
  select c.id
  from client_commitments c
  where c.agent_id = p_agent_id
    and c.is_active
    and (
      select bool_and(unaccent(lower(coalesce(c.label,'') || ' ' || coalesce(c.quote,'')))
                        like '%' || palabra || '%')
      from unnest(v_palabras) as palabra
    );

  if found then
    return;
  end if;

  if length(btrim(coalesce(p_query, ''))) < 3 then
    return;
  end if;

  return query
  select c.id
  from client_commitments c
  where c.agent_id = p_agent_id
    and c.is_active
    and (
      select bool_and(
        unaccent(lower(coalesce(c.label,'') || ' ' || coalesce(c.quote,'')))
          like '%' || palabra || '%'
        or word_similarity(
             palabra,
             unaccent(lower(coalesce(c.label,'') || ' ' || coalesce(c.quote,'')))
           ) >= p_threshold
      )
      from unnest(v_palabras) as palabra
    );
end;
$$;

grant execute on function search_reminder_ids(uuid, text, real)   to authenticated;
grant execute on function search_commitment_ids(uuid, text, real) to authenticated;
