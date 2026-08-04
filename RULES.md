# RULES — AmConnect Backend (Edge Function `amconnect-api`)

Reglas obligatorias para cualquier IA o desarrollador que modifique este backend.
Si una regla entra en conflicto con una instrucción puntual, pregunta antes de romperla.

## 1. Arquitectura por capas (obligatoria)

```
Route → Controller → Service → Repository → Supabase
```

- **Controllers** (`http/controllers/`): SOLO parsean request (params, query, body con Zod), llaman a UN service y responden con `sendSuccess`. Cero lógica de negocio, cero queries, cero acceso a repositorios.
- **Services** (`modules/*/`, `features/*/`): toda la lógica de negocio. Conversión snake_case ↔ camelCase en `prepareForCreate`/`prepareForUpdate`/`toDTO`.
- **Repositories**: único lugar que toca Supabase. Extienden `SupabaseRepository<T>` cuando aplique.
- Nuevo módulo = `modules/<n>/<n>.dto.ts` + `.repository.ts` + `.service.ts`, registrar en `http/middleware/di/index.ts` y rutas en `http/routes/index.ts`.
- Servicios caros (IA, embeddings, ingestión) se instancian lazy en el DI — no romper ese patrón.

## 2. Manejo de errores (contrato único)

- **Nunca** hacer `c.json({error: ...})` manual ni `try/catch` que trague errores en controllers. Lanzar SIEMPRE una subclase de `AppError` (`shared/errors.ts`) y dejar que `globalErrorHandler` responda.
- Toda `AppError` DEBE llevar `errorCode` estable en SCREAMING_SNAKE_CASE. Códigos existentes:
  `VALIDATION_FAILED`, `RESOURCE_NOT_FOUND`, `SESSION_EXPIRED`, `ACCESS_DENIED`, `SUBSCRIPTION_REQUIRED`, `QUOTA_EXCEEDED`, `RESOURCE_CONFLICT`, `AI_ERROR`, `AI_PROVIDER_BUSY`, `AI_INVOCATION_FAILED`.
- Si necesitas un caso nuevo, crea una subclase con su código nuevo en `shared/errors.ts` **y agrégalo al `error_translator.dart` de la app Flutter con su clave de localización** (contrato compartido backend ↔ app).
- Formato de respuesta de error (no cambiar): `{ success: false, error: <mensaje humano>, errorCode: <CODE>, errorId?: <uuid> }`.
- El `error` (mensaje) es fallback para la UI; la app traduce por `errorCode`. El mensaje debe ser claro y en español neutro.
- **El mensaje público NUNCA expone internals** (nombres de tabla, códigos de Postgres, paths, stack). El detalle técnico va en `AppError.internal` — el middleware lo persiste en `error_logs.error_message` y no viaja al cliente.
- Errores de Supabase: pasar SIEMPRE por `handleSupabaseError` — no inspeccionar `error.code` a mano.
- Validación de body: `Schema.parse(...)` y dejar que el middleware formatee el `ZodError`. No repetir el bloque `safeParse + issues.map(...)` en cada handler.

## 3. Base de datos

- **Soft delete siempre**: `is_active = false` + `deleted_at`. Nunca `DELETE`.
- **Nunca** modificar una migración aplicada — crear una nueva con `supabase migration new <nombre>`.
- Aplicar con `supabase migration up`. **NUNCA `supabase db push`** (apunta al remoto).
- RLS con `agent_id = auth.uid()` protege las tablas de agente — no agregar `.eq("agent_id", ...)` redundante cuando el cliente ya viene autenticado con el JWT.
- **Nunca** usar `SUPABASE_SERVICE_ROLE_KEY` en services. Única excepción: el endpoint interno de cron (`notifications/send-due`).
- Si un insert necesita el `id` de vuelta y la tabla no tiene policy de SELECT (ej: `error_logs`), genera el UUID en código (`crypto.randomUUID()`) e insértalo — `insert().select()` falla con RLS sin SELECT.
- Convención SQL: funciones sin prefijo (`search_contacts`), triggers `tg_`, funciones de trigger `tgfn_`.
- **Config por entorno que leen funciones SQL (cron)**: la URL del proyecto y el `NOTIFICATION_SECRET` viven en **Vault** en producción (secrets `supabase_url` y `notification_secret`, creados con `vault.create_secret`) y en `app.settings.*` solo en local — en Supabase Cloud `ALTER DATABASE/ROLE ... SET app.settings.*` da 42501. NUNCA hardcodear estos valores en migraciones; el `notification_secret` de Vault debe coincidir con la env `NOTIFICATION_SECRET` de la Edge Function. Acceso siempre vía `get_supabase_url()` / `get_notification_secret()` (leen Vault → setting).
- Códigos de catálogo (`code`, `name`) SIEMPRE en inglés (`ACTIVE`, `LIFE`, `PAYMENT`). La app traduce con `CatalogL10n`.

