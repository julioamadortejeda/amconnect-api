-- Pruebas de la búsqueda RAG acotada (migración 20261120235540_rag_scoped_search).
-- Correr con: supabase test db
--
-- Vectores sintéticos de 768 dimensiones (la de agent_note_chunks.embedding),
-- sin llamar a la API de embeddings:
--   consulta  = [1, 0, 0, ...]
--   señuelos  = [1, 0, 0, ...]      → similitud 1.0 (más parecidos que todo)
--   objetivo  = [1, 0.75, 0, ...]   → similitud 0.8
-- Con 10 señuelos y LIMIT 5, la búsqueda sin acotar NUNCA trae al objetivo; la
-- acotada a su contacto / póliza / recordatorio tiene que traerlo.

begin;
select plan(15);

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'rag.a@test.local', '{"full_name":"Asesor A"}'),
  ('22222222-2222-2222-2222-222222222222', 'rag.b@test.local', '{"full_name":"Asesor B"}');

create function pg_temp.vec(p_second float4) returns vector language sql immutable as $$
  select (array[1, p_second]::float4[] || array_fill(0::float4, array[766]))::vector(768);
$$;

create function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

insert into contacts (id, agent_id, full_name) values
  ('c0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Cliente objetivo'),
  ('c0000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Cliente señuelo'),
  ('c0000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Cliente de B');

insert into carriers (id, agent_id, name) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Aseguradora');
insert into branches (id, agent_id, name) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ramo');
insert into products (id, agent_id, carrier_id, branch_id, name) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'ca000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Producto');

insert into policies (id, agent_id, contact_id, product_id, status_id, currency_id)
values (
  'e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001',
  (select id from policy_statuses limit 1), (select id from currencies limit 1)
);

insert into reminders (id, agent_id, contact_id, type_id, title, due_date, status_id)
values (
  'f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'c0000000-0000-0000-0000-00000000000a', (select id from reminder_types limit 1),
  'Recordatorio', now() + interval '1 day', (select id from reminder_statuses limit 1)
);

-- 10 señuelos del asesor A (otro contacto), idénticos a la consulta.
with n as (
  insert into agent_notes (agent_id, contact_id, source_type, content)
  select '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000b', 'text', 'señuelo ' || g
  from generate_series(1, 10) g
  returning id, agent_id, content
)
insert into agent_note_chunks (note_id, agent_id, chunk_index, content, embedding)
select id, agent_id, 0, content, pg_temp.vec(0) from n;

-- La nota objetivo: ligada al contacto, a la póliza y al recordatorio.
insert into agent_notes (id, agent_id, contact_id, policy_id, reminder_id, source_type, content)
values ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'c0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000001', 'text', 'objetivo');
insert into agent_note_chunks (note_id, agent_id, chunk_index, content, embedding)
values ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 0, 'objetivo', pg_temp.vec(0.75));

-- Una nota del asesor B idéntica a la consulta (para RLS).
insert into agent_notes (id, agent_id, contact_id, source_type, content)
values ('d0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
        'c0000000-0000-0000-0000-00000000000c', 'text', 'nota de B');
