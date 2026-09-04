-- Realtime para compromisos.
--
-- Sin esto, un compromiso creado por el asistente no aparecía en el dashboard
-- hasta reiniciar la app: los recordatorios sí se actualizan solos y los
-- compromisos no, y esa asimetría hacía ver la feature como descompuesta.

-- Replica identity completa para que UPDATE/DELETE traigan la fila anterior.
ALTER TABLE client_commitments REPLICA IDENTITY FULL;

-- Publicar los cambios de la tabla.
ALTER PUBLICATION supabase_realtime ADD TABLE client_commitments;