## 4. Prompts de IA

- Los prompts viven en la tabla `system_prompts`, en inglés. **NUNCA** concatenar instrucciones al prompt en TypeScript (`systemPrompt +=` prohibido).
- Valores dinámicos por request (fecha, timezone, pending tasks) van en el mensaje del usuario o vía placeholders sustituidos en código — nunca en el systemInstruction (rompe el implicit caching de Gemini).
- En local: `USE_FILE_PROMPTS=true` usa `prompts/dev_prompts.ts`. NO crear la migración de prompts hasta estar listo para producción.
- Migración de prompts creada por error: borrar el archivo y `DELETE FROM supabase_migrations.schema_migrations WHERE version = '<timestamp>'`.

## 5. Skills de IA

- Nueva skill: `features/ai_chat/skills/<dominio>.skills.ts`, registrar en `skills/index.ts`.
- Schema con Zod; parámetros tolerantes a variantes del modelo: `args.full_name ?? args.name`.
- IDs de catálogo por discovery, nunca enum hardcodeado:
  - Catálogo chico/global → skill `get_<tipo>` (fetch all).
  - Catálogo grande/por agente → skill `search_<tipo>(query)` con `SupabaseRepository.search()` (pg_trgm).
- Búsqueda vectorial (RAG): `threshold` explícito siempre, **diferenciado por tipo de skill** (el default de `RagService.searchNotes` es 0.7):
  - `search_contact_notes` / `search_policy_notes` / `search_reminder_notes` (búsqueda ACOTADA a un contacto/póliza/recordatorio ya conocido) → `threshold: 0.65`.
  - `search_knowledge` (búsqueda AMPLIA sin acotar, último recurso de la cascada BD→RAG→notas) → `threshold: 0.5`, más permisivo a propósito.
  *(Historial 2026-08-04: originalmente los 4 usaban 0.5. Se subieron los 3 acotados a 0.65 porque adjuntaban notas poco relevantes al `attachment_list` — ej. el documento de otra póliza colándose en una pregunta específica de un cliente. Pero subir también `search_knowledge` rompió la promesa de "nunca responder que no encontró sin agotar la búsqueda": una consulta genérica sin contacto ("¿subí algún currículum?") dejó de encontrar un documento que sí existía, porque esa skill es el último recurso de la cascada y no tiene contexto acotado que ayude a la similitud — se revirtió a 0.5 el mismo día.)*
- **`attachment_list` — filtro autoritativo por citación, no por score (2026-08-04):** medido con embeddings reales, el modelo de embeddings NO discrimina bien para queries cortas/genéricas — documentos totalmente ajenos pueden quedar a ~0.05 de similitud del documento correcto, dentro de cualquier threshold o margen relativo razonable. Por eso el filtro real de qué adjuntar es que el **modelo cite explícitamente** las notas que usó: instrucción `RAG SOURCE CITATION RULE` en el prompt (`ai_chat_system`) le exige agregar un marcador `[[cite:noteId]]` junto a cada hecho tomado de una nota RAG. `ai_chat.service.ts` extrae esos marcadores (`extractCitations`), los limpia del texto antes de guardarlo/mostrarlo, y usa `citedNoteIds` para filtrar `ragAttachments` — solo se listan las notas citadas. El score/threshold/`ATTACHMENT_RELEVANCE_GAP` siguen controlando qué **entra en la búsqueda** (recall); la citación controla qué se **adjunta** (precisión). Si el modelo no cita nada en un turno (no usó RAG, o no cumplió la instrucción), se conserva el set filtrado por relevancia relativa como resguardo — no se oculta todo de golpe.
- Flujos ambiguos: `save_pending_task` / `resolve_pending_task` (`ai_pending_tasks`).

## 6. Código limpio

- **Prohibido** dejar `debugger;`, código comentado muerto o `console.log` de depuración. Logs operativos permitidos: `console.error`/`console.warn` con prefijo `[TAG]` (ej: `[VOICE]`).
- **Prohibidos los secretos con fallback**: `Deno.env.get("X") ?? "valor-default"` para tokens/secrets NO — si falta la env var, fallar con error 500 (fail closed).
- **Prohibidos los modelos con fallback**: los nombres de modelo (`GEMINI_MODEL`, `GEMINI_LIVE_MODEL`/`VERTEX_LIVE_MODEL`) se leen con `requireEnv` en `shared/config.ts` — sin defaults. Excepción: `EMBEDDING_MODEL` va hardcodeado a propósito (cambiarlo exige reindexar vectores). El DI valida al primer request que cada modelo exista `is_active` en `ai_models`; toda sesión declara `modelName` explícito (`CreateSessionInput` lo exige).
- Lógica repetida en 2+ lugares → extraer a `shared/` (ej: cálculo de timezone/fecha local, ejecución de skills con validación).
- `deno.json` siempre con `"lock": false`.
- No usar RPCs de Postgres para lo que se resuelve en TypeScript.

