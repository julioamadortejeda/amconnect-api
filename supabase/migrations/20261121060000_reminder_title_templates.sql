-- ─── Recordatorios automáticos: plantilla en vez de título congelado (D-023) ──
--
-- EL PROBLEMA
-- El job nocturno escribía el título ya resuelto: "Pago de Prima ·
-- GMM-2026-10451". La asesora (2026-11-20) no sabe de quién es esa póliza por
-- el número, y el título quedaba en el idioma del día en que se generó.
-- Además el recordatorio de una póliza se guardaba con `contact_id` nulo, así
-- que la agenda no mostraba al cliente ("👤 …") como en los manuales, buscar
-- "pago Rosa" no lo encontraba y no aparecía en la agenda de esa clienta.
--
-- LA SOLUCIÓN
-- 1. `title_template` (PAYMENT_DUE | RENEWAL | ANNIVERSARY | BIRTHDAY) y
--    `template_data` (jsonb: dueDate, amount, currency — nada que dependa del
--    idioma, y NO nombres: producto, ramo y cliente se leen de la póliza y del
--    contacto al mostrarlo). El backend arma el título al leer, en el idioma
--    del asesor (`agents.locale`), con UNA sola tabla de textos
--    (`reminder_title.renderer.ts`) para REST, asistente y push. `title` se
--    sigue escribiendo como respaldo para clientes viejos.
-- 2. Si el asesor edita el título, el service borra `title_template` y queda
--    su texto (D-021).
-- 3. Los automáticos de póliza guardan también al titular en `contact_id`.
-- 4. Backfill de lo existente (ver `backfill_reminder_title_templates`).
-- 5. `search_reminder_ids` busca también por cliente, póliza, producto, ramo y
--    tipo, con sinónimos ("pago", "payment", "cobro" → PAYMENT), igual que la
--    búsqueda de pólizas (20261121002454).
--
-- Re-ejecutable: se aplica a mano con psql en local.

-- ─── 1. Columnas ─────────────────────────────────────────────────────────────
alter table reminders add column if not exists title_template text;
alter table reminders add column if not exists template_data jsonb;

alter table reminders drop constraint if exists reminders_title_template_check;
alter table reminders add constraint reminders_title_template_check
  check (title_template is null or title_template in ('PAYMENT_DUE', 'RENEWAL', 'ANNIVERSARY', 'BIRTHDAY'));

comment on column reminders.title_template is
  'Recordatorio automático (D-023): plantilla del título, armado al leer en el idioma del asesor. Null = el título es texto del asesor.';
comment on column reminders.template_data is
  'Datos de la plantilla que no dependen del idioma: {dueDate, amount?, currency?}. Los nombres se leen de policy_id/contact_id.';

-- ─── 2-4. Backfill ───────────────────────────────────────────────────────────
-- Función y no un UPDATE suelto para poder probarla sobre un fixture (pgTAP) y
-- volver a correrla en prod si hiciera falta. Solo toca:
--   * `contact_id` de automáticos de póliza que no lo tienen → el titular.
--   * `title_template` de automáticos cuyo título sigue EXACTAMENTE como lo
--     escribió el job viejo, en español o en inglés, con el número de póliza o
--     el nombre del contacto actuales. Uno que el asesor reescribió no
--     coincide y se deja en paz (D-021); si el número o el nombre cambiaron
--     desde entonces tampoco coincide, y queda con su título viejo: ese es el
--     lado seguro.
create or replace function backfill_reminder_title_templates()
returns table (contacts_linked integer, templates_set integer)
language plpgsql
set search_path = public
as $$
declare
  v_contacts  integer;
  v_templates integer;
