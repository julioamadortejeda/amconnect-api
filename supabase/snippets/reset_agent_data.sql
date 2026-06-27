-- ─── Reset completo de datos de un agente ────────────────────────────────────
-- Borra: pólizas, contactos, recordatorios, sesiones de IA, uso de IA,
--        documentos, catálogos propios, vectores de notas.
-- Resetea: uso mensual y suscripción.
-- NO borra: el agente ni el usuario en auth.users.
--
-- ⚠️  ARCHIVOS EN STORAGE NO INCLUIDOS:
--     Este script borra los registros de document_metadata pero NO elimina
--     los archivos físicos del bucket de Supabase Storage. Los PDFs e imágenes
--     del agente quedan huérfanos en el bucket "policies".
--     Para borrarlos manualmente:
--       1. Ir a Supabase Dashboard → Storage → policies
--       2. Buscar la carpeta del agente (por su UUID) y eliminarla
--     O usar la API de Storage con service role key:
--       await supabase.storage.from('policies').remove([...paths])
--
-- Uso: reemplaza el UUID de p_agent_id y ejecuta en el SQL editor de Supabase.

do $$
declare
  p_agent_id uuid := 'e83559b7-1da5-4076-97ac-609b3dcb2212';
begin

  -- 1. Logs de error (FK SET NULL, borrar para limpiar completamente)
  delete from error_logs where agent_id = p_agent_id;

  -- 2. Uso de ingesta (referencia sessions y document_metadata — borrar primero)
  delete from ai_ingestion_usage where agent_id = p_agent_id;

  -- 3. Sesiones de IA (cascadea → ai_chat_messages + ai_pending_tasks)
  delete from ai_sessions where agent_id = p_agent_id;

  -- 4. Recordatorios (referencian contacts y policies)
  delete from reminders where agent_id = p_agent_id;

  -- 5. Configuración de recordatorios automáticos
  delete from reminder_settings where agent_id = p_agent_id;

  -- 6. Notas del agente y sus chunks (agent_note_chunks cascadea desde agent_notes)
  delete from agent_notes where agent_id = p_agent_id;

  -- 7. Metadatos de documentos (referencian contacts y policies)
  delete from document_metadata where agent_id = p_agent_id;

  -- 8. Pólizas (cascadea → policy_participants + beneficiaries)
  delete from policies where agent_id = p_agent_id;

  -- 9. Contactos
  -- Primero rompemos la auto-referencia de referidos para evitar violación de FK (referred_by_id)
  update contacts set referred_by_id = null where agent_id = p_agent_id;
  delete from contacts where agent_id = p_agent_id;

  -- 10. Catálogos propios del agente
  delete from products where agent_id = p_agent_id;
  delete from branches  where agent_id = p_agent_id;
  delete from carriers  where agent_id = p_agent_id;

  -- 11. Uso mensual — borrar todas las filas del historial
  delete from agent_monthly_usage where agent_id = p_agent_id;

  -- 12. Resetear suscripción a trial (14 días desde ahora)
  update agents
  set
    subscription_status      = 'trial',
    trial_ends_at            = now() + interval '14 days',
    subscription_expires_at  = null,
    promo_code_used          = null,
    updated_at               = now()
  where id = p_agent_id;

  raise notice 'Reset completado para agente %', p_agent_id;
end;
$$;
