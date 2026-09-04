-- Compromisos: promesas y pendientes que la IA extrae de las notas del asesor.
--
-- Existen porque la búsqueda vectorial no puede contestar preguntas temporales
-- ni enumerativas ("¿a quién busco este mes?"): devuelve las N notas más
-- parecidas, no todas las que aplican, y el asesor no tiene forma de saber que
-- faltaron. Con esta tabla esa pregunta es un SQL exhaustivo.
--
-- `label` es texto libre a propósito — NO un catálogo. Si mañana aparece un tipo
-- de pendiente que no habíamos previsto, la IA simplemente escribe otra etiqueta
-- y no hace falta migración. Lo único rígido es la ventana de fechas y el
-- estado, porque es lo único que se filtra.

create table client_commitments (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id) on delete cascade,

  -- Null cuando la nota se guardó como conocimiento general: el compromiso
  -- existe igual y el nombre vive en `label`/`quote`. La app no intenta
  -- adivinar a qué contacto se refiere.
  contact_id  uuid references contacts(id) on delete cascade,
  policy_id   uuid references policies(id) on delete set null,

  -- Cascade a propósito: si se borra la nota, el compromiso se va con ella.
  -- No pueden quedar filas afirmando cosas cuya fuente ya no existe.
  note_id     uuid not null references agent_notes(id) on delete cascade,

  label       text not null,
  -- Fragmento TEXTUAL de la nota. Sirve para dos cosas: mostrarle al asesor por
  -- qué la app le está diciendo esto, y descartar invenciones antes de insertar
  -- (si la cita no está en la nota, la IA se la inventó).
  quote       text not null,

  -- Ventana, no fecha exacta: "noviembre" no es un día. Nulas cuando la nota no
  -- menciona cuándo — ese compromiso envejece pero nunca sale en consultas por mes.
  due_from    date,
  due_to      date,

  status      text not null default 'OPEN'
    check (status in ('OPEN', 'DONE', 'DISMISSED')),

  -- Por qué se cerró. Lo escribe el asesor en la tarjeta o lo dicta al chat
  -- ("ya me mandó los documentos") y la IA lo guarda aquí.
  resolution_note text,
  resolved_at     timestamptz,

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- La consulta del dashboard y de get_commitments.
create index idx_client_commitments_agenda
  on client_commitments (agent_id, status, due_to)
  where is_active;

create index idx_client_commitments_contact_id
  on client_commitments (contact_id);

create index idx_client_commitments_note_id
  on client_commitments (note_id);

alter table client_commitments enable row level security;

create policy "client_commitments: own records"
  on client_commitments for all
  using (agent_id = auth.uid());

create trigger tg_client_commitments_updated_at
  before update on client_commitments
  for each row
  execute function tgfn_set_updated_at();
