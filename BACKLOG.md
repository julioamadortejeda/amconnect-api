# Backend — Backlog de mejoras (Code Review)

Estado: `[ ]` pendiente · `[~]` en progreso · `[x]` resuelto · `[-]` descartado

---

## 🔴 Bugs activos

### B1 — Race condition en quota check/decrement
**Archivos:** `modules/subscription/usage.service.ts`
**Problema:** `checkAndIncrementChat/Ingestion` hacía read-then-check-then-increment en TS. Dos requests concurrentes podían pasar el check antes de que cualquiera incrementara, permitiendo exceder la cuota.
**Fix aplicado (migración `20260609003953_atomic_quota_check`):**
- `increment_monthly_usage(uuid, text, int)` — nueva firma con `p_limit`. Hace `SELECT FOR UPDATE` + check + `UPDATE` en una sola transacción PG. Lanza `RAISE EXCEPTION 'quota_exceeded'` si se excede.
- `decrement_monthly_usage(uuid, text)` — nueva función SQL con `GREATEST(count-1, 0)`.
- `UsageRepository` — `incrementUsage(agentId, field, limit)` devuelve `{ data, error }`. Agrega `decrementUsage`. Elimina `updateChatCount`/`updateIngestionCount`.
- `UsageService` — `checkAndIncrement*` detecta `error.message === 'quota_exceeded'`. `decrement*` llama la RPC directamente.
**Estado:** `[x]`

### B2 — Race condition en `applyPromoCode`
**Archivos:** `modules/subscription/subscription.service.ts`
**Problema:** Dos requests simultáneos con el mismo código podían pasar el check de `maxUses` antes de que se incrementara el contador.
**Fix aplicado (migración `20260609010520_atomic_apply_promo_code`):**
- `apply_promo_code(uuid, text)` — función SQL con `SELECT FOR UPDATE` en `promo_codes`. Valida expiración y límite de usos, actualiza agente y contador en la misma transacción. Lanza `promo_not_found`, `promo_expired`, `promo_max_uses_reached`.
- `SubscriptionRepository` — reemplaza `findActivePromoCode` + `updateAgentTrial` + `incrementPromoUseCount` por un único método `applyPromoCode(agentId, code)`.
- `SubscriptionService.applyPromoCode` — sin lógica de validación en TS, solo detecta errores por mensaje.
**Estado:** `[x]`

---

## 🔴 Seguridad

### S1 — `cancelSession` sin ownership check
**Archivos:** `features/ai_chat/ai_chat.service.ts:67-85`, `http/controllers/ai.controller.ts`
**Problema:** Las queries de `cancelSession` no filtran por `agent_id`. Revisado: `ai_sessions` y `ai_pending_tasks` tienen RLS con `agent_id = auth.uid()`, por lo que el cliente autenticado no puede afectar sesiones ajenas. **El RLS protege esto — no es un bug real con el cliente autenticado.**
**Estado:** `[-]` descartado — RLS cubre el caso

### S2 — `processDocument` acepta JSON sin validación Zod
**Archivos:** `http/controllers/ai.controller.ts`, `features/ai_chat/ai.dto.ts`
**Fix aplicado:** `AiProcessDocumentRequestSchema` agregado a `ai.dto.ts`. Controller usa `.safeParse()` igual que el resto.
**Estado:** `[x]`

### S3 — CORS abierto en producción
**Archivos:** `index.ts`
**Fix aplicado:** Lee `ALLOWED_ORIGIN` del entorno. Si está definida restringe el origen; si no (dev local), cors queda abierto. Agregar `ALLOWED_ORIGIN=https://dominio.com` en las variables de producción de Supabase.
**Estado:** `[x]`

### S4 — `QuotaExceededError` (429) se guarda en `error_logs`
**Archivos:** `http/middleware/error.middleware.ts`
**Fix aplicado:** `429` agregado a `CLIENT_ERROR_CODES`.
**Estado:** `[x]`

### S5 — `getByContact` no valida ownership del contactId
**Archivos:** `http/controllers/policy.controller.ts`
**Estado:** `[-]` descartado — RLS con `agent_id = auth.uid()` cubre el caso. Query extra en TS no agrega valor real.

