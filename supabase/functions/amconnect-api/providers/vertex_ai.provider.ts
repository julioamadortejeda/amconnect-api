import { GoogleGenAI } from "@google/genai";
import { GoogleGenAiProvider } from "./google_genai.provider.ts";
import { PromptService } from "../modules/prompt/prompt.service.ts";
import { getGoogleCloudAccessToken, getGoogleCloudAccessTokenInfo } from "../shared/google_oauth.ts";
import { AiGenerationResult, AiMessage } from "../core/ai_provider.interface.ts";
import { AiError } from "../shared/errors.ts";

// Interceptor global para redirección y autenticación OAuth2 en Vertex AI
let isInterceptorSetup = false;

function setupVertexFetchInterceptor() {
  if (isInterceptorSetup) return;
  isInterceptorSetup = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = input.toString();

    // Solo interceptamos si la petición va dirigida a Vertex AI
    if (urlStr.includes("aiplatform.googleapis.com")) {
      let token: string;
      try {
        token = await getGoogleCloudAccessToken();
      } catch (err) {
        // Sin token no hay petición válida: dejar pasar la API key produciría
        // un 401 de Vertex que enmascara la causa real.
        console.error("[VERTEX] No se pudo obtener el token OAuth:", err);
        throw err;
      }

      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      headers.delete("x-goog-api-key"); // Eliminamos la API Key de las cabeceras

      const url = new URL(urlStr);
      url.searchParams.delete("key"); // Eliminamos la API Key de la URL

      // En modo express el SDK no conoce project/location (la API key no los
      // permite), así que arma rutas inválidas para OAuth de dos formas:
      // - generateContent: ruta SIN proyecto (/v1beta1/publishers/...) →
      //   Vertex responde RESOURCE_PROJECT_INVALID.
      // - Interactions API: antepone projects/undefined/locations/undefined →
      //   Vertex responde CONSUMER_SUSPENDED sobre 'projects/undefined'.
      // Normalizamos ambas al recurso completo y, si la región no es global,
      // al host regional correspondiente.
      const needsProjectInsert = !url.pathname.includes("/projects/");
      const hasUndefinedProject = url.pathname.includes("/projects/undefined/");
      if (needsProjectInsert || hasUndefinedProject) {
        const projectId = Deno.env.get("VERTEX_PROJECT_ID");
        if (!projectId) {
          throw new Error("VERTEX_PROJECT_ID no configurado — requerido para llamar Vertex AI con OAuth.");
        }
        const location = Deno.env.get("VERTEX_LOCATION") ?? "global";
        if (hasUndefinedProject) {
          url.pathname = url.pathname
            .replace("/projects/undefined/", `/projects/${projectId}/`)
            .replace("/locations/undefined/", `/locations/${location}/`);
        } else {
          url.pathname = url.pathname.replace(
            /^\/(v1[a-z0-9]*)\//,
            `/$1/projects/${projectId}/locations/${location}/`,
          );
        }
        if (location !== "global") {
          url.hostname = `${location}-aiplatform.googleapis.com`;
        }
      }

      return originalFetch(url.toString(), {
        ...init,
        headers,
      });
    }
    return originalFetch(input, init);
  };
}

/**
 * VertexAiProvider — el SDK se inicializa con la API key de GCP solo para que
 * el constructor no truene (el build de @google/genai que carga Deno no trae
 * soporte OAuth compilado y exige apiKey). Las peticiones reales salen por el
 * interceptor de fetch, que reemplaza la key por un token OAuth de la service
 * account y reescribe la URL al recurso completo del proyecto.
 * Cumple con LFPDPPP al procesar datos dentro de infraestructura Google Cloud.
 */
export class VertexAiProvider extends GoogleGenAiProvider {
  constructor(
    apiKey: string,
    model: string,
    promptService?: PromptService,
  ) {
    super(
      new GoogleGenAI({ vertexai: true, apiKey }),
      model,
      promptService,
      apiKey,
    );
    // Configuramos el interceptor para esta instancia de Vertex
    setupVertexFetchInterceptor();
  }

  // El Interactions API solo existe en la Gemini API (AI Studio); el endpoint
  // /interactions de Vertex responde "Unsupported model interaction" para
  // cualquier modelo (verificado 2026-07-08). En Vertex el chat se resuelve
  // con generateContent usando el historial completo que mantiene el service.
  override async processInteraction(
    _messageOrSteps: string | Record<string, unknown>[],
    tools: Record<string, unknown>[],
    systemInstruction?: string,
    _previousInteractionId?: string,
    history?: AiMessage[],
  ): Promise<AiGenerationResult & { interactionId?: string }> {
    if (!history?.length) {
      throw new AiError(
        "VertexAiProvider.processInteraction requiere el historial completo (Vertex no soporta el Interactions API).",
      );
    }
    return await this.processUserRequest(history, tools, systemInstruction);
  }

  override async createEphemeralToken(
    model: string,
    _systemInstruction: string,
    _tools: Record<string, unknown>[],
  ): Promise<{ token: string; url: string; headers: Record<string, string> | null; expireTime: string; model: string }> {
    const projectId = Deno.env.get("VERTEX_PROJECT_ID") ?? "";
    // Región propia para Live API: los modelos live NO están en `global`
    // (donde sí vive el modelo de texto — VERTEX_LOCATION); verificado
    // 2026-07-08: setupComplete solo en us-central1.
    const location = Deno.env.get("VERTEX_LIVE_LOCATION") ?? "us-central1";

    // Vida mínima de 12 min: la sesión de voz dura hasta 10 y el token OAuth
    // cacheado podría estar por vencer. expireTime reporta la expiración real.
    const { token: oauthToken, expiresAt } = await getGoogleCloudAccessTokenInfo(12 * 60 * 1000);
    const expireTime = new Date(expiresAt).toISOString();
    // Con location=global no hay prefijo regional en el host (global-aiplatform
    // no existe como dominio).
    const wsHost = location === "global"
      ? "aiplatform.googleapis.com"
      : `${location}-aiplatform.googleapis.com`;
    const url = `wss://${wsHost}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;

    return {
      token: oauthToken,
      url,
      headers: {
        "Authorization": `Bearer ${oauthToken}`,
      },
      expireTime,
      model: `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
    };
  }
}
