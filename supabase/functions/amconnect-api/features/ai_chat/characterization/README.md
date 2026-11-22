# Pruebas de caracterización del asistente (antes del refactor + SSE)

Fijan lo que el asistente hace HOY, por superficies estables, para correrlas otra vez
después de partir `AiChatService` (AgentLoop / ToolSelector / ConversationStore) y de
pasar a SSE. Los tests que exponen un bug real están en `ignore: true` con un comentario
`// BUG:`; al arreglarlo, se les quita el `ignore` y deben pasar.

```bash
deno task test    # desde supabase/functions/amconnect-api (offline, --deny-net)
```

## Reglas de diseño

- Solo se prueba por **HTTP** (`POST /ai/chat`, `/ai/sessions/:id/cancel`, `/ai/voice/execute-tool`,
  `/ai/voice/save-round`) con el `globalErrorHandler` real. Nada de métodos privados ni orden interno.
- El proveedor de IA es `ScriptedAiProvider` (`shared/testing/assistant_harness.ts`): se le guionan turnos
  (`say`, `callTool`, `callTools`, `{ empty }`, `{ error }`) y graba lo que recibió (herramientas ofrecidas,
  system prompt, historial, `forceTextOnly`).
- Repos en memoria con semántica de RLS (`InMemoryAiSessionRepository`), repos de uso falsos y skills reales
  sobre `fake_skill_context`.
- **Al refactorizar solo debe cambiar `buildAssistantHarness`** (el cableado). Si SSE cambia el transporte, hay
  que agregar un helper `postChatStream` que junte los eventos al mismo sobre `{ text, sessionId, usage, metadata }`
  y reutilizar los mismos escenarios.
- Los tests llamados "caracterización:" fijan comportamiento actual que es discutible (no necesariamente correcto);
  si el cambio lo altera a propósito, se actualizan junto con la decisión.

## Escenarios

### `chat_loop_test.ts` (bucle de herramientas y errores) — HTTP
| Escenario | Garantiza |
|---|---|
| Texto simple | Sobre `{success, data:{text, sessionId, usage, sessionUsage, aiBackend}}`; una sola llamada al modelo |
| Una herramienta | Pide → se ejecuta → el resultado vuelve como `function_result` → texto final |
| Herramienta con agente/sesión del turno | La skill recibe el `agentId` autenticado |
| 3 herramientas encadenadas | `usage` (prompt/completion/total/cached) sumado entre vueltas + clasificador |
| Herramientas paralelas | Todas se ejecutan; un turno de modelo con N llamadas y un turno de usuario con N respuestas |
| Tope de vueltas (6) | Modelo que nunca para → turno de cierre `forceTextOnly` (7 llamadas), 200, respuesta del modelo |
| Tope + cierre vacío | Mensaje honesto fijo, 200, persistido |
| Herramienta desconocida | El modelo recibe `Unknown skill` y se recupera |
| Herramienta que truena | `{ok:false,error}` al modelo, el chat no falla |
| Args inválidos (Zod) | La skill no corre; el modelo recibe `Missing required data` |
| Respuesta vacía (1 y 2 veces) | No truena; cierre / mensaje honesto |
| Texto + function calls | Se ejecutan las llamadas |
| `AiProviderError` (inicio, a media conversación, clasificador) | 503 `AI_PROVIDER_BUSY`, cobro devuelto, sesión `provider_error` no facturable |
| `AiError` | 502 `AI_ERROR`, sin reembolso (decisión actual) |
| Error crudo / 429 del SDK | 500 `INTERNAL_ERROR` sin filtrar el mensaje, cobro devuelto y sesión no facturable; 429 `AI_PROVIDER_BUSY` |

### `chat_session_test.ts` (sesión, cuota, tokens, cancelación, adversariales) — HTTP
Sesión nueva vs reutilizada; historial persistido (usuario+herramienta+modelo) y reenviado; `previousInteractionId`;
`ai_chat_messages`; sessionId inexistente/ajeno; uuid inválido; un cobro por mensaje; 429 `QUOTA_EXCEEDED`; fallo de conteo;
`tokens_usage`; usage en ceros; cancelar (tareas, 404 ajena, 422, nota huérfana); mensaje vacío / body inválido;
JSON malformado; mensaje de 200 KB; solo espacios; unicode/emoji/NUL; imitación de `[CONTEXT]`; concurrencia en
sesiones distintas y en la misma.

### `chat_context_test.ts` (lo que recibe el modelo) — HTTP
`[CONTEXT]` (fecha local, offset, idioma); `x-timezone` / `x-timezone-offset` / basura → default -06:00; prioridad de idioma
(clasificador > historial > `Accept-Language` > español); clasificador recibe mensaje crudo; system prompt `ai_chat_system`
sin variables e idéntico entre asesores (cache implícito) y estable entre vueltas; dominios (siempre activos, reminder↔commitment,
póliza→catálogo, vacío→todos, pantalla fuerza dominio); contexto de pantalla; `recall` alcanzable; sesión `policy_ingestion`;
pendientes (sin tareas no se ofrece resolve, inyección, resolver, aislamiento por sesión).

