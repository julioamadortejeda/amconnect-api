-- ─── Referencias cruzadas entre asesores (SOLO LECTURA) ──────────────────────
--
-- Correr en el SQL Editor de producción ANTES de desplegar la migración
-- `*_tenant_integrity.sql`. No escribe nada: solo cuenta.
--
-- Qué busca: filas de un asesor que apuntan a un registro de OTRO asesor.
-- La FK de Postgres solo revisaba que el padre existiera, no de quién era.
-- Ejemplo real (2026-11-20, local): 15 pólizas del asesor de pruebas apuntaban
-- a productos de otro asesor; el RLS escondía el producto y la app mostraba
-- "—" como nombre de producto.
--
-- Resultado:
--   relation      hijo.columna -> padre
--   child_agent   el asesor dueño de la fila que apunta
--   parent_agent  el asesor dueño del registro al que apunta
--   rows          cuántas filas
--   sample_ids    hasta 5 ids de la fila hija, para revisarlas a mano
--
-- Sin filas = la migración valida todas sus FKs en el acto.
-- Con filas = la migración se aplica igual (las FKs protegen las escrituras
-- nuevas desde ese momento), pero las relaciones con datos viejos quedan
-- NOT VALID y la migración lo avisa con un WARNING. Corregir esas filas
-- (decidir a mano cuál es el dato bueno; no hay regla automática segura) y
-- luego correr el `alter table ... validate constraint ...` que imprime el WARNING.

with v(relation, child_id, child_agent, parent_agent) as (
            select 'products.branch_id -> branches', c.id, c.agent_id, p.agent_id
              from products c join branches p on p.id = c.branch_id
             where p.agent_id is distinct from c.agent_id
  union all select 'products.carrier_id -> carriers', c.id, c.agent_id, p.agent_id
              from products c join carriers p on p.id = c.carrier_id
             where p.agent_id is distinct from c.agent_id
  union all select 'contacts.referred_by_id -> contacts', c.id, c.agent_id, p.agent_id
              from contacts c join contacts p on p.id = c.referred_by_id
             where p.agent_id is distinct from c.agent_id
  union all select 'policies.contact_id -> contacts', c.id, c.agent_id, p.agent_id
              from policies c join contacts p on p.id = c.contact_id
             where p.agent_id is distinct from c.agent_id
  union all select 'policies.product_id -> products', c.id, c.agent_id, p.agent_id
              from policies c join products p on p.id = c.product_id
             where p.agent_id is distinct from c.agent_id
  union all select 'policy_participants.contact_id -> contacts (via policies)', c.id, pol.agent_id, p.agent_id
              from policy_participants c
              join policies pol on pol.id = c.policy_id
              join contacts p on p.id = c.contact_id
             where p.agent_id is distinct from pol.agent_id
  union all select 'reminders.contact_id -> contacts', c.id, c.agent_id, p.agent_id
              from reminders c join contacts p on p.id = c.contact_id
             where p.agent_id is distinct from c.agent_id
  union all select 'reminders.policy_id -> policies', c.id, c.agent_id, p.agent_id
              from reminders c join policies p on p.id = c.policy_id
             where p.agent_id is distinct from c.agent_id
  union all select 'reminder_settings.branch_id -> branches', c.id, c.agent_id, p.agent_id
              from reminder_settings c join branches p on p.id = c.branch_id
             where p.agent_id is distinct from c.agent_id
  union all select 'reminder_comments.reminder_id -> reminders', c.id, c.agent_id, p.agent_id
              from reminder_comments c join reminders p on p.id = c.reminder_id
             where p.agent_id is distinct from c.agent_id
  union all select 'reminder_notifications.reminder_id -> reminders', c.id, c.agent_id, p.agent_id
              from reminder_notifications c join reminders p on p.id = c.reminder_id
             where p.agent_id is distinct from c.agent_id
  union all select 'client_commitments.contact_id -> contacts', c.id, c.agent_id, p.agent_id
              from client_commitments c join contacts p on p.id = c.contact_id
             where p.agent_id is distinct from c.agent_id
  union all select 'agent_notes.contact_id -> contacts', c.id, c.agent_id, p.agent_id
              from agent_notes c join contacts p on p.id = c.contact_id
             where p.agent_id is distinct from c.agent_id
  union all select 'agent_notes.policy_id -> policies', c.id, c.agent_id, p.agent_id
              from agent_notes c join policies p on p.id = c.policy_id
             where p.agent_id is distinct from c.agent_id
  union all select 'agent_notes.reminder_id -> reminders', c.id, c.agent_id, p.agent_id
              from agent_notes c join reminders p on p.id = c.reminder_id
             where p.agent_id is distinct from c.agent_id
  union all select 'agent_notes.document_metadata_id -> document_metadata', c.id, c.agent_id, p.agent_id
              from agent_notes c join document_metadata p on p.id = c.document_metadata_id
             where p.agent_id is distinct from c.agent_id
  union all select 'agent_note_chunks.note_id -> agent_notes', c.id, c.agent_id, p.agent_id
              from agent_note_chunks c join agent_notes p on p.id = c.note_id
             where p.agent_id is distinct from c.agent_id
  union all select 'ai_chat_messages.session_id -> ai_sessions', c.id, c.agent_id, p.agent_id
              from ai_chat_messages c join ai_sessions p on p.id = c.session_id
             where p.agent_id is distinct from c.agent_id
  union all select 'ai_pending_tasks.session_id -> ai_sessions', c.id, c.agent_id, p.agent_id
              from ai_pending_tasks c join ai_sessions p on p.id = c.session_id
             where p.agent_id is distinct from c.agent_id
  union all select 'tokens_usage.session_id -> ai_sessions', c.id, c.agent_id, p.agent_id
              from tokens_usage c join ai_sessions p on p.id = c.session_id
             where p.agent_id is distinct from c.agent_id
  union all select 'tokens_usage.note_id -> agent_notes', c.id, c.agent_id, p.agent_id
              from tokens_usage c join agent_notes p on p.id = c.note_id
             where p.agent_id is distinct from c.agent_id
  union all select 'tokens_usage.document_metadata_id -> document_metadata', c.id, c.agent_id, p.agent_id
              from tokens_usage c join document_metadata p on p.id = c.document_metadata_id
             where p.agent_id is distinct from c.agent_id
)
select relation, child_agent, parent_agent, count(*) as rows,
       (array_agg(child_id order by child_id))[1:5] as sample_ids
  from v
 group by relation, child_agent, parent_agent
 order by relation, rows desc;
