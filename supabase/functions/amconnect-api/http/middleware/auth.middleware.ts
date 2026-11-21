import { Context, MiddlewareHandler, Next } from "hono";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.ts";
import { UnauthorizedError } from "../../shared/errors.ts";

// Verificación del JWT con `auth.getClaims()` en vez de `auth.getUser()`.
//
// - Proyecto con llaves ASIMÉTRICAS (ES256/RS256, "JWT Signing Keys"): verifica
//   la firma aquí mismo contra el JWKS del proyecto (se descarga una vez y queda
//   en caché por isolate) y revisa `exp`. Cero llamadas de red por petición.
// - Proyecto con el secreto HS256 legado (hoy el stack local, y prod mientras no
//   migre de llaves): supabase-js cae SOLO a `getUser()`, o sea exactamente lo
//   que se hacía antes. Nunca acepta un token sin verificar.
//
// Lo que se pierde con llaves asimétricas: un token de una sesión cerrada (o de
// un usuario borrado) sigue valiendo hasta su `exp` (jwt_expiry = 1 h). Es lo
// mismo que ya hace PostgREST con cada consulta, así que no abre nada que no
// estuviera abierto: quien tiene el token puede hablarle directo al Data API.
// Un usuario borrado se cae en el DI (su fila de `agents` ya no existe).
type ClientFactory = (authHeader: string) => SupabaseClient;

const defaultClientFactory: ClientFactory = (authHeader) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") as string;
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  }) as unknown as SupabaseClient;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAuthMiddleware(makeClient: ClientFactory = defaultClientFactory): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedError("Token de autorización inválido o ausente.");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) throw new UnauthorizedError("Token de autorización inválido o ausente.");

    const supabase = makeClient(authHeader);

    let claims: Record<string, unknown> | undefined;
    try {
      const { data, error } = await supabase.auth.getClaims(token);
      if (error || !data?.claims) throw new UnauthorizedError("Token inválido o expirado.");
      claims = data.claims as Record<string, unknown>;
    } catch (error) {
      // getClaims relanza errores que no son de Auth (p. ej. `alg` desconocido o
      // una llave que WebCrypto no puede importar): también son token inválido.
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError("Token inválido o expirado.");
    }

    // Solo tokens de sesión de un asesor: sin `sub`, con rol anon/service_role
    // o de usuario anónimo, no hay asesor que autenticar.
    const sub = claims.sub;
    if (
      typeof sub !== "string" || !UUID_RE.test(sub) ||
      claims.role !== "authenticated" ||
      claims.is_anonymous === true
    ) {
      throw new UnauthorizedError("Token inválido o expirado.");
    }

    c.set("agent_id", sub);
    c.set("supabase", supabase);

    await next();
  };
}

export const authMiddleware = createAuthMiddleware();
