-- ─── Reset completo de datos de un agente ────────────────────────────────────
-- Borra: pólizas, contactos, recordatorios, sesiones de IA, uso de IA,
--        documentos, catálogos propios, vectores de notas.
-- Resetea: uso mensual y suscripción.
-- NO borra: el agente ni el usuario en auth.users.
--
-- Uso: reemplaza el UUID de p_agent_id y ejecuta en el SQL editor de Supabase.

do $$
declare
  p_agent_id uuid := 'REEMPLAZA-CON-EL-UUID-DEL-AGENTE';
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
