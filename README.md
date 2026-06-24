# AmConnect — Backend

Backend de AmConnect: asistente inteligente para asesores de seguros en México. Construido sobre Supabase Edge Functions (Deno + Hono), con AI conversacional, procesamiento de pólizas PDF y búsqueda vectorial.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Deno 2 (Supabase Edge Functions) |
| HTTP | Hono v4 + Zod validator |
| Base de datos | Supabase (PostgreSQL 17) |
| Vector store | pgvector |
| Storage | Supabase Storage |
| Auth | Supabase Auth (JWT) |
| AI Chat + Embeddings | Gemini API — `gemini-2.0-flash`, `text-embedding-004` |
| AI Documentos | Vertex AI — Google Cloud |

---

## Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (para stack local)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- Deno 2 (opcional; el CLI de Supabase lo incluye para las Edge Functions)

---

## Setup local

```bash
# 1. Copia y configura las variables de entorno
cp supabase/.env.local.example supabase/.env.local
# Edita .env.local con tus keys reales

# 2. Levanta el stack (Docker debe estar corriendo)
supabase start

# 3. Aplica las migraciones
supabase migration up

# 4. Sirve la Edge Function
supabase functions serve amconnect-api \
  --env-file ./supabase/.env.local \
  --no-verify-jwt
```

La API queda disponible en `http://127.0.0.1:54321/functions/v1/amconnect-api`.

---

## Variables de entorno

Crea `supabase/.env.local` a partir del ejemplo:

| Variable | Descripción |
|----------|-------------|
| `SUPABASE_URL` | URL local del stack (`http://127.0.0.1:54321`) |
| `SUPABASE_ANON_KEY` | Clave pública (anon) — en `supabase start` output |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio — en `supabase start` output |
| `GEMINI_API_KEY` | Google AI Studio — para chat y embeddings |
| `VERTEX_PROJECT_ID` | Google Cloud project — para procesamiento de PDFs |
| `VERTEX_LOCATION` | Región Vertex AI (ej. `us-central1`) |

---

## Comandos útiles

```bash
# Aplicar migraciones pendientes (local)
supabase migration up

# Generar tipos TypeScript desde el schema actual
supabase gen types typescript --local \
  > supabase/functions/amconnect-api/types/supabase.ts

# Crear nueva migración
supabase migration new <nombre_descriptivo>

# Resetear la DB local (aplica todas las migraciones desde cero)
supabase db reset

# Ver logs de la Edge Function
supabase functions serve amconnect-api --env-file ./supabase/.env.local --inspect
```

> **Importante:** Usa siempre `supabase migration up` para local. `supabase db push` apunta al proyecto remoto.

---

## Estructura del proyecto

```
backend/
├── bruno/                          # Colección de requests (Bruno API Client)
│   ├── environments/               # local.bru — gitignored (tiene anon_key)
│   └── {agents,ai,catalog,contacts,policies,reminders}/
│
└── supabase/
    ├── config.toml                 # Configuración del proyecto Supabase
    ├── migrations/                 # 001–016 SQL — NO modificar, crear nueva migración
    └── functions/amconnect-api/
        ├── index.ts                # Entry point (Hono app)
        ├── deno.json               # Imports map + tasks
        ├── core/                   # Interfaces + clases base (contrato estable)
        ├── shared/                 # errors.ts, api_response.ts, case_converter.ts
        ├── types/                  # supabase.ts (auto-generado)
        ├── providers/              # gemini.provider.ts, vertex_ai.provider.ts
        ├── modules/                # Módulos de dominio
        │   ├── agent/              # Perfil del asesor
        │   ├── catalog/            # Aseguradoras, ramos, productos, divisas, etc.
        │   ├── contact/            # Clientes/contactos
        │   ├── policy/             # Pólizas, participantes, beneficiarios
        │   └── reminder/           # Recordatorios
        ├── features/               # Casos de uso complejos
        │   ├── rag/                # Búsqueda vectorial sobre notas (embeddings)
        │   ├── document_processing/# Extracción de datos de PDFs con IA
        │   └── ai_chat/            # Chat conversacional con function calling
        │       └── skills/         # Herramientas disponibles para el AI
        └── http/
            ├── controllers/        # Un controller por módulo/feature
            ├── routes/             # Router maestro
            └── middleware/
                ├── auth.middleware.ts
                ├── error.middleware.ts
                └── di/index.ts     # Inyección de dependencias
```

---

## Patrones clave

**Nuevo módulo de dominio:**
1. Crea `modules/<nombre>/<nombre>.dto.ts` + `.repository.ts` + `.service.ts`
2. Registra en `http/middleware/di/index.ts`
3. Agrega rutas en `http/routes/index.ts`

**Nueva migración:**
```bash
supabase migration new <nombre>
# Edita el SQL generado
supabase migration up
```

