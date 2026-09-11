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

## 2.1 Texto que el backend ESCRIBE para el asesor — decisión pendiente

Hay dos mecanismos de traducción y los dos resuelven lo mismo: el backend manda un identificador y la app pone las palabras.

| Caso | Qué manda el backend | Quién traduce |
|---|---|---|
| Errores de respuesta | `errorCode` + mensaje español de respaldo | la app, con `error_translator.dart` (§2) |
| Valores de catálogo | el `code` en inglés | la app, con `CatalogL10n` |

Existe un tercer caso que **no encaja en ninguno**: texto que el backend **escribe en una columna** y el asesor lee después. Hoy es uno solo — los títulos y descripciones que genera el cron de recordatorios (`Pago de Prima · GM000…`).

**Por qué no puede seguir el patrón:** `reminders.title` es `NOT NULL` y texto libre, así que algo tiene que quedar guardado. Y no lo lee solo la app: `search_reminder_ids` busca dentro de él cuando el asesor pregunta por texto, y el asistente se lo dice en voz o en chat. Si la app compusiera el título en pantalla y la columna guardara un código, el asistente y la pantalla estarían en desacuerdo sobre el mismo recordatorio.

**Lo que se hace hoy (2026-09-10):** el cron lo compone ya resuelto en el idioma del asesor, leyendo `agents.locale` —persistida desde `Accept-Language` igual que el timezone, y por el mismo motivo: el cron no tiene request. Las tablas viven en `modules/reminder/reminder_generation.constants.ts`.

**Lo que cuesta:** queda congelado al crearse. Si el asesor cambia la app de idioma, los recordatorios que ya existen conservan el anterior; solo los nuevos salen en el idioma nuevo.

**La decisión pendiente:** eso es un tercer mecanismo de i18n en el backend, y se inventó para este caso. El día que otro flujo necesite escribir texto traducido para el asesor, **decidir dónde vive** en vez de copiar esa tabla. Alternativa sobre la mesa: que la app componga el título de los generados —se distinguen porque tienen `occurrence_date`— y resolver primero qué se guarda en la columna para que el asistente lea lo mismo.

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
- Valores que **cambian entre turnos** (fecha, timezone, pending tasks, pantalla activa) van en el mensaje del usuario, NUNCA en el systemInstruction: cambiarlo entre requests rompe el implicit caching de Gemini.
- Valores **constantes para un asesor dado** sí pueden ir en el systemInstruction como `{{placeholder}}` — su prefijo sigue siendo byte a byte idéntico entre las peticiones de esa persona, así que el caché aguanta. Hoy el único es `{{advisor_language}}` (medido el 2026-09-07: 12,078 tokens cacheados de 13,270 en el tercer turno). Cada idioma genera su propio prefijo y cada uno se cachea por separado.
- La sustitución vive SOLO en `PromptService.getPrompt(code, vars)`, que además **truena** si el prompt declara un `{{placeholder}}` y nadie mandó su valor. Antes eso no fallaba: tres prompts de ingesta traían `{{current_date}}` sin sustituir y al modelo le llegaban las llaves escritas tal cual, produciendo resúmenes peores sin un solo error en los logs.
- En local: `USE_FILE_PROMPTS=true` usa `prompts/dev_prompts.ts`. NO crear la migración de prompts hasta estar listo para producción.
- Migración de prompts creada por error: borrar el archivo y `DELETE FROM supabase_migrations.schema_migrations WHERE version = '<timestamp>'`.

## 5. Skills de IA

- **Dónde va cada regla — tres lugares, sin excepción:**
  1. **Prompt** (`system_prompts`): política que NO depende de los datos de este turno. *"Nunca presentes una lista recortada como si fuera toda la agenda."*
  2. **Declaración de la skill** (`description` + `.describe()`): cuándo llamarla, con qué argumentos, qué es obligatorio y de dónde sacarlo. Está en contexto SIEMPRE — también en el momento en que una llamada falla, que es la razón por la que un mensaje de error no necesita repetirla.
  3. **Lo que la skill devuelve o lanza**: **hechos, nunca prosa**. `{ beforeRange: 11, overdue: 11 }`, no *"dilo claramente y ofrece listarlos"*.
  La prueba: *¿la regla cambiaría si los datos fueran otros?* **No** → prompt. **Sí, y es sobre cuándo llamar la herramienta** → declaración. **Sí, y es un dato** → un campo, sin adjetivos. Desempate: si algo está en dos lugares, gana el prompt y la copia se borra.
- **Por qué importa (2026-09-07):** lo que devuelve un `execute` se empuja a la conversación como `functionResponse`, así que cualquier prosa ahí se lee como una instrucción. Eso creó un tercer hogar para las reglas —el que nadie encuentra, dentro de un `if`, dentro de una skill— y llegó a 21 mensajes, incluidos 12 que repetían lo que la descripción del propio parámetro ya decía. El barrido correcto NO es por nombre de campo (`instruction`, `note`, `undoHint`): es buscar **prosa larga en cualquier texto que llegue al modelo**, devuelto o lanzado con `throw`.
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

