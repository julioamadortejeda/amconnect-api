import { importPKCS8, SignJWT } from "npm:jose";

// Token OAuth2 de Google Cloud emitido con la service account de
// FIREBASE_SERVICE_ACCOUNT (scope cloud-platform). Caché a nivel de módulo:
// firmar el JWT + canjearlo cuesta un round-trip a Google por llamada si no
// se cachea. Se renueva con margen antes de expirar.
const TOKEN_RENEWAL_MARGIN_MS = 60 * 1000;
let cachedOauthToken: { token: string; expiresAt: number } | null = null;

export async function getGoogleCloudAccessToken(): Promise<string> {
  return (await getGoogleCloudAccessTokenInfo()).token;
}

// minRemainingMs: vida mínima garantizada del token devuelto. La voz (Live API)
// entrega el token al cliente para una sesión de hasta 10 min — pedir un margen
// mayor fuerza renovación y evita que la sesión muera con un token casi vencido.
export async function getGoogleCloudAccessTokenInfo(
  minRemainingMs = TOKEN_RENEWAL_MARGIN_MS,
): Promise<{ token: string; expiresAt: number }> {
  if (cachedOauthToken && Date.now() < cachedOauthToken.expiresAt - minRemainingMs) {
    return cachedOauthToken;
  }

  const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT no configurado para generar tokens de Vertex AI.");
  }
  const serviceAccount = JSON.parse(serviceAccountJson.trim().replace(/^['"]|['"]$/g, "").replace(/%$/, "").trim());
  const privateKeyPem = serviceAccount.private_key;
  const privateKey = await importPKCS8(privateKeyPem, "RS256");

  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/cloud-platform",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setExpirationTime("10m")
    .setIssuedAt()
    .sign(privateKey);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Cloud OAuth token request failed: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  // Google reporta la vida real del token en expires_in (segundos, ~3600);
  // si no viene, asumimos los 10 min del exp del JWT.
  const lifetimeMs = (typeof data.expires_in === "number" ? data.expires_in : 600) * 1000;
  cachedOauthToken = { token: data.access_token, expiresAt: Date.now() + lifetimeMs };
  return cachedOauthToken;
}