---

## 🟡 Rendimiento / llamadas innecesarias

### P1 — Dos queries a `agents` por cada request en DI
**Archivos:** `http/middleware/di/index.ts`
**Fix aplicado:** Resuelto como efecto de B1. `getPlanContext` eliminado del DI — ya no se necesita traer límites a TypeScript porque el RPC `increment_monthly_usage` los consulta internamente. Solo queda `checkSubscriptionActive`.
**Estado:** `[x]`

### P2 — `documentProcessorService`, `knowledgeIngestionService`, `policyIngestionService` crean instancia nueva en cada acceso
**Archivos:** `http/middleware/di/index.ts`
**Fix aplicado:** Aplicado el mismo patrón lazy getter con `let` + `get*()` para los 4 servicios y `docProvider`. `buildDocProvider()` se llama máximo una vez por request.
**Estado:** `[x]`

### P3 — `RagService.searchNotes` filtra `contactId`/`policyId` en memoria
**Archivos:** `features/rag/rag.repository.ts`, `features/rag/rag.service.ts`
**Fix aplicado:** `RagRepository.searchNoteChunks` encadena `.eq()` PostgREST sobre el RPC cuando `contactId`/`policyId` están presentes. El filtro en memoria del service eliminado.
**Estado:** `[x]`

### P4 — `getAll` con límite hardcodeado de 100 sin paginación
**Archivos:** `core/base_repository.ts:28`
**Problema:** `getAll(limit = 100)` trunca silenciosamente sin indicarlo al cliente. Un agente con >100 contactos/pólizas no ve todos sus registros.
**Fix aplicado:**
- `PaginatedResult<T>` + `paginate` en `IRepository` y `SupabaseRepository`. Lanza data query + count en `Promise.all` paralelo.
- `BaseService.paginate` delega al repositorio.
- `ContactService`, `PolicyService`, `ReminderService` — override `paginate` para aplicar `toDTO` al array resultante.
- `ContactController`, `PolicyController`, `ReminderController` — `getAll` acepta `?page=&pageSize=` (default 20, cap 100). Responde `{ data, total, page, pageSize, hasMore }`.
**Estado:** `[x]`

### P5 — `ReminderService.update` hace doble query al guardar
**Archivos:** `modules/reminder/reminder.service.ts:63-138`
**Problema:** `this.repository.update(id, updatePayload)` (método base de `SupabaseRepository`) ya devuelve la fila completa con joins vía `.select(this.selectString).single()` — el mismo `REMINDER_SELECT` con `type`, `status`, `contact`, `policy`, `comments` y `notes` (con `document_metadata` anidado). Pero el resultado se descarta y la función cierra con `return this.getById(id)`, que repite esa misma query pesada. Cada PATCH a un recordatorio (ej. asignar cliente/póliza desde la app) paga dos round-trips a Postgres con múltiples joins en vez de uno — es la causa medida de los ~1-2s de delay visible en la app al reasignar cliente/póliza desde `ReminderDetailScreen`.
**Fix:** Devolver directamente el resultado de `this.repository.update(id, updatePayload)` (via `toDTO`) cuando `Object.keys(updatePayload).length > 0`; solo caer a `getById(id)` cuando el único cambio fue un comentario (`updatePayload` vacío, ya que `reminder_comments` es una tabla aparte y el `update()` no se ejecuta en ese caso).
**Estado:** `[ ]`

---

## 🟡 Estructura / violaciones al patrón

### E1 — `AiChatService` recibe `SupabaseClient` directamente
**Archivos:** `features/ai_chat/ai_chat.service.ts:59-63`
**Problema:** Hace queries directas a `ai_pending_tasks` y `ai_sessions` sin repository. Viola el patrón del proyecto.
**Fix aplicado:**
- `AiSessionRepository` — 4 nuevos métodos: `getSessionContext`, `cancelPendingTasksBySession`, `getActivePendingTasks`. Interface `PendingTaskRow`.
- `AiSessionService` — 3 nuevos métodos: `cancelSession` (corre cancel tasks + update session en paralelo), `getSessionContext`, `getActivePendingTasks`.
- `AiChatService` — `SupabaseClient` eliminado del constructor. `cancelSession` delega a `aiSessionService`. `processMessage` usa `getSessionContext` + `getActivePendingTasks`.
- `di/index.ts` — `supabase` removido del constructor de `AiChatService`.
**Estado:** `[x]`

