-- Realtime para los comentarios de un recordatorio.
--
-- El caso: el asesor abre un recordatorio, le pide a la IA "agrégale como nota
-- que ademas tengo que pasar al banco", el asistente lo guarda... y la pantalla
-- no cambia. Como no ve nada, lo vuelve a dictar. Ahora hay dos comentarios
-- casi identicos y nadie se entero de que el primero si funciono. Reportado el
-- 2026-09-04 con captura de los dos comentarios.
--
-- La tabla no estaba en la publicacion: un canal en la app no habria recibido
-- nada nunca, sin error ni aviso.
--
-- REPLICA IDENTITY FULL como las otras tres tablas con Realtime (reminders,
-- agent_notes, client_commitments). Hoy los comentarios solo se insertan, asi
-- que con el default bastaria; se pone FULL para que el dia que exista un
-- borrado el evento traiga el reminder_id y el filtro del canal pueda
-- reconocerlo. Sin esto un DELETE solo carga la PK y el canal lo ignora en
-- silencio. En una tabla de texto corto y sin updates el costo en WAL es nulo.

alter table reminder_comments replica identity full;

alter publication supabase_realtime add table reminder_comments;
