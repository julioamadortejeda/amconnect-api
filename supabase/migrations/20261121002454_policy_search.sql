-- ─── Búsqueda de pólizas: varias palabras, sin acentos, sinónimos y typos ────
--
-- Hasta hoy `PolicyService.searchPolicies` traía TODAS las pólizas del asesor
-- (con tope de 100) y filtraba en memoria con `includes(frase completa)`.
-- Fallaba en silencio de cuatro formas, todas vistas con datos reales:
--
--   "GMM de AXA"       ningún campo contiene la frase completa → 0 resultados
--   "gastos medicos"   sin acento no coincide con "Gastos Médicos"
--   "gastos médicos"   el ramo puede estar guardado en inglés ("Major Medical")
--   "la del Jetta"     `insured_item` ni siquiera se revisaba
--
-- Mismo patrón que `search_reminder_ids` (20260911010000): se parte la consulta
-- en palabras, se exigen TODAS (en cualquier orden y en cualquier campo), sin
-- acentos, y SOLO si no hubo nada exacto se intenta por similitud con
-- `word_similarity` (umbral 0.5, la misma escala medida allá).
--
-- Lo nuevo es la tabla `search_synonyms`: el asesor dice "GMM", "gastos
-- médicos" o "salud" y el ramo puede llamarse "Major Medical", "Gastos Médicos
-- Mayores" o tener el código `MAJOR_MEDICAL`. Los catálogos son por asesor
-- (008) y cada quien los nombra como quiere, así que el sinónimo NO apunta a
-- un id: apunta a un concepto (`expands_to`) y todos los términos del mismo
-- concepto se buscan como alternativas, contra nombre y código del ramo.
--
-- Devuelve solo ids, en orden de relevancia: el repositorio arma su propio
-- select con los joins (mismo razonamiento que 20260903030000).
--
-- SECURITY INVOKER (default): el RLS de policies/contacts/catálogos aplica con
-- el JWT del asesor. `p_agent_id` es redundante a propósito (intención + índice).
--
-- Re-ejecutable: se aplica a mano con psql en local.

