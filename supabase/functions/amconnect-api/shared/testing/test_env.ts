// Variables de entorno mínimas para poder IMPORTAR módulos que leen config al
// cargar (`shared/config.ts` truena sin GEMINI_MODEL: fail closed, RULES §6).
//
// Importar este archivo PRIMERO en el test, antes que el módulo bajo prueba:
// los imports estáticos se evalúan en orden, así que el env queda listo antes
// de que config.ts corra.
//
// Solo valores de mentira y solo si la variable no existe: nunca se lee ningún
// .env ni se llama a un servicio real (las pruebas corren sin --allow-net).
const TEST_ENV: Record<string, string> = {
  GEMINI_MODEL: "test-text-model",
  GEMINI_LIVE_MODEL: "test-live-model",
  VERTEX_LIVE_MODEL: "test-live-model",
  AI_BACKEND: "studio",
};

for (const [name, value] of Object.entries(TEST_ENV)) {
  if (!Deno.env.get(name)) Deno.env.set(name, value);
}
