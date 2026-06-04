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
- **Códigos de catálogo en inglés:** `ACTIVE`, `LIFE`, `PAYMENT`; nombres/descripciones en español
- **Soft delete:** `is_active = false` + `deleted_at`, nunca `DELETE`
- **snake_case en DB, camelCase en DTOs** — conversión en `prepareForCreate/Update` de cada service
- **Convención SQL:** funciones standalone sin prefijo (`search_contacts`), triggers con `tg_`, funciones de trigger con `tgfn_`
- **Migraciones:** `supabase migration up` para local; NUNCA `supabase db push` (apunta al remoto)
