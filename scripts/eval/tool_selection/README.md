# Eval de selección de herramientas

Script de desarrollo (no se despliega). Compara los modos `TOOL_SELECTION_MODE`
(`all` vs `by_domain`, ver `supabase/functions/amconnect-api/shared/assistant.config.ts`)
contra el backend LOCAL. **Cada corrida llama a Gemini y cuesta dinero.**

## Cómo correrlo

1. Levanta Supabase local y la función con el modo a medir:
   edita `TOOL_SELECTION_MODE` en `assistant.config.ts` y reinicia
   `supabase functions serve amconnect-api --env-file ./supabase/.env.local --no-verify-jwt`.
2. Variables de entorno (todas requeridas, sin defaults):

   ```bash
   export EVAL_BASE_URL=http://127.0.0.1:54321   # API de Supabase local (la función cuelga de /functions/v1/amconnect-api)
   export EVAL_ANON_KEY=<anon key de `supabase status`>
   export EVAL_EMAIL=<asesor demo>
   export EVAL_PASSWORD=<su password>
   ```

3. Desde la raíz del backend:

   ```bash
   deno run -A scripts/eval/tool_selection/run_eval.ts --mode-label all --runs 3
   # cambia el modo en config, reinicia la función, y:
   deno run -A scripts/eval/tool_selection/run_eval.ts --mode-label by_domain --runs 3
   deno run --allow-read scripts/eval/tool_selection/compare.ts \
     scripts/eval/tool_selection/results/by_domain-<ts>.json \
     scripts/eval/tool_selection/results/all-<ts>.json
   ```

Flags: `--runs N` (default 3), `--mode-label X` (solo una etiqueta; el modo real lo
define el config del servidor), `--only <id>` (una pregunta), `--dry-run` (valida
`questions.json` y muestra el plan y el formato del resumen; sin red ni variables).

Nota: el cupo `ai` es 20 peticiones/min; el script espera `Retry-After` en 429.
También cada pregunta gasta cuota mensual de chat del asesor.

## Qué mide por corrida (sesión de chat nueva cada vez)

- **Herramientas llamadas**: la API no las expone; se leen de `ai_sessions.history`
  (partes `functionCall` del modelo) por PostgREST con el JWT del asesor (RLS).
- **Pass**: `expectedTools` ⊆ llamadas y ninguna de `forbiddenTools`.
- **Escrituras** (`isWrite`): si la respuesta final dice haber hecho la acción y no
  apareció fila nueva en `writeTable` (default `reminders`; `created_at` desde el
  inicio de la corrida) cuenta como *false-success*. El "claim" es una heurística de
  regex; revisa a mano los casos marcados.
- **Idioma de respuesta** (`detectReplyLanguage`, `unknown` si es muy corta; no se castiga).
- **Latencia** total (incluye follow-ups) y **tokens** (suma de `tokens_usage` de la
  sesión: prompt, cached, completion; cache % = cached / prompt).

## Archivos

- `questions.json`: preguntas (`id, category, lang, text, expectedTools, forbiddenTools?, isWrite?, writeTable?, followUps?`). Los nombres son del asesor demo local.
- `run_eval.ts`: corre y escribe `results/<label>-<timestamp>.json` y `.md`.
- `compare.ts`: tabla lado a lado de dos resultados.
- `lib.ts`: tipos y agregación.
- `results/`: salidas (ignoradas por git).