insert into agent_note_chunks (note_id, agent_id, chunk_index, content, embedding)
values ('d0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 0, 'nota de B', pg_temp.vec(0));

-- ─── Como el asesor A ────────────────────────────────────────────────────────

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

-- Línea base: sin acotar, los señuelos llenan el LIMIT (así era el bug: el
-- `.eq("contact_id")` aplicado después de esto devolvía vacío).
select is(
  (select count(*)::int from search_agent_note_chunks(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 5)
   where note_id = 'd0000000-0000-0000-0000-000000000001'),
  0,
  'sin acotar, el LIMIT se llena con notas de otros contactos más parecidas'
);

select is(
  (select array_agg(note_id) from search_agent_note_chunks(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 5,
     p_contact_id => 'c0000000-0000-0000-0000-00000000000a')),
  array['d0000000-0000-0000-0000-000000000001'::uuid],
  'acotada al contacto, devuelve la nota de ese contacto aunque otras sean más parecidas'
);

select is(
  (select array_agg(note_id) from search_agent_note_chunks(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 5,
     p_policy_id => 'e0000000-0000-0000-0000-000000000001')),
  array['d0000000-0000-0000-0000-000000000001'::uuid],
  'acotada a la póliza, devuelve la nota de esa póliza'
);

select is(
  (select array_agg(note_id) from search_agent_note_chunks(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 5,
     p_reminder_id => 'f0000000-0000-0000-0000-000000000001')),
  array['d0000000-0000-0000-0000-000000000001'::uuid],
  'acotada al recordatorio, devuelve la nota de ese recordatorio'
);

select is(
  (select reminder_id from search_agent_note_chunks(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 5,
     p_reminder_id => 'f0000000-0000-0000-0000-000000000001')),
  'f0000000-0000-0000-0000-000000000001'::uuid,
  'la función devuelve reminder_id (search_reminder_notes filtraba por una columna inexistente)'
);

-- Forzando el índice HNSW (sin seq scan ni sort, ef_search menor que el número
-- de señuelos): el índice es global y filtra DESPUÉS de recorrer candidatos;
-- sin el hnsw.iterative_scan que fija la función, esta búsqueda vuelve a perder
-- la nota del contacto (comprobado: devuelve vacío al quitarlo).
set local enable_seqscan = off;
set local enable_sort = off;
set local hnsw.ef_search = 5;
select is(
  (select array_agg(note_id) from search_agent_note_chunks(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 5,
     p_contact_id => 'c0000000-0000-0000-0000-00000000000a')),
  array['d0000000-0000-0000-0000-000000000001'::uuid],
  'con el índice HNSW forzado, la búsqueda acotada sigue encontrando la nota'
);
reset enable_seqscan;
reset enable_sort;
reset hnsw.ef_search;

select is(
  (select count(*)::int from search_agent_note_chunks(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.9, 5,
     p_contact_id => 'c0000000-0000-0000-0000-00000000000a')),
  0,
  'el threshold se sigue respetando en la búsqueda acotada'
);

select is(
  (select count(*)::int from search_agent_note_chunks(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 50)
   where note_id = 'd0000000-0000-0000-0000-00000000000b'),
  0,
  'RLS: el asesor A no ve fragmentos del asesor B en la búsqueda'
);

select is(
  (select count(*)::int from search_agent_note_chunks(
     '22222222-2222-2222-2222-222222222222', pg_temp.vec(0), 0.5, 50)),
  0,
  'RLS: pasar el p_agent_id de otro asesor no devuelve nada'
);

select is(
  (select count(*)::int from agent_note_chunks where agent_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'RLS: el asesor A no ve fragmentos del asesor B en la tabla'
);

-- ─── Nota + fragmentos en una transacción ────────────────────────────────────

select isnt(
  insert_agent_note_with_chunks(
    '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', null, null,
    'text', 'nota nueva', null, null, 'resumen',
    jsonb_build_array(
      jsonb_build_object('chunk_index', 0, 'content', 'nota nueva', 'embedding', to_jsonb(pg_temp.vec(0.1)::real[])),
      jsonb_build_object('chunk_index', 1, 'content', 'resumen',    'embedding', to_jsonb(pg_temp.vec(0.2)::real[])))
  ),
  null,
  'insert_agent_note_with_chunks crea la nota y devuelve su id'
);

select is(
  (select count(*)::int from agent_note_chunks c join agent_notes n on n.id = c.note_id
   where n.content = 'nota nueva' and n.note_origin = 'knowledge'),
  2,
  'insert_agent_note_with_chunks guarda todos los fragmentos'
);

-- Un fragmento inválido (dimensión equivocada) revierte también la nota.
select throws_ok(
  $$ select insert_agent_note_with_chunks(
       '11111111-1111-1111-1111-111111111111', null, null, null,
       'text', 'nota rota', null, null, null,
       '[{"chunk_index":0,"content":"x","embedding":[1,2,3]}]'::jsonb) $$,
  '22000', null,
  'un fragmento inválido hace fallar la llamada completa'
);

select is(
  (select count(*)::int from agent_notes where content = 'nota rota'),
  0,
  'si fallan los fragmentos no queda una nota huérfana'
);

select throws_ok(
  $$ select insert_agent_note_with_chunks(
       '22222222-2222-2222-2222-222222222222', null, null, null,
       'text', 'intrusa', null, null, null, '[]'::jsonb) $$,
  '42501', null,
  'RLS: el asesor A no puede crear notas a nombre del asesor B'
);

select * from finish();
rollback;
