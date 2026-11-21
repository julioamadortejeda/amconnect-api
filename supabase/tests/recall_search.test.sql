-- Pruebas de `recall` (migraciones 20261121074654_recall_search y
-- 20261121074733_recall_searches). Correr con: supabase test db
begin;
select plan(19);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'recall.a@test.local', '{"full_name":"Asesor A"}'),
  ('22222222-2222-2222-2222-222222222222', 'recall.b@test.local', '{"full_name":"Asesor B"}');

create function pg_temp.vec(p_second float4) returns vector language sql immutable as $$
  select (array[1, p_second]::float4[] || array_fill(0::float4, array[766]))::vector(768);
$$;

create function pg_temp.login_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- Asesor A: una nota de texto y dos documentos pdf; tres fragmentos con la MISMA
-- distancia a la consulta (para probar el desempate por id).
insert into agent_notes (id, agent_id, source_type, content) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'text', 'nota'),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'pdf',  'doc1'),
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'pdf',  'doc2'),
  ('d0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'pdf',  'doc de B');

insert into agent_note_chunks (id, note_id, agent_id, chunk_index, content, embedding) values
  ('a0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 0, 'nota sobre la cirugía de rodilla', pg_temp.vec(0)),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 0, 'El asegurado fue operado de hernia inguinal en 2023', pg_temp.vec(0)),
  ('a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1, 'Póliza GMM-889977 de Allianz, cobertura nacional', pg_temp.vec(0)),
  ('a0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 0, 'texto lejano', pg_temp.vec(50)),
  ('b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 0, 'hernia de otro asesor GMM-889977', pg_temp.vec(0));

insert into recall_searches (id, agent_id, query, embedding)
values ('e0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'hernia', pg_temp.vec(0));

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

-- ─── Vectorial exacta ────────────────────────────────────────────────────────

select is(
  (select array_agg(chunk_id order by ordinality) from search_agent_note_chunks_exact(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 10) with ordinality),
  array['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003']::uuid[],
  'orden por similitud y, con empate, por id (estable entre páginas)'
);

select is(
  (select count(*)::int from search_agent_note_chunks_exact('11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 10)
   where chunk_id = 'a0000000-0000-0000-0000-000000000004'),
  0, 'el umbral descarta el fragmento lejano'
);

select is(
  (select array_agg(source_type) from search_agent_note_chunks_exact(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 10, array['text'])),
  array['text'], 'p_source_types = text devuelve solo notas de texto'
);

select is(
  (select count(*)::int from search_agent_note_chunks_exact(
     '11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 10, array['pdf','image','audio','document'])),
  2, 'p_source_types de documentos excluye las notas de texto'
);

select is(
  (select count(*)::int from search_agent_note_chunks_exact('11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.5, 2)),
  2, 'respeta p_match_count'
);

select is(
  (select count(*)::int from search_agent_note_chunks_exact('11111111-1111-1111-1111-111111111111', pg_temp.vec(0), 0.0, 10)
   where note_id = 'd0000000-0000-0000-0000-00000000000b'),
  0, 'RLS: la exacta no devuelve fragmentos del asesor B aunque se pidan'
);

select is(
  (select count(*)::int from search_agent_note_chunks_exact('22222222-2222-2222-2222-222222222222', pg_temp.vec(0), 0.0, 10)),
  0, 'RLS: pidiendo el agent_id de B como A, no sale nada'
);

-- ─── Texto completo ──────────────────────────────────────────────────────────

select is(
  (select array_agg(chunk_id) from search_agent_note_chunks_text('11111111-1111-1111-1111-111111111111', 'hernia', 10)),
  array['a0000000-0000-0000-0000-000000000001']::uuid[],
  'encuentra el término exacto "hernia"'
);

select is(
  (select array_agg(chunk_id) from search_agent_note_chunks_text('11111111-1111-1111-1111-111111111111', 'GMM-889977', 10)),
  array['a0000000-0000-0000-0000-000000000002']::uuid[],
  'encuentra un número de póliza'
);

select is(
  (select count(*)::int from search_agent_note_chunks_text('11111111-1111-1111-1111-111111111111', 'POLIZA ALLIANZ', 10)),
  1, 'sin acentos ni mayúsculas: "POLIZA" encuentra "Póliza"'
);

select is(
  (select array_agg(chunk_id) from search_agent_note_chunks_text('11111111-1111-1111-1111-111111111111', '¿Dónde vi lo de la hernia?', 10)),
  array['a0000000-0000-0000-0000-000000000001']::uuid[],
  'una pregunta completa funciona: las palabras vacías no ahogan el término útil'
);

select is(
  (select count(*)::int from search_agent_note_chunks_text('11111111-1111-1111-1111-111111111111', 'de la el', 10)),
  0, 'una consulta de puras palabras vacías no devuelve nada (y no truena)'
);

select is(
  (select count(*)::int from search_agent_note_chunks_text('11111111-1111-1111-1111-111111111111', '''; drop table agents; --', 10)),
  0, 'caracteres de sintaxis tsquery no truenan'
);

select is(
  (select count(*)::int from search_agent_note_chunks_text('11111111-1111-1111-1111-111111111111', 'hernia', 10, array['text'])),
  0, 'p_source_types filtra también la búsqueda de texto'
);

select is(
  (select count(*)::int from search_agent_note_chunks_text('11111111-1111-1111-1111-111111111111', 'hernia GMM', 10)
   where note_id = 'd0000000-0000-0000-0000-00000000000b'),
  0, 'RLS: la búsqueda de texto de A nunca ve el fragmento de B'
);

-- ─── recall_searches ─────────────────────────────────────────────────────────

select is((select count(*)::int from recall_searches), 1, 'A ve su búsqueda guardada');

select lives_ok(
  $$ insert into recall_searches (agent_id, query, embedding)
     values ('11111111-1111-1111-1111-111111111111', 'otra', array_fill(0.1::float4, array[768])::vector(768)) $$,
  'A puede guardar una búsqueda propia'
);

select pg_temp.login_as('22222222-2222-2222-2222-222222222222');

select is((select count(*)::int from recall_searches), 0, 'B no ve las búsquedas guardadas de A');

select throws_ok(
  $$ insert into recall_searches (agent_id, query, embedding)
     values ('11111111-1111-1111-1111-111111111111', 'x', array_fill(0.1::float4, array[768])::vector(768)) $$,
  '42501', null, 'B no puede guardar una búsqueda a nombre de A'
);

select * from finish();
rollback;