### E2 — Default model name hardcodeado en dos lugares
**Archivos:** `features/ai_chat/ai_session.service.ts:34`, `http/middleware/di/index.ts:41`
**Problema:** `"gemini-3.1-flash-lite"` como default aparece en ambos archivos. Si cambia el modelo default hay que actualizarlo en dos lugares.
**Fix aplicado:** `shared/config.ts` — `AI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite"`. Ambos archivos importan `AI_MODEL`. Agregar `GEMINI_MODEL=...` en `.env.local` y en las variables de entorno de Supabase.
**Estado:** `[x]`

### E3 — `count` en `SupabaseRepository` ignora filtros `null`
**Archivos:** `core/base_repository.ts:165-170`
**Problema:** `if (value !== undefined) query = (query as any).eq(field, value)` — si `value` es `null`, no aplica el filtro. `findByFilters` sí maneja `null` con `.is(field, null)`. Inconsistencia entre los dos métodos.
**Fix aplicado:** `count` ahora tiene el mismo bloque `if null → .is() / else if not undefined → .eq()` que `findByFilters`.
**Estado:** `[x]`

---

## 🟡 Casos borde no evaluados

### C1 — `cancelSession` devuelve 200 aunque la sesión no exista
**Archivos:** `features/ai_chat/ai_chat.service.ts:66-85`
**Problema:** Si el `sessionId` no existe, la update no hace nada pero el endpoint devuelve `{ cancelled: true }` con 200.
**Fix aplicado:** `AiSessionService.cancelSession` llama `getSessionContext` primero. Si retorna `null`, lanza `AppError("Sesión no encontrada.", 404)`. Si existe, corre cancelación en paralelo.
**Estado:** `[x]`

### C2 — Sin rollback si `trackIngestionUsage` falla después de `saveDocument`
**Archivos:** `features/document_processing/knowledge_ingestion.service.ts`, `features/document_processing/policy_ingestion.service.ts`
**Problema:** Si `saveDocument` pasa OK pero `trackIngestionUsage` falla, los embeddings quedan en DB sin registro de costo.
**Estado:** `[-]` descartado — La Edge Function y la DB corren en la misma instancia de Supabase. Si la DB falla para `trackIngestionUsage`, ya habría fallado antes en `saveDocument`. El escenario es imposible en este deployment.

### C3 — `forceNextTurnToGenerateText` no se resetea si hay múltiples skills en el mismo turno
**Archivos:** `features/ai_chat/ai_chat.service.ts:173, 239-243`
**Problema:** Si un turno tiene múltiples function calls y `search_knowledge` devuelve vacío, `forceNextTurnToGenerateText = true` se activa aunque otras skills del mismo turno devuelvan datos útiles.
**Estado:** `[-]` descartado — El comportamiento es intencional. Activar el flag apenas una búsqueda devuelve vacío fuerza al modelo a responder al usuario de inmediato, evitando loops. Si se cambiara a "solo cuando TODAS las búsquedas están vacías", el AI podría seguir llamando más tools antes de preguntar (ej: contacto con nombre ambiguo donde se esperan múltiples resultados).

---

## 🔴 Bugs activos (segunda revisión)

### N1 — `DocumentProcessorService` llamaba `saveNote()` inexistente
**Archivos:** `features/document_processing/document_processor.service.ts:42`
**Problema:** `this.embeddingsService.saveNote()` no existe — `EmbeddingsService` solo tiene `saveDocument()`. Falla con TypeError en runtime al llamar `POST /ai/process-document`.
**Fix aplicado:** Reemplazado por `saveDocument()` con `sourceType: "pdf"` y `documentMetadataId` correctos.
**Estado:** `[x]`

