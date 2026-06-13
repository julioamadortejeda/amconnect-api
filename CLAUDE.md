# CLAUDE.md — AmConnect Backend

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
├── migrations/          # 001-016 SQL — NO modificar sin crear nueva migración
└── functions/amconnect-api/
    ├── core/            # Interfaces + clases base (NO tocar salvo cambio de contrato)
    ├── shared/          # errors.ts, api_response.ts, case_converter.ts
    ├── providers/       # gemini.provider.ts, vertex_ai.provider.ts
    ├── modules/         # contact/, policy/, reminder/, catalog/, agent/ — dto + repository + service
    ├── features/        # rag/, document_processing/, ai_chat/skills/
    ├── http/            # controllers/, routes/, middleware/di/
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
- **`ai_pending_tasks`:** skills `save_pending_task` + `resolve_pending_task` para flujos con ambigüedad
- **Códigos de catálogo en inglés:** todos los campos `code` usan inglés (`ACTIVE`, `LIFE`, `PAYMENT`). Los campos `name` también están en inglés en la BD; la app Flutter traduce vía `CatalogL10n` usando el `code` como clave ARB.
- **Timezone del asesor:** el cliente envía `x-timezone` (ej: `America/Mexico_City`) en el header. El controller lo pasa a `AiChatService.processMessage(timezone)`, que calcula `timezoneOffset` (ej: `-06:00`) y lo expone en `SkillContext`. Para reminders auto-generados (sin hora específica), usar `toLocalMidnight(dateStr, timezoneOffset)` → `"YYYY-MM-DDT00:00:00-06:00"`. Así Flutter's `.toLocal()` devuelve el mismo día con `hour=0` y `_formatHora` muestra `'—'`.
- **Soft delete:** `is_active = false` + `deleted_at`, nunca `DELETE`
- **snake_case en DB, camelCase en DTOs** — conversión en `prepareForCreate/Update` de cada service
- **Convención SQL:** funciones standalone sin prefijo (`search_contacts`), triggers con `tg_`, funciones de trigger con `tgfn_`
- **Migraciones:** `supabase migration up` para local; NUNCA `supabase db push` (apunta al remoto)

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

