# CLAUDE.md — AmConnect Backend

> **Obligatorio:** lee `RULES.md` (mismo directorio) antes de escribir código. Ahí están las reglas duras de arquitectura, errores, BD y prompts.

Contexto general del proyecto: `/Users/Development/Projects/JACATSoft/context.md` · Backlog: `/Users/Development/Projects/JACATSoft/backlog.md` · Cumplimiento de Privacidad: `LFPDPPP_CHECKLIST.md`



## Comandos

```bash
# Desde backend/
supabase start                          # Levantar stack local (Docker requerido)
supabase migration up                   # Aplicar migraciones pendientes (NO usar db push)
supabase functions serve amconnect-api \
  --env-file ./supabase/.env.local \
  --no-verify-jwt                       # Servir Edge Function localmente

# Generar tipos TypeScript desde el schema actual
supabase gen types typescript --local \
  > supabase/functions/amconnect-api/types/supabase.ts
```

## Estructura

```
supabase/
├── migrations/          # 30+ SQL — NO modificar sin crear nueva migración
└── functions/amconnect-api/
    ├── core/            # Interfaces + clases base (NO tocar salvo cambio de contrato)
    ├── shared/          # errors.ts, api_response.ts, case_converter.ts, config.ts
    ├── providers/       # gemini, gemini_live, gemini_embedding, vertex_ai
    ├── modules/         # contact/, policy/, reminder/, catalog/, note/, prompt/, storage/, subscription/, agent/, error_log/ — dto + repository + service
    ├── features/        # rag/, document_processing/, ai_chat/ (skills/, voice), notification/
    ├── http/            # controllers/, routes/, middleware/ (auth, error, di/)
    ├── prompts/         # dev_prompts.ts (solo local con USE_FILE_PROMPTS=true)
    └── index.ts         # Entry point
```

## Patrones del codebase

- **Nuevo módulo:** crea `modules/<nombre>/<nombre>.dto.ts` + `.repository.ts` + `.service.ts`, registra en `http/middleware/di/index.ts` y agrega rutas en `http/routes/index.ts`
- **Nueva migración:** `supabase migration new <nombre>` → editar el SQL → `supabase migration up`
- **Nueva skill de AI:** agregar en `features/ai_chat/skills/<dominio>.skills.ts` y registrar en `skills/index.ts`
- **Patrón discovery en skills:** las skills que necesiten un ID de catálogo NO usan enum hardcodeado:
  - Catálogo pequeño/global (`reminder_types`, `currencies`) → skill `get_<tipo>` que hace fetch all
  - Catálogo grande o por agente (`carriers`, `branches`, `products`) → skill `search_<tipo>(query)` con pg_trgm