begin
  update reminders r
     set contact_id = p.contact_id
    from policies p
   where p.id = r.policy_id
     and p.agent_id = r.agent_id
     and r.occurrence_date is not null
     and r.contact_id is null
     and p.contact_id is not null;
  get diagnostics v_contacts = row_count;

  with candidates as (
    select r.id,
           case
             when rt.code = 'PAYMENT' and r.title in (
                    'Pago de Prima · ' || coalesce(p.policy_number, 'póliza'),
                    'Premium Payment · ' || coalesce(p.policy_number, 'póliza')) then 'PAYMENT_DUE'
             when rt.code = 'RENEWAL' and r.title in (
                    'Renovación · ' || coalesce(p.policy_number, 'póliza'),
                    'Renewal · ' || coalesce(p.policy_number, 'póliza')) then 'RENEWAL'
             when rt.code = 'ANNIVERSARY' and r.title in (
                    'Aniversario · ' || coalesce(p.policy_number, 'póliza'),
                    'Anniversary · ' || coalesce(p.policy_number, 'póliza')) then 'ANNIVERSARY'
             when rt.code = 'BIRTHDAY' and r.policy_id is null and r.title in (
                    'Cumpleaños · ' || coalesce(c.full_name, 'cliente'),
                    'Birthday · ' || coalesce(c.full_name, 'cliente')) then 'BIRTHDAY'
           end as tpl,
           r.occurrence_date,
           p.premium,
           cu.code as currency
      from reminders r
      join reminder_types rt on rt.id = r.type_id
      left join policies p   on p.id = r.policy_id
      left join currencies cu on cu.id = p.currency_id
      left join contacts c   on c.id = r.contact_id
     where r.occurrence_date is not null
       and r.title_template is null
  )
  update reminders r
     set title_template = c.tpl,
         template_data  = jsonb_strip_nulls(jsonb_build_object(
           'dueDate',  to_char(c.occurrence_date, 'YYYY-MM-DD'),
           'amount',   case when c.tpl = 'PAYMENT_DUE' then c.premium end,
           'currency', case when c.tpl = 'PAYMENT_DUE' and c.premium is not null then c.currency end
         ))
    from candidates c
   where c.id = r.id
     and c.tpl is not null;
  get diagnostics v_templates = row_count;

  return query select v_contacts, v_templates;
end;
$$;

-- Solo para migraciones y el SQL Editor: no es una operación del asesor.
revoke execute on function backfill_reminder_title_templates() from public, anon, authenticated;

select * from backfill_reminder_title_templates();

-- ─── insert_generated_reminders: escribe plantilla y datos ───────────────────
-- Misma firma y mismo retorno que 20261121002508; solo agrega las dos columnas.
create or replace function insert_generated_reminders(p_rows jsonb)
returns table (id uuid, type_id uuid, occurrence_date date, title text,
               due_date timestamptz, is_active boolean, is_new boolean)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with input as (
    select *
      from jsonb_to_recordset(p_rows) as x(
        agent_id uuid, policy_id uuid, contact_id uuid, type_id uuid,
        title text, title_template text, template_data jsonb, description text,
        due_date timestamptz, occurrence_date date, status_id uuid
      )
  ),
  ins as (
    insert into reminders as r (
      agent_id, policy_id, contact_id, type_id, title, title_template, template_data,
      description, due_date, occurrence_date, status_id
    )
    select i.agent_id, i.policy_id, i.contact_id, i.type_id, i.title, i.title_template, i.template_data,
           i.description, i.due_date, i.occurrence_date, i.status_id
      from input i
    on conflict (agent_id, type_id, (coalesce(policy_id, contact_id)), occurrence_date)
       where occurrence_date is not null
       do nothing
    returning r.id, r.type_id, r.occurrence_date, r.title, r.due_date
  )
  select ins.id, ins.type_id, ins.occurrence_date, ins.title, ins.due_date, true, true
    from ins
  union all
  -- Las que ya existían (el snapshot del statement no ve las recién insertadas).
  select r.id, r.type_id, r.occurrence_date, r.title, r.due_date, r.is_active, false
    from input i
    join reminders r
      on r.agent_id = i.agent_id
     and r.type_id = i.type_id
     and coalesce(r.policy_id, r.contact_id) = coalesce(i.policy_id, i.contact_id)
     and r.occurrence_date = i.occurrence_date
   where not exists (
     select 1 from ins
      where ins.type_id = i.type_id
        and ins.occurrence_date = i.occurrence_date
   );
end;
$$;

