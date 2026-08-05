-- El uso del plan (chat_count/ingestion_count) no se actualizaba en vivo en la
-- pantalla de Account: el listener de Flutter escuchaba la tabla `agents`,
-- pero los incrementos/decrementos de uso (UsageRepository.incrementUsage/
-- decrementUsage) escriben en `agent_monthly_usage`, que nunca estuvo en la
-- publicación de Realtime — Postgres nunca transmitía el cambio, sin importar
-- qué escuchara el cliente. El asesor tenía que cerrar y reabrir la app para
-- ver el uso actualizado.

-- Enable full replica identity so UPDATE events include the complete old row.
ALTER TABLE agent_monthly_usage REPLICA IDENTITY FULL;

-- Add agent_monthly_usage to the Realtime publication so INSERT/UPDATE events are broadcast.
ALTER PUBLICATION supabase_realtime ADD TABLE agent_monthly_usage;