---

## 🟡 Inconsistencias / deuda técnica (segunda revisión)

### N2 — `getById` firma dice `T | null` pero nunca devuelve null
**Archivos:** `core/base_repository.ts:39-48`
**Problema:** La firma dice `Promise<T | null>` pero si no existe la fila, `handleSupabaseError` lanza `AppError` — nunca retorna `null`. Los servicios tienen código muerto del tipo `row ? this.toDTO(row) : null` que nunca alcanza el `null`.
**Fix:** Cambiar la firma a `Promise<T>` (lanza en not-found) o hacer que el método capture `PGRST116` y retorne `null` según el caso de uso.
**Estado:** `[ ]`

### N3 — `getUpcoming` filtra fechas en memoria
**Archivos:** `modules/reminder/reminder.service.ts:77-85`
**Problema:** Trae todos los recordatorios del agente a memoria y filtra por rango de fechas en TypeScript. Con muchos recordatorios escala mal.
**Fix:** Agregar método en `ReminderRepository` con `.gte("due_date", from).lte("due_date", to)` para hacer el filtro en DB.
**Estado:** `[ ]`

### N4 — `getActivePendingTasks` se llama en cada mensaje incluso en `policy_ingestion`
**Archivos:** `features/ai_chat/ai_chat.service.ts`
**Problema:** En sesiones `policy_ingestion` nunca hay pending tasks del tipo normal, pero igual se hace la query en cada mensaje.
**Fix:** Omitir la llamada cuando `sessionType === "policy_ingestion"`.
**Estado:** `[ ]`

---

## 🟡 Voice/Live Chat (Optimización y Mejores Prácticas)

### V1 — Configuración de Idioma Nativo y Voz Preestablecida
**Archivos:** `amconnect-app/amconnect/lib/features/chat/providers/voice_chat_provider.dart`
**Problema:** El cliente no configuraba explícitamente el código de idioma ni la voz en el setup del WebSocket de Gemini Live API, lo que podía provocar respuestas en inglés o con acentos no consistentes.
**Fix aplicado:** Se agregaron `speechConfig` con la voz `Puck` y se configuró `languageCodes: ['es-419']` en `inputAudioTranscription` y `outputAudioTranscription` dentro del `setupMessage` de la app.
**Estado:** `[x]`

### V2 — Reanudación Nativa de Sesión (Session Resumption)
**Archivos:** `amconnect-app/amconnect/lib/features/chat/providers/voice_chat_provider.dart`, `backend/supabase/functions/amconnect-api`
**Problema:** En caso de desconexiones del socket, el cliente hace una reconexión completa y el backend reinyecta todo el historial de chat de la base de datos de Supabase en formato de texto plano dentro de la instrucción de sistema, lo cual incrementa el consumo de tokens y los costos de facturación por turno.
**Fix sugerido:** Implementar la reanudación nativa utilizando `SessionResumptionConfig` en el setup, almacenar el `session_resumption_update` en la app cliente ante eventos de red y presentarlo en reconexiones para que el contexto sea retenido internamente por Gemini sin costo.
**Estado:** `[ ]`

---

## 🟡 Nuevos Requerimientos de Negocio (Backend)

### R1 — Histórico de Pólizas (Renovaciones anuales)
**Archivos:** `backend/supabase/functions/amconnect-api`
**Problema:** Soportar un histórico de versiones de pólizas anuales para un mismo bien (e.g. auto, gastos médicos mayores) vinculando las renovaciones mediante una relación parent/previous_policy_id en la base de datos y exponiendo los métodos para consultar la línea de tiempo.
**Estado:** `[ ]`

### R2 — Manejo de Asistentes para Agentes
**Archivos:** `backend/supabase/functions/amconnect-api`
**Problema:** Implementar perfiles de asistente vinculados a las cuentas de los asesores de seguros (agentes), permitiendo compartir el acceso a la cartera de clientes y pólizas bajo roles y permisos específicos.
**Estado:** `[ ]`