-- ─── 5. Búsqueda de recordatorios ────────────────────────────────────────────
-- Sinónimos del TIPO. El concepto es el código del tipo leído como palabras
-- (FOLLOW_UP → "follow up"), que es lo que entra al texto buscable.
insert into search_synonyms (term, expands_to, domain, language, country)
select t.term, t.expands_to, 'reminder', t.language, null
from (values
  ('pago', 'payment', 'es'), ('pagos', 'payment', 'es'), ('cobro', 'payment', 'es'),
  ('cobros', 'payment', 'es'), ('cobranza', 'payment', 'es'), ('cobrar', 'payment', 'es'),
  ('payment', 'payment', 'en'), ('payments', 'payment', 'en'), ('premium', 'payment', 'en'),
  ('renovacion', 'renewal', 'es'), ('renovaciones', 'renewal', 'es'), ('renovar', 'renewal', 'es'),
  ('renewal', 'renewal', 'en'), ('renewals', 'renewal', 'en'),
  ('cumpleanos', 'birthday', 'es'), ('cumple', 'birthday', 'es'),
  ('birthday', 'birthday', 'en'), ('birthdays', 'birthday', 'en'),
  ('aniversario', 'anniversary', 'es'), ('aniversarios', 'anniversary', 'es'),
  ('anniversary', 'anniversary', 'en'),
  ('llamada', 'call', 'es'), ('llamadas', 'call', 'es'), ('llamar', 'call', 'es'),
  ('call', 'call', 'en'), ('calls', 'call', 'en'),
  ('cita', 'appointment', 'es'), ('citas', 'appointment', 'es'), ('reunion', 'appointment', 'es'),
  ('appointment', 'appointment', 'en'), ('meeting', 'appointment', 'en'),
  ('seguimiento', 'follow up', 'es'), ('follow up', 'follow up', 'en'), ('followup', 'follow up', 'en'),
  ('cancelacion', 'cancellation', 'es'), ('cancellation', 'cancellation', 'en')
) as t(term, expands_to, language)
on conflict do nothing;

-- Mismo algoritmo que `search_policy_ids`: cada palabra (o frase con sinónimo)
-- debe aparecer en algún campo, sin acentos y en cualquier orden; primero
-- exacto y SOLO si no hubo nada, por similitud. Sinónimos de recordatorio Y de
-- póliza ("gmm" → el ramo "Gastos Médicos Mayores").
--
-- Antes solo miraba `title` + `description`: el título del automático era el
-- número de póliza, así que "pago Rosa" no encontraba el pago de Rosa.
--
-- SECURITY INVOKER (default): el RLS del asesor aplica a todas las tablas.
create or replace function search_reminder_ids(p_agent_id uuid, p_query text, p_threshold real default 0.5)
returns setof uuid
language plpgsql
stable
as $$
declare
  v_rest   text  := ' ' || normalize_search_text(p_query) || ' ';
  v_full   text  := normalize_search_text(p_query);
  v_groups jsonb := '[]'::jsonb;
  v_fuzzy  boolean;
  r        record;
  v_word   text;
begin
  -- 1) Términos con sinónimo, el más largo primero.
  for r in
    with s as (
      select normalize_search_text(term) as term, normalize_search_text(expands_to) as exp
      from search_synonyms
      where domain in ('reminder', 'policy')
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

  -- 2) Lo que queda, palabra por palabra, sin palabras vacías.
  foreach v_word in array string_to_array(btrim(v_rest), ' ') loop
    continue when v_word = '' or exists (
      select 1 from search_stopwords sw where sw.word = v_word
    );
    v_groups := v_groups || jsonb_build_array(
                  jsonb_build_object('lit', v_word, 'syn', '[]'::jsonb));
  end loop;

  -- 3) Primero exacto; solo si no hubo nada, por similitud.
  foreach v_fuzzy in array array[false, true] loop
    exit when v_fuzzy and length(v_full) < 3;

    return query
    with cand as (
      select rem.id,
             ' ' || normalize_search_text(concat_ws(' ',
               rem.title, rem.description, c.full_name,
               p.policy_number, pr.name, b.name, replace(coalesce(b.code, ''), '_', ' '),
               replace(rt.code, '_', ' '), rt.name
             )) || ' ' as h
      from reminders rem
      join reminder_types rt on rt.id = rem.type_id
      left join contacts c   on c.id  = rem.contact_id
      left join policies p   on p.id  = rem.policy_id
      left join products pr  on pr.id = p.product_id
      left join branches b   on b.id  = pr.branch_id
      where rem.agent_id = p_agent_id
        and rem.is_active
    )
    select cand.id
    from cand
    where coalesce((
      select bool_and(
        (jsonb_array_length(g->'syn') = 0 and cand.h like '%' || (g->>'lit') || '%')
        or exists (
          select 1 from jsonb_array_elements_text(g->'syn') as a(v)
          where cand.h ~ ('\m' || a.v || '\M')
        )
        or (v_fuzzy
            and length(g->>'lit') >= 3
            and word_similarity(g->>'lit', cand.h) >= p_threshold)
      )
      from jsonb_array_elements(v_groups) as g
    ), true);

    exit when found;
  end loop;
end;
$$;

grant execute on function search_reminder_ids(uuid, text, real) to authenticated;