-- ─── Normalización compartida ────────────────────────────────────────────────
-- Minúsculas, sin acentos, y todo lo que no sea letra o número se vuelve un
-- espacio: "GM-000123" y "gm 000123" se comparan igual, y los códigos de
-- catálogo (`MAJOR_MEDICAL`) se leen como palabras ("major medical").
-- STABLE y no IMMUTABLE porque `unaccent` no lo es; no se usa en índices.
create or replace function normalize_search_text(p_text text)
returns text
language sql stable
as $$
  select btrim(regexp_replace(lower(unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

grant execute on function normalize_search_text(text) to authenticated;

-- ─── Sinónimos ───────────────────────────────────────────────────────────────
-- Global y de solo lectura para el asesor: es vocabulario del mercado, no dato
-- suyo. Se escribe solo por migración.
--
-- `language` (es, en, pt…) y `country` (ISO 3166-1 alfa-2; null = todos los
-- países) existen para cuando el producto salga de México. HOY la búsqueda usa
-- TODAS las filas sin filtrar (más recall: un asesor mexicano también dice
-- "health insurance"). El día que choquen vocabularios entre países, el filtro
-- va en `search_policy_ids` con `agents.locale` y un país del asesor.
create table if not exists search_synonyms (
  id          uuid primary key default gen_random_uuid(),
  term        text not null,   -- lo que dice el asesor, ya normalizado
  expands_to  text not null,   -- el concepto; también se busca como alternativa
  domain      text not null,   -- p. ej. 'policy'
  language    text not null,
  country     text,
  created_at  timestamptz not null default now()
);

-- `country` null cuenta como un valor más para no duplicar filas al re-ejecutar.
create unique index if not exists search_synonyms_unique_idx
  on search_synonyms (term, expands_to, domain, language, coalesce(country, ''));

alter table search_synonyms enable row level security;

drop policy if exists "search_synonyms: read" on search_synonyms;
create policy "search_synonyms: read"
  on search_synonyms for select
  to authenticated
  using (true);

grant select on search_synonyms to authenticated;
grant select, insert, update, delete on search_synonyms to service_role;

-- Cada concepto se escribe con términos normalizados (sin acento, minúsculas):
-- la función normaliza la consulta igual, así que "Quálitas" y "qualitas" caen
-- en la misma fila. Los multi-palabra se reconocen como frase en la consulta.
-- El concepto de los ramos es el texto de su código en inglés (MAJOR_MEDICAL →
-- "major medical"), que es como lo guarda la app.
insert into search_synonyms (term, expands_to, domain, language, country)
select t.term, t.expands_to, 'policy', t.language, t.country
from (values
  -- Ramo: gastos médicos
  ('gmm', 'major medical', 'es', null), ('gastos medicos', 'major medical', 'es', null),
  ('gastos medicos mayores', 'major medical', 'es', null), ('gastos mayores', 'major medical', 'es', null),
  ('gastos', 'major medical', 'es', null), ('salud', 'major medical', 'es', null),
  ('medica', 'major medical', 'es', null), ('medico', 'major medical', 'es', null),
  ('medicos', 'major medical', 'es', null), ('seguro de gastos medicos', 'major medical', 'es', null),
  -- Ramo: autos
  ('auto', 'auto', 'es', null), ('autos', 'auto', 'es', null), ('automovil', 'auto', 'es', null),
  ('automoviles', 'auto', 'es', null), ('coche', 'auto', 'es', null), ('coches', 'auto', 'es', null),
  ('carro', 'auto', 'es', null), ('carros', 'auto', 'es', null), ('vehiculo', 'auto', 'es', null),
  ('vehiculos', 'auto', 'es', null), ('seguro de auto', 'auto', 'es', null),
  -- Ramo: vida
  ('vida', 'life', 'es', null), ('seguro de vida', 'life', 'es', null),
  -- Ramo: daños / hogar
  ('hogar', 'property', 'es', null), ('casa', 'property', 'es', null), ('danos', 'property', 'es', null),
  ('vivienda', 'property', 'es', null),
  -- Ramo: responsabilidad civil
  ('rc', 'liability', 'es', null), ('responsabilidad civil', 'liability', 'es', null),
  -- Ramo: retiro y educación
  ('retiro', 'retirement', 'es', null), ('pension', 'retirement', 'es', null),
  ('ppr', 'retirement', 'es', 'MX'),
  ('educacion', 'education', 'es', null), ('educativo', 'education', 'es', null),
  -- Ramos en inglés
  ('health', 'major medical', 'en', null), ('health insurance', 'major medical', 'en', null),
  ('medical', 'major medical', 'en', null), ('medical insurance', 'major medical', 'en', null),
  ('car', 'auto', 'en', null), ('automobile', 'auto', 'en', null),
  ('car insurance', 'auto', 'en', null), ('auto insurance', 'auto', 'en', null),
  ('life', 'life', 'en', null), ('life insurance', 'life', 'en', null),
  ('home', 'property', 'en', null), ('home insurance', 'property', 'en', null),
  ('property', 'property', 'en', null),
  ('liability', 'liability', 'en', null), ('liability insurance', 'liability', 'en', null),
  ('retirement', 'retirement', 'en', null), ('education', 'education', 'en', null),
  -- Aseguradoras mexicanas
  ('gnp', 'gnp', 'es', 'MX'), ('grupo nacional provincial', 'gnp', 'es', 'MX'),
  ('smnyl', 'monterrey new york life', 'es', 'MX'), ('mnyl', 'monterrey new york life', 'es', 'MX'),
  ('seguros monterrey', 'monterrey new york life', 'es', 'MX'),
  ('monterrey new york life', 'monterrey new york life', 'es', 'MX'),
  ('qualitas', 'qualitas', 'es', 'MX'),
  ('banorte', 'banorte', 'es', 'MX'),
  ('bbva', 'bbva', 'es', 'MX'), ('bancomer', 'bbva', 'es', 'MX'),
  ('mapfre tepeyac', 'mapfre', 'es', 'MX'),
  -- Aseguradoras internacionales
  ('metlife', 'metlife', 'es', null), ('met life', 'metlife', 'es', null),
  ('metropolitan life', 'metlife', 'es', null),
  ('axa', 'axa', 'es', null),
  ('allianz', 'allianz', 'es', null), ('alianz', 'allianz', 'es', null),
  ('mapfre', 'mapfre', 'es', null),
  ('zurich', 'zurich', 'es', null),
  ('hdi', 'hdi', 'es', null),
  ('chubb', 'chubb', 'es', null), ('chub', 'chubb', 'es', null)
) as t(term, expands_to, language, country)
on conflict do nothing;

-- ─── Palabras vacías ─────────────────────────────────────────────────────────
-- No aportan a la búsqueda: "la póliza de auto de Pedro" busca {auto} y
-- {pedro}. Igual que los sinónimos, hoy se usan todas sin filtrar por idioma.
create table if not exists search_stopwords (
  word       text not null,   -- normalizada (sin acento, minúsculas)
  language   text not null,
  created_at timestamptz not null default now(),
  primary key (word, language)
);

alter table search_stopwords enable row level security;

drop policy if exists "search_stopwords: read" on search_stopwords;
create policy "search_stopwords: read"
  on search_stopwords for select
  to authenticated
  using (true);

grant select on search_stopwords to authenticated;
grant select, insert, update, delete on search_stopwords to service_role;

insert into search_stopwords (word, language)
select w, 'es' from unnest(array[
  'de','del','la','las','el','los','lo','y','e','o','a','al','en','con','por','para',
  'su','sus','mi','mis','un','una','que','poliza','polizas','seguro','seguros'
]) as w
union all
select w, 'en' from unnest(array[
  'of','the','a','an','and','or','for','with','my','his','her','their',
  'policy','policies','insurance'
]) as w
on conflict do nothing;

-- ─── search_policy_ids ───────────────────────────────────────────────────────
drop function if exists search_policy_ids(uuid, text, uuid, real);

create or replace function search_policy_ids(
  p_agent_id   uuid,
  p_query      text,
  p_contact_id uuid default null,
  p_threshold  real default 0.5
)
returns setof uuid
language plpgsql stable
as $$
declare
  -- Espacios a los lados para reconocer términos como palabras completas.
  v_rest   text  := ' ' || normalize_search_text(p_query) || ' ';
  v_full   text  := normalize_search_text(p_query);
  -- Cada grupo es una palabra (o frase) del asesor que DEBE coincidir:
  --   lit = lo que dijo; syn = alternativas del mismo concepto (vacío si no hay).
  v_groups jsonb := '[]'::jsonb;
  v_fuzzy  boolean;
  r        record;
  v_word   text;
begin
  -- 1) Términos con sinónimo, el más largo primero: "seguro de vida" se
  --    consume entero antes de que "seguro" caiga como palabra vacía y
  --    "gastos medicos mayores" antes que "gastos".
  for r in
    with s as (
      select normalize_search_text(term) as term, normalize_search_text(expands_to) as exp
      from search_synonyms
      where domain = 'policy'   -- todos los idiomas y países (ver comentario de la tabla)
    )
    select s.term,
           array_agg(distinct alt.v) as alts
    from s
    cross join lateral (
      select s.exp
      union
      select s2.term from s s2 where s2.exp = s.exp
    ) as alt(v)
    group by s.term
    order by length(s.term) desc
  loop
    if v_rest ~ ('\m' || r.term || '\M') then
      v_rest   := regexp_replace(v_rest, '\m' || r.term || '\M', ' ', 'g');
      v_groups := v_groups || jsonb_build_array(
                    jsonb_build_object('lit', r.term, 'syn', to_jsonb(r.alts)));
    end if;
  end loop;

  -- 2) Lo que queda, palabra por palabra, sin las palabras vacías
  --    (`search_stopwords`).
  foreach v_word in array string_to_array(btrim(v_rest), ' ') loop
    continue when v_word = '' or exists (
      select 1 from search_stopwords sw where sw.word = v_word  -- todos los idiomas
    );
    v_groups := v_groups || jsonb_build_array(
                  jsonb_build_object('lit', v_word, 'syn', '[]'::jsonb));
  end loop;

  -- 3) Primero exacto; SOLO si no hubo nada, por similitud. Nunca al revés:
  --    una coincidencia exacta no debe diluirse entre parecidos.
  foreach v_fuzzy in array array[false, true] loop
    exit when v_fuzzy and length(v_full) < 3;

    return query
    with cand as (
      select p.id,
             p.updated_at,
             normalize_search_text(p.policy_number) as pnum,
             -- Todo donde el asesor podría estar pensando, en un solo texto.
             ' ' || normalize_search_text(concat_ws(' ',
               p.policy_number, pr.name, ca.name, ca.short_name,
               b.name, replace(coalesce(b.code, ''), '_', ' '),
               p.insured_item, c.full_name, p.notes
             )) || ' ' as h
      from policies p
      left join products pr on pr.id = p.product_id
      left join carriers ca on ca.id = pr.carrier_id
      left join branches b  on b.id  = pr.branch_id
      left join contacts c  on c.id  = p.contact_id
      where p.agent_id = p_agent_id
        and p.is_active
        and (p_contact_id is null or p.contact_id = p_contact_id)
    )
    select cand.id
    from cand
    where coalesce((
      select bool_and(
        -- Palabra sin sinónimo: subcadena, para que un número de póliza
        -- parcial ("4521") encuentre "GM00045210".
        (jsonb_array_length(g->'syn') = 0 and cand.h like '%' || (g->>'lit') || '%')
        -- Con sinónimo: palabra completa, para que "rc" no pegue con "Marcela"
        -- ni "car" con "Carlos".
        or exists (
          select 1 from jsonb_array_elements_text(g->'syn') as a(v)
          where cand.h ~ ('\m' || a.v || '\M')
        )
        -- Rama difusa: solo lo que dijo el asesor (no los sinónimos, que
        -- ampliarían demasiado) y solo palabras de 3+ letras.
        or (v_fuzzy
            and length(g->>'lit') >= 3
            and word_similarity(g->>'lit', cand.h) >= p_threshold)
      )
      from jsonb_array_elements(v_groups) as g
    ), true)  -- sin palabras útiles ("póliza") no filtra, como las otras búsquedas
    order by
      (cand.pnum <> '' and cand.pnum = v_full) desc,                  -- número exacto primero
      (select coalesce(sum(word_similarity(g->>'lit', cand.h)), 0)
         from jsonb_array_elements(v_groups) as g) desc,
      cand.updated_at desc;

    exit when found;
  end loop;
end;
$$;

grant execute on function search_policy_ids(uuid, text, uuid, real) to authenticated;