### R3 — Chat IA con Capacidades de Seguimiento de Recordatorios
**Archivos:** `features/ai_chat/skills/reminder.skills.ts`, `features/ai_chat/ai_chat.service.ts`
**Problema:** Habilitar al chat IA para buscar comentarios e historial de recordatorios (e.g. "¿sabes si ya atendí el tema del PPR de Juan?") para poder responder con precisión si un tema ya fue resuelto basándose en las notas de seguimiento del recordatorio.
**Estado:** `[ ]`

---

## 🟡 Chat IA — Latencia y costo de tokens (revisión 2026-07-23)

### T1 — Implicit caching se perdía en el último turno del loop de function calling
**Archivos:** `providers/google_genai.provider.ts`, `providers/vertex_ai.provider.ts`, `core/ai_provider.interface.ts`, `features/ai_chat/ai_chat.service.ts`
**Problema:** Para forzar que el modelo respondiera solo texto tras resolver todos los function calls, `ai_chat.service.ts` mandaba `tools: []` en el último turno del loop. Esto cambiaba el prefix `system_instruction+tools` respecto a los turnos anteriores y le hacía perder a Gemini el cache implícito justo en ese turno — confirmado en logs: `total_cached_tokens` caía a 0 en la última llamada aunque los turnos previos sí cacheaban miles de tokens (ej. 4004-4013).
**Fix aplicado:** `tools` se manda completo en todos los turnos; el bloqueo de function calls se hace con `generation_config.tool_choice: "none"` (Interactions API) / `toolConfig.functionCallingConfig.mode: "NONE"` (`generateContent`, usado por Vertex vía herencia). Nuevo parámetro `forceTextOnly` propagado en `IAiProvider.processInteraction`/`processUserRequest`.
**Estado:** `[x]`

### T2 — `cachedTokens` nunca se guardaba en `tokens_usage`
**Archivos:** `features/ai_chat/ai_chat.service.ts:267-274`
**Problema:** El objeto del mensaje `role: "model"` que arma `saveChatRound` no incluía el campo `cachedTokens` — el repository sí sabía mapearlo a la columna `cached_tokens` (`ai_session.repository.ts:98`), pero al llegar `undefined` siempre insertaba 0 vía `?? 0`, aunque `loopUsage.cachedTokens` sí se calculaba bien en memoria y el cache sí ocurría (y se cobraba más barato) en Gemini.
**Fix aplicado:** Agregado `cachedTokens: loopUsage.cachedTokens` al objeto insertado.
**Estado:** `[x]`

### T3 — Chat de texto sin `thinking_level` — ~40s por turno de skills
**Archivos:** `providers/google_genai.provider.ts`
**Problema:** Solo la voz (`gemini_live.provider.ts`) configuraba `thinking_level: MINIMAL`. El chat de texto usaba el thinking por defecto del modelo, generando 174-835 thought tokens por turno observados en logs — tiempo real de cómputo, no solo costo, para una tarea de extracción de parámetros de function calling que no necesita razonamiento profundo.
**Fix aplicado:** `thinking_level: "minimal"` (Interactions API) / `thinkingConfig.thinkingLevel: "MINIMAL"` (`generateContent`) agregado a ambos métodos de `GoogleGenAiProvider` (heredado por `VertexAiProvider`). Verificado en logs: `total_thought_tokens` bajó a 0 y el tiempo total de una ronda de 3-4 turnos bajó de ~40s a ~4s.
**Estado:** `[x]`

---

## 🔵 Futuro / integración de pagos

### F1 — `subscription_status` se actualiza de forma lazy
**Archivos:** `modules/subscription/subscription.service.ts`, `modules/subscription/subscription.repository.ts`
**Problema:** El status `trial → expired` solo se actualiza cuando el agente hace su próxima request. La DB puede tener el status desactualizado hasta ese momento.
**Fix:** Al integrar un procesador de pagos (Stripe/Conekta), los webhooks actualizan `subscription_status` proactivamente. Hasta entonces, el enfoque lazy es aceptable.
**Estado:** `[ ]` — bloquea integración de pagos