## 5.1 La capa invisible: reglas que deciden qué VE el modelo

Estas viven en código, no en el prompt ni en las declaraciones de skills, y **cambian la respuesta del asistente sin aparecer en ningún texto que el modelo lea**. Es la lista que hay que revisar primero cuando el asistente contesta algo raro y ni el prompt ni la skill lo explican.

El caso que la motivó (2026-09-05): el asesor pregunta *"¿qué tengo pendiente?"* y el asistente contesta "no tienes recordatorios para los próximos 7 días" — cierto, mientras callaba **12 recordatorios vencidos**. El prompt no dice nada de vencidos, la descripción de la skill tampoco, y su retorno tampoco. La causa estaba en `daysFromNowRange`, tres archivos más allá: la ventana arranca en `now`, así que lo vencido nunca llegó a la consulta y el modelo no podía mencionarlo aunque quisiera.

| Regla | Dónde | Qué le hace a la respuesta |
|---|---|---|
| `from` de la ventana arranca en **`now`** | `shared/utils.ts` → `daysFromNowRange` | Lo vencido queda fuera de `get_upcoming_reminders`. Se compensa con `beforeRange`/`overdue`, que lo cuenta y se lo dice al modelo. Sin ese conteo, la agenda se ve vacía teniendo trabajo atrasado. |
| Ventana por defecto de **7 días** | `reminder.service.ts` `getUpcoming` | Cuánta agenda se ve cuando el asesor no pide un periodo. `queriedRange.isDefault` se lo avisa al modelo; `beyondRange` cuenta lo que quedó fuera. |
| **`DONE` y `CANCELLED`** excluidos | `reminder.service.ts` `excludedStatusIds` | Define qué cuenta como "pendiente". No está en ningún prompt: es una decisión de datos. |
| `contact_id` sin fechas ⇒ **sin ventana** | `reminder.skills.ts` `get_upcoming_reminders` | Preguntar por una persona devuelve TODO lo suyo, no lo de esta semana. Un recordatorio a tres meses sigue siendo un pendiente de esa persona. |
| **`MAX_LOOPS = 6`** | `ai_chat.service.ts` | Tope de vueltas de herramientas por turno. Al agotarse se hace una pasada final sin herramientas para cerrar con una respuesta honesta en vez de un 502. |
| **`ALWAYS_ACTIVE`** = `pending_task`, `knowledge` | `ai_chat.service.ts` | Esas dos skills están disponibles siempre, sin importar lo que diga el clasificador. |
| Clasificador vacío ⇒ **todos los dominios** | `ai_chat.service.ts` + `google_genai.provider.ts` | Si la clasificación falla o no parsea, se cargan todas las herramientas en vez de tumbar la conversación. Cuesta tokens, no la respuesta. |
| **recordatorio ⇄ compromiso** se encienden juntos | `ai_chat.service.ts` | *"¿Qué tengo que hacer en septiembre?"* es una pregunta para el asesor, pero sus pendientes viven en dos tablas. El clasificador solo devuelve `reminder` y la respuesta saldría a medias. |
| **`policy` ⇒ `catalog`** | `ai_chat.service.ts` | Las pólizas necesitan aseguradora, ramo y producto para resolverse. |
| Pantalla activa **fuerza su dominio** | `ai_chat.service.ts` | Si el asesor está viendo un recordatorio, ese dominio se enciende aunque el mensaje no lo mencione. |
| `resolve_pending_task` **se retira** si no hay tareas | `ai_chat.service.ts` | Dejarla disponible le da al modelo una salida falsa: la llama con un id inventado, la da por buena y confirma un registro que nunca ocurrió (2026-08-28; pedirlo por prompt no bastó). |
| **TTL de 12 h** en tareas pendientes | `ai_session.repository.ts` | Cuánto vive una desambiguación sin resolver antes de dejar de inyectarse en el contexto. |
| Voz: **sin clasificador**, todos los dominios | `voice_chat.service.ts` `ALL_DOMAINS` | La lista de herramientas se arma UNA vez al abrir la sesión, así que no se puede ajustar por turno. |
| Voz: **7 skills excluidas** | `voice_chat.service.ts` `VOICE_EXCLUDED_SKILLS` | El CRUD de catálogos (~786 tokens) y `resolve_pending_task`. La Live API re-factura el payload completo en CADA turno, así que el recorte aplica a toda la sesión. |
| Voz: **sin `advisorWords`** | `skill.core.ts` `SkillContext` | El contexto se arma al abrir la sesión, no por turno. Las skills que verifican que el modelo copió las palabras del asesor tienen que funcionar sin eso. |

**Regla al agregar una de estas:** si una decisión de código cambia lo que el modelo alcanza a ver, va en esta tabla el mismo día. La alternativa es que la próxima falla vuelva a costar una tarde de investigación.

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