- **Parámetros de skills tolerantes:** usar `args.full_name ?? args.name` para aceptar variantes que el modelo renombre
- **`prepareForUpdate` usa `stripUndefined`** — no llama a `prepareForCreate`. Solo incluye campos explícitamente provistos
- **`ai_pending_tasks`:** skills `save_pending_task` + `resolve_pending_task` para flujos con ambigüedad. `POST /ai/sessions/:sessionId/cancel` cancela tareas pendientes cuando el usuario sale del chat. Los pending tasks activos se inyectan en el contexto de cada mensaje
- **RAG — threshold (diferenciado por tipo de skill, ver detalle en RULES.md §5):** `search_contact_notes`/`search_policy_notes`/`search_reminder_notes` (acotados a una entidad ya conocida) usan `0.65`; `search_knowledge` (búsqueda amplia, último recurso de la cascada) usa `0.5` — más permisivo a propósito porque no tiene contexto que ayude a la similitud y debe cumplir "nunca responder que no encontró sin agotar la búsqueda". El default de `RagService.searchNotes` es 0.7 — siempre sobrescribir desde skills.
- **RAG — summary chunk:** `EmbeddingsService.saveDocument` indexa `[...chunks_de_content, summary]` en un solo batch; el chunk de summary mejora el recall para queries conversacionales
- **RAG — `created_at`:** `NoteMatch` incluye `createdAt` (de `agent_notes`) para que el AI responda con la fecha exacta de una nota
- **Contexto de AI vs notas RAG:** el `CONTEXT` por mensaje trae datos estructurados de la BD; las notas RAG traen conocimiento extraído de documentos. Son complementarios
- **Migraciones de `system_prompts`:** NO crear la migración hasta estar listo para producción; en local `USE_FILE_PROMPTS=true` usa `dev_prompts.ts`. Migración creada por error: borrar archivo + `DELETE FROM supabase_migrations.schema_migrations WHERE version = '<timestamp>'`
- **Códigos de catálogo en inglés:** todos los campos `code` usan inglés (`ACTIVE`, `LIFE`, `PAYMENT`). Los campos `name` también están en inglés en la BD; la app Flutter traduce vía `CatalogL10n` usando el `code` como clave ARB.
- **Backend de IA — switch `AI_BACKEND`:** `studio` (default; Gemini API con `GEMINI_API_KEY`) o `vertex` (Vertex AI con `VERTEX_API_KEY` + interceptor de fetch que sustituye la key por OAuth de la service account y reescribe la URL al recurso completo — ver `providers/vertex_ai.provider.ts`). La decisión vive SOLO en `di/index.ts` (`useVertexBackend()` / `getBackendApiKey()` / `buildAiProvider()`). Aplica a chat, documentos, embeddings y voz: en `vertex` la voz usa el WebSocket de Vertex Live con token OAuth de ~10 min (`createEphemeralToken`); en `studio` usa tokens efímeros v1alpha. **(El TTS server-side fue eliminado — ver nota abajo.)**
- **Regiones Vertex:** `VERTEX_LOCATION=global` para texto/documentos (`gemini-3.1-flash-lite` NO existe en regiones clásicas) y `VERTEX_LIVE_LOCATION` (default `us-central1`) para los modelos live, que NO existen en `global`. Vertex NO soporta el Interactions API — `VertexAiProvider.processInteraction` delega a `generateContent` con el historial completo.
- **Modelo live por backend:** los nombres difieren y ninguno existe en ambos backends. `LIVE_AUDIO_MODEL` (shared/config.ts) se resuelve según `AI_BACKEND`: studio → `GEMINI_LIVE_MODEL` (default `gemini-3.1-flash-live-preview`); vertex → `VERTEX_LIVE_MODEL` (default `gemini-live-2.5-flash-native-audio`).
- **Timezone del asesor:** el cliente envía `x-timezone` (ej: `America/Mexico_City`) en el header. El controller lo pasa a `AiChatService.processMessage(timezone)`, que calcula `timezoneOffset` (ej: `-06:00`) y lo expone en `SkillContext`. Para reminders auto-generados (sin hora específica), usar `toLocalMidnight(dateStr, timezoneOffset)` → `"YYYY-MM-DDT00:00:00-06:00"`. Así Flutter's `.toLocal()` devuelve el mismo día con `hour=0` y `_formatHora` muestra `'—'`.
- **Soft delete:** `is_active = false` + `deleted_at`, nunca `DELETE`
- **snake_case en DB, camelCase en DTOs** — conversión en `prepareForCreate/Update` de cada service
- **Convención SQL:** funciones standalone sin prefijo (`search_contacts`), triggers con `tg_`, funciones de trigger con `tgfn_`
- **Migraciones:** `supabase migration up` para local; NUNCA `supabase db push` (apunta al remoto)
- **Config del cron de notificaciones — vive en Vault (producción):** el cron (`cron_check_due_reminders`) necesita la URL del proyecto y el `NOTIFICATION_SECRET`, pero en Supabase Cloud el rol `postgres` no puede persistir parámetros custom (`ALTER DATABASE/ROLE ... SET app.settings.*` → 42501). Por eso `get_supabase_url()` y `get_notification_secret()` leen primero **Vault** (secrets con nombre exacto `supabase_url` y `notification_secret`, creados una vez con `select vault.create_secret('<valor>', '<nombre>');` en el SQL Editor) y caen a `current_setting('app.settings.*')` solo en local. El `notification_secret` de Vault debe ser el MISMO valor que la env `NOTIFICATION_SECRET` de la Edge Function. Migración: `20260710221043_notification_settings_from_vault.sql`.

## Mapa de modelos por flujo

Ver la tabla completa en `RULES.md` §7 (flujo × modelo × qué API usa cada backend). Resumen: un solo modelo "pensante" (`GEMINI_MODEL`) para chat/clasificación/extracción; embeddings fijos en código; la voz Live es el ÚNICO flujo cuyo modelo difiere por backend.

> **Nota (2026-08-02) — TTS server-side / feature "walkie" ELIMINADOS.** Se retiraron `POST /ai/chat/tts`, `ChatTtsService`, `GeminiTtsProvider`, `TTS_MODEL` y `shared/audio.ts`. El "walkie" (press-to-talk) era el flujo `chat_tts`, no uno aparte. **Razón:** quedó sin cliente vivo tras consolidar el chat en la feature `assistant/` de Flutter (la UI `chat_tts/` se borró); la voz del producto usa **Voz Live**. Las columnas `tts_*` de `ai_sessions` se conservan solo-lectura para el reporte de costos histórico.

## RLS — cobertura confirmada

Las siguientes tablas tienen RLS con `agent_id = auth.uid()` y están protegidas contra acceso cruzado entre agentes sin necesidad de filtros extra en el código TypeScript:

- `ai_sessions` — policy `"ai_sessions: own records"`
- `ai_pending_tasks` — policy `"ai_pending_tasks: own records"`
- `contacts`, `policies`, `reminders`, `agent_notes`, `agent_note_chunks`, `ai_chat_messages`, `document_metadata`, `beneficiaries`, `policy_participants` — todas con `agent_id = auth.uid()`
- Catálogos por agente (`carriers`, `branches`, `products`) — RLS desde migración 008

