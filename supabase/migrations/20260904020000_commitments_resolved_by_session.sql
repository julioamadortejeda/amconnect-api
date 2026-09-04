-- ─── Quien cerro el compromiso: el asesor o el asistente ─────────────────────
--
-- `close_commitment` se rehusa a cerrar un segundo compromiso justo despues del
-- primero, para que el modelo no cierre en cadena lo que el asesor no pidio
-- (produccion, 2026-09-04: dijo "ya me entrego su INE" y el modelo cerro ese Y
-- "Esperando documento de Julio", razonando que una INE es un documento).
--
-- La primera version contaba por `agent_id` + `resolved_at`, y eso confundia
-- dos cosas muy distintas: que el MODELO acabara de cerrar uno, y que el ASESOR
-- acabara de cerrar uno con la palomita de la Agenda. En el segundo caso se
-- rechazaba el primer cierre del asistente, que era perfectamente valido.
--
-- Con esta columna la cuenta se acota a la sesion de IA que esta hablando:
--
--   NULL  -> lo cerro el asesor a mano (palomita de la Agenda, REST)
--   uuid  -> lo cerro el asistente, en esa sesion
--
-- Sin FK a ai_sessions a proposito: las sesiones se pueden purgar y no quiere
-- decir que el compromiso deje de estar cerrado. Es trazabilidad, no relacion.

alter table client_commitments
  add column if not exists resolved_by_session_id uuid;

comment on column client_commitments.resolved_by_session_id is
  'Sesion de IA que cerro el compromiso. NULL = lo cerro el asesor a mano.';

-- Solo se consulta por sesion y ventana reciente, nunca a secas.
create index if not exists idx_client_commitments_resolved_by_session
  on client_commitments (resolved_by_session_id, resolved_at)
  where resolved_by_session_id is not null;