**Nueva skill de AI:**
1. Agrega la definición en `features/ai_chat/skills/<dominio>.skills.ts`
2. Registra en `features/ai_chat/skills/index.ts`

**Discovery en skills — catálogos:**
- Catálogo pequeño/global → skill `get_<tipo>` que devuelve todos los registros (~7-20)
- Catálogo grande o por agente → skill `search_<tipo>(query)` con búsqueda pg_trgm

**Convenciones SQL:**
- Funciones standalone sin prefijo: `search_contacts`
- Triggers: `tg_agents_after_insert`
- Funciones de trigger: `tgfn_create_agent_profile`
- Soft delete: `is_active = false` + `deleted_at` (nunca `DELETE`)
- Códigos de catálogo en inglés (`ACTIVE`, `LIFE`); nombres/descripciones en español

---

## Bruno (API Client)

Abre la carpeta `bruno/` en [Bruno](https://www.usebruno.com/). Para el entorno local, crea `environments/local.bru` (gitignored) con:

```
vars {
  base_url: http://127.0.0.1:54321/functions/v1/amconnect-api
  anon_key: <tu anon key de supabase start>
  access_token:
}
```

---

## Historial del Flujo de Sesión de Voz (Legacy WebSocket vs. Flujo Actual)

Históricamente, la aplicación utilizaba un flujo donde Supabase actuaba como un proxy de WebSockets. Por razones de estabilidad y rendimiento, se migró a un modelo descentralizado de tokens efímeros. A continuación se detallan ambos flujos:

### 1. Flujo Legacy (Supabase como Proxy WebSocket)
* **Endpoint:** `GET /ai/voice` (vía WebSocket Upgrade)
* **Arquitectura:**
  ```
  [Flutter Client] <--- WebSocket ---> [Supabase Edge Function] <--- WebSocket ---> [Gemini Live API]
  ```
* **Mecanismo:**
  1. El cliente iniciaba una conexión WebSocket a Supabase (`/ai/voice`).
  2. La función de Supabase actualizaba la conexión mediante `Deno.upgradeWebSocket(c.req.raw)`.
  3. Para mantener el V8 isolate activo, se utilizaba `EdgeRuntime.waitUntil(...)`.
  4. La función de Supabase abría una segunda conexión WebSocket saliente directa a la Gemini Live API usando la `GEMINI_API_KEY` del backend.
  5. Supabase actuaba como un proxy bidireccional puro, transmitiendo fragmentos de audio PCM, transcripciones y eventos entre el cliente y Gemini.
  6. Si Gemini requería una herramienta (tool call), Supabase la interceptaba, ejecutaba la lógica/base de datos dentro del contexto de la Edge Function, y devolvía el resultado a Gemini de inmediato a través del WebSocket.
* **Limitaciones/Desventajas:**
  * **Límites de tiempo de ejecución (Timeout):** Las Edge Functions de Supabase tienen restricciones estrictas de duración máxima por petición. Mantener una conexión WebSocket activa durante llamadas de voz prolongadas causaba desconexiones prematuras por parte del router de Supabase.
  * **Latencia y Sobrecarga:** Canalizar ráfagas constantes de audio PCM a través de la Edge Function agregaba un salto de red extra innecesario y un consumo elevado de memoria/CPU en el runtime de Deno.

### 2. Flujo Actual (Directo con Tokens Efímeros)
* **Endpoints Relacionados:**
  * `POST /ai/voice/token` (Genera token de acceso temporal de Gemini)
  * `POST /ai/voice/init` (Inicializa la sesión y obtiene instrucciones de sistema y herramientas configuradas)
  * `POST /ai/voice/execute-tool` (Ejecuta una herramienta de base de datos o lógica de negocio vía HTTP estándar)
  * `POST /ai/voice/save-round` (Registra el consumo de tokens y transcripción de voz al final del turno)
* **Arquitectura:**
  ```
  [Flutter Client] <---------------- WebSocket Directo ----------------> [Gemini Live API]
        |
        +-- (Llamadas HTTP REST para Config/Tools/Save) --> [Supabase Edge Function]
  ```
* **Mecanismo:**
  1. El cliente solicita un token de corta duración a Supabase a través de `POST /ai/voice/token` y la configuración de sesión en `POST /ai/voice/init`.
  2. Supabase genera un **token efímero** de Gemini usando la API de Auth de Google (limitado al modelo configurado y salida tipo `AUDIO`), evitando exponer la API Key maestra en el cliente.
  3. El cliente abre el WebSocket bidireccional **directamente** con Gemini Live API usando dicho token efímero.
  4. Cuando Gemini solicita ejecutar una herramienta, el cliente intercepta la petición y llama a la Edge Function de Supabase vía HTTP estándar (`POST /ai/voice/execute-tool`).
  5. Al concluir cada ronda o terminar la sesión, el cliente reporta las transcripciones y los metadatos de uso a Supabase con `POST /ai/voice/save-round` para guardar el historial y aplicar controles de cuota.