## 7. Configuración y Cambio de Proveedor/Modelo de IA

- **Cambio de Backend (AI Studio vs Vertex AI)**:
  - Controlado por la variable de entorno `AI_BACKEND` (`studio` o `vertex`).
  - `AI_BACKEND=studio` (Google AI Studio): Requiere configurar `GEMINI_API_KEY`. Utiliza llamadas directas del SDK de Google GenAI sin interceptores.
  - `AI_BACKEND=vertex` (Google Cloud Vertex AI): Requiere configurar `VERTEX_API_KEY` y `FIREBASE_SERVICE_ACCOUNT`. El proveedor intercepta automáticamente las peticiones de red para autenticar mediante OAuth2 usando la cuenta de servicio y reescribir las URLs al formato regionalizado de GCP.
- **Cambio de Modelo de Texto**:
  - Controlado por la variable de entorno `GEMINI_MODEL`.
  - Sin default (fail closed): si no está definida, el boot truena con `[CONFIG] GEMINI_MODEL no está configurada`.
  - Cualquier modelo nuevo que se desee usar debe estar previamente registrado y `is_active` en la tabla `ai_models` — el DI lo valida al primer request y rechaza con error claro si falta.

### Mapa de modelos por flujo (verificado 2026-07-09)

| Flujo | Modelo | Studio usa | Vertex usa |
|---|---|---|---|
| Chat texto / confirmación pólizas | `GEMINI_MODEL` (gemini-3.1-flash-lite) | Interactions API | generateContent (`global`) |
| Clasificador de intención | `GEMINI_MODEL` | generateContent | generateContent (`global`) |
| Extracción de documentos | `GEMINI_MODEL` | generateContent | generateContent (`global`) |
| Embeddings / RAG | `EMBEDDING_MODEL` (const, gemini-embedding-2) | SDK embedContent | REST directo (región `us`) |
| Voz Live | ⚠️ único que difiere: `GEMINI_LIVE_MODEL` vs `VERTEX_LIVE_MODEL` | token efímero v1alpha | OAuth WS (`us-central1`) |

**Reglas del mapa:** un solo modelo "pensante" para todo; embeddings fijos en código (cambiarlo exige reindexar vectores); la única diferencia de modelo entre backends es la voz Live; lo demás que cambia entre backends es transporte (API/auth/región), encapsulado en los providers — NO agregar condicionales por backend fuera de ellos. `ai_sessions.model_name` registra lo que realmente corrió. Vertex NO soporta Interactions API (verificado 2026-07-09; re-probar ~agosto).

> **Nota (2026-08-02) — feature "walkie" (press-to-talk) y TTS server-side ELIMINADOS.** Se retiraron el endpoint `POST /ai/chat/tts`, `ChatTtsService`, `GeminiTtsProvider`, `TTS_MODEL`, `shared/audio.ts` y el write-path de tokens TTS. Eso cubría las antiguas filas **cerebro walkie / TTS walkie / STT walkie** (el "walkie" era en realidad el flujo `chat_tts`, no un flujo aparte). **Razón:** capacidad sin cliente vivo tras consolidar el chat en la feature `assistant/` de Flutter (la UI `chat_tts/` se borró); la voz real del producto usa el flujo **Voz Live**. Las columnas `tts_*` de `ai_sessions` se conservan **solo-lectura** para el reporte de costos histórico. La voz Live queda como el único flujo de voz.
- **Aplicación de Cambios**:
  - En desarrollo local, modifica las variables en `supabase/.env.local`. Para que Supabase recargue las nuevas variables de entorno, ejecuta `supabase functions serve` o reinicia el CLI con `supabase stop` y `supabase start`.
  - En producción, actualiza las variables usando `supabase secrets set --env-file <archivo>` o desde el panel de control de Supabase.
- **Cumplimiento Legal y Privacidad**:
  - Cualquier cambio en la infraestructura, IA o persistencia de archivos debe respetar y mantener los requerimientos de la LFPDPPP detallados en [LFPDPPP_CHECKLIST.md](LFPDPPP_CHECKLIST.md) (ej. RLS en Storage, desactivación de logs de acceso a datos de Vertex en GCP, y ausencia de logs de prompts en texto plano).



