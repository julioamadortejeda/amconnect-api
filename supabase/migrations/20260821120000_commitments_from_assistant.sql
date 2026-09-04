-- Los compromisos dejan de nacer de la ingesta de notas y pasan a nacer en el
-- asistente.
--
-- Por qué: una nota es un registro del expediente. Darle el efecto secundario
-- de crear estado accionable la convertía en otra cosa sin avisar, y ya había
-- cobrado dos síntomas —"no se pudo agregar la nota" y el diálogo de nota
-- rápida que se cerraba sin que pareciera pasar nada— porque una acción que
-- era instantánea se puso a esperar a un modelo.
--
-- El valor de la feature nunca estuvo en la extracción automática: está en que
-- `get_commitments` contesta con SQL lo que el RAG no puede contestar. La
-- similitud vectorial no indexa tiempo ni garantiza exhaustividad, así que
-- "¿qué tengo que hacer la próxima semana?" no se parece semánticamente a
-- ninguna nota, y "¿quién me iba a enviar algo?" trae las 5 más parecidas sin
-- forma de saber que faltaron 7. Ese fallo silencioso es lo que la tabla
-- elimina, y eso no depende de dónde se creen las filas.

-- Un compromiso creado desde el asistente no viene de ninguna nota.
alter table client_commitments alter column note_id drop not null;

comment on column client_commitments.note_id is
  'Nota de la que salió el compromiso. NULL cuando lo creó el asistente a partir de lo que el asesor le dijo.';