### `chat_payloads_test.ts` (tarjetas, RAG, inyección) — HTTP
Tarjetas `contact_list`, `contact_info`, `policy_list`, `reminder_list` (forma exacta, el modelo no ve `__skillMetadata`);
sin tarjeta → sin `metadata`; la última tarjeta gana; no se arrastra entre turnos; RAG: cita filtra adjuntos, marcador
`[[cite:]]` fuera de texto/historial/BD, resguardo por relevancia, sin storagePath, cita inexistente, RAG vacío fuerza texto;
adjuntos del contexto de pantalla; prompt injection en resultado de herramienta (no cambia herramientas ni system prompt,
viaja solo como `functionResponse`, un `[[cite:]]` inyectado no cuenta).

### `voice_rest_test.ts` — HTTP (comparten lógica con el chat)
`execute-tool` (mismo ejecutor y mismos sobres de error, tarjeta en `__skillMetadata`, cuota agotada → 200 con bandera);
`save-round` (historial con herramientas, un cobro, `chat_voice`, rondas acumuladas, sesión inexistente).

## Fallan hoy (bugs encontrados) — `ignore: true`

Verificado quitando el `ignore`: los 9 fallaban. Arreglados el 1, 3, 4, 5, 6 y 7 (2026-11-22 y antes); queda el 8 (`ignore: true`); el 6 también está arreglado.

1. ✅ **Arreglado 2026-11-22**: `processMessage` lanza `NotFoundError` (404 `RESOURCE_NOT_FOUND`) si la sesión no existe/es ajena, antes del modelo; el controller devuelve el cobro. ~~**sessionId de otro asesor / inexistente** (`chat_session_test.ts`, 2 tests): el RLS devuelve `null`, `ai_chat.service.ts:62-66`
   lo toma como sesión vacía, **gasta el modelo** y truena al final en `ai_session.service.ts:158` con 500 `INTERNAL_ERROR`
   (sin reembolso).~~ Esperado: 404 `RESOURCE_NOT_FOUND` antes de invocar al modelo. (Ajeno no filtra datos: el RLS lo impide;
   hay un test de caracterización que lo fija.)
2. ✅ **Arreglado (`c903411`).** **`sessionUsage` cuenta el turno dos veces** (`ai_session.service.ts:184-187`): se insertan las filas de `tokens_usage` del turno
   y LUEGO `getSessionTokens` las suma otra vez y se le añade `deltaUsage`. Turno 1 con 230 tokens de prompt devuelve 460.
3. ✅ **Arreglado 2026-11-22** (`globalErrorHandler`: SyntaxError del body → 422 `VALIDATION_FAILED`, toda ruta). ~~**JSON malformado → 500** en vez de 4xx (`ai.controller.ts:29`): `SyntaxError` no es `AppError`. No cobra.~~
4. ✅ **Arreglado 2026-11-22** (el controller reembolsa también ante errores que no son `AppError`). ~~**Timeout/red del proveedor se cobra** (`ai.controller.ts:40-44`): solo `AiProviderError` reembolsa; un `Error` crudo deja el cobro.~~
5. ✅ **Arreglado 2026-11-22** (`processMessage` marca `provider_error`/no facturable también ante errores crudos). ~~**Misma causa, sesión**: tras ese error crudo la sesión sigue `active` y facturable.~~
6. ✅ **Arreglado 2026-11-22** (candado de turno `ai_sessions.turn_locked_until`, `AiSessionService.acquireTurnLock`): el segundo mensaje simultáneo recibe 409 `RESOURCE_CONFLICT` antes del clasificador/modelo y se le devuelve el cobro; el primer turno se guarda íntegro. ~~**Carrera en la misma sesión**: dos mensajes simultáneos hacen leer-modificar-escribir del historial completo y el último
   pisa al primero (se pierde un mensaje).~~
7. ✅ **Arreglado 2026-11-21.** ~~Herramienta no ofrecida se ejecuta~~: `executeSkill` recibe la lista de herramientas ofrecidas en el turno (chat) o las de la voz (WebSocket y REST `execute-tool`) y rechaza cualquier otra con `Tool not available in this turn`. Prueba: "inyección: ejecutar una herramienta NO ofrecida en el turno se rechaza" y la de voz con `resolve_pending_task`.
8. **Voz `save-round` con sesión inexistente**: 500 sin código en vez de 404 (`voice_chat.service.ts` saveRound + `ai_session.service.ts:158`).

## Observaciones (no son bug confirmado, quedan caracterizadas)

- Mensaje del chat **sin tope de longitud** (200 KB pasan enteros al modelo): riesgo de costo; las notas sí tienen `NOTE_MAX_LENGTH`.
- Mensaje de solo espacios pasa y cuesta un mensaje.
- `AiError` (502) no reembolsa: es decisión explícita del código ("no es culpa del usuario" solo para `AiProviderError`).
- Varias skills con tarjeta en un turno: gana la última; una tarjeta suprime el `attachment_list`.

## Escenarios omitidos

- **SSE / streaming**: no existe todavía; el helper de transporte es lo único a agregar.
- **Timeout real del proveedor** (reintentos de `withAiRetry`): vive en `providers/`, fuera del alcance del servicio; se simula con `Error` crudo.
- **RAG real / embeddings / `recall` real**: son services con su propia suite; aquí se falsean (`skillOverrides`).
- **Mismatch de contacto / ingesta de póliza** (`/ai/ingest-policy`, `/resolve-contact-mismatch`): no comparten el bucle del chat.
- **RLS real**: lo cubre `supabase/tests/tenant_isolation.test.sql`; aquí el repo en memoria lo imita.
- **WebSocket de voz** (`/ai/voice`): requiere socket y Gemini Live.
