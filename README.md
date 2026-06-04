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
