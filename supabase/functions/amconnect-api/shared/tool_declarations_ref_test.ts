import { assert } from "jsr:@std/assert@1";
import { AVAILABLE_DOMAINS, POLICY_INGESTION_DOMAINS } from "../features/ai_chat/chat_turn.ts";
import { buildToolDeclarations } from "./tool_declarations.ts";

// Gemini/Vertex rechazan "$ref" en function_declarations (400 INVALID_ARGUMENT):
// pasó el 2026-11-22 cuando get_expiring_policies reutilizó el mismo esquema Zod
// en from_date y to_date y zod-to-json-schema lo convirtió en $ref.
Deno.test("tool declarations: ningún esquema lleva $ref", () => {
  const json = JSON.stringify([buildToolDeclarations(AVAILABLE_DOMAINS), buildToolDeclarations(POLICY_INGESTION_DOMAINS), buildToolDeclarations(AVAILABLE_DOMAINS, { clean: true })]);
  assert(!json.includes('"$ref"'), "hay un $ref en las declaraciones de herramientas");
});
