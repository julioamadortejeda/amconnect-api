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
- Búsqueda vectorial (RAG): `threshold: 0.5` explícito siempre (el default de `RagService.searchNotes` es 0.7).
- Flujos ambiguos: `save_pending_task` / `resolve_pending_task` (`ai_pending_tasks`).

## 6. Código limpio

- **Prohibido** dejar `debugger;`, código comentado muerto o `console.log` de depuración. Logs operativos permitidos: `console.error`/`console.warn` con prefijo `[TAG]` (ej: `[VOICE]`).
- **Prohibidos los secretos con fallback**: `Deno.env.get("X") ?? "valor-default"` para tokens/secrets NO — si falta la env var, fallar con error 500 (fail closed).
- Lógica repetida en 2+ lugares → extraer a `shared/` (ej: cálculo de timezone/fecha local, ejecución de skills con validación).
- `deno.json` siempre con `"lock": false`.
- No usar RPCs de Postgres para lo que se resuelve en TypeScript.