**Regla:** no es necesario agregar `.eq("agent_id", agentId)` en queries TypeScript cuando el cliente Supabase ya viene autenticado con el JWT del usuario — el RLS lo impone automáticamente.

## Mini-framework de servicios
 
Cada responsabilidad transversal tiene su propio servicio inyectable — no lógica inline en controllers ni middleware:
 
| Servicio | Ubicación | Responsabilidad |
|---|---|---|
| `ErrorLogService` | `modules/error_log/error_log.service.ts` | Inserta en `error_logs`, retorna `errorId \| null` |
| `UsageService` | `modules/subscription/usage.service.ts` | `checkAndIncrement*`, `decrement*` — usa `this.supabase` (RLS permite) |
| `AiSessionService` | `features/ai_chat/ai_session.service.ts` | Crear, marcar, trackear tokens de sesiones IA |
| `PromptService` | `modules/prompt/prompt.service.ts` | Recuperar y cachear en memoria prompts de la tabla `system_prompts` |
 
**Reglas:**
- Nunca usar `SUPABASE_SERVICE_ROLE_KEY` en los servicios — el RLS debe estar correctamente configurado para que el cliente autenticado pueda hacer lo que necesita
- El `errorId` se incluye en la respuesta JSON al cliente pero el mensaje de error es lo que ve el usuario; el ID es para uso interno futuro
- No usar RPCs de Postgres para operaciones que se pueden hacer con TypeScript (ej: decrement = read-then-update en TS)
- **Prompts en Base de Datos**: Los prompts del sistema e ingesta no deben estar hardcodeados en el backend. Deben guardarse en la tabla `system_prompts`, escribirse exclusivamente en inglés para optimizar el razonamiento y consumo de tokens, e incluir instrucciones de detección de idioma si chatean con el usuario.
- **NUNCA concatenar al system prompt en código TypeScript**: Si se necesita agregar contenido a un prompt que ya está en la BD, crear una migración que actualice el registro en `system_prompts`. No usar `systemPrompt +=` para instrucciones estáticas.
- **Variables dinámicas en prompts**: Si el prompt requiere valores por request (fecha actual, timezone offset del asesor), usar placeholders en el texto almacenado en BD (ej: `{{current_datetime}}`, `{{timezone_offset}}`) y sustituirlos en el servicio antes de enviarlo al modelo. El texto de instrucción va en la BD; los valores dinámicos se inyectan en código.
- **Caché de Prompts**: `PromptService` maneja una caché en memoria (`Map`). El TTL se configura mediante la variable de entorno `PROMPT_CACHE_TTL_MINUTES` (default 24h).
- **Evitar lockfiles versión 5**: Para evitar errores de bootstrap en el runtime de Supabase Edge Runtime, `deno.json` debe tener siempre `"lock": false`.
- **Inyección de PromptService**: Se inyecta a través del contenedor DI de Hono (`di/index.ts`) en todos los servicios y proveedores de IA que dependan de plantillas de prompts (ej: `AiChatService`, `GeminiProvider`, `KnowledgeIngestionService`, `PolicyIngestionService` y `DocumentProcessorService`).

## Gemini Live API & Token Tracking

*   **Tasas de Conversión de Audio**: El audio de entrada/salida se convierte a tokens de forma nativa. La tasa de conversión estándar es de **32 tokens por segundo** (o **25 tokens por segundo** en sesiones activas de Live API por WebSocket).
*   **Modelo de Facturación Acumulativo**: La Live API cobra por **turno** la totalidad de los tokens en la ventana de contexto de la sesión. Esto significa que cada nuevo turno vuelve a procesar y facturar todo el historial de la conversación (audios anteriores del usuario e IA) guardado en el contexto.
*   **Doble Facturación por Transcripción**: Si se activa la transcripción de audio a texto (`inputAudioTranscription` o `outputAudioTranscription`), se cobran los tokens de texto generados a tarifas estándar de texto de salida **además** del costo del token de audio nativo.
*   **Tiempo de Recepción de usageMetadata**: En el canal de WebSocket, el conteo final de `completion_tokens` y `total_tokens` (que depende del procesamiento completo del audio generado) puede llegar en un paquete `usageMetadata` independiente y retrasado **después** de emitirse el evento `turnComplete`. El backend y la app deben evitar limpiar o guardar contadores inmediatamente en `turnComplete`; se debe usar un margen o delay de buffer (ej. 400ms) para no perder los últimos tokens del turno.

## Cambios Recientes
- **Chat de Texto y Voz:** El chat de texto y los ajustes del chat de voz (con las correcciones del nuevo formato de audio `realtimeInput.audio` para evitar la desconexión del WebSocket en Gemini 3.1 Live API) están listos y validados (detalles en [walkthrough.md](file:///Users/julio/.gemini/antigravity/brain/a411ae05-c358-412b-93b2-578d9f685c96/walkthrough.md)).


