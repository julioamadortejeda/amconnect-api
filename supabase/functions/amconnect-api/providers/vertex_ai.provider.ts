import { GoogleGenAI } from "@google/genai";
import { GoogleGenAiProvider } from "./google_genai.provider.ts";
import { PromptService } from "../modules/prompt/prompt.service.ts";
import { SignJWT, importPKCS8 } from "npm:jose";

/**
 * VertexAiProvider — usa Vertex AI autenticando con una API key de GCP
 * (creada en Credentials y restringida a la Vertex AI API). El proyecto y la
 * región vienen amarrados a la key, por lo que NO se pasan al cliente: el SDK
 * rechaza combinar project/location con apiKey ("mutually exclusive").
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
  }

  override async createEphemeralToken(
    model: string,
    _systemInstruction: string,
    _tools: Record<string, unknown>[],
  ): Promise<{ token: string; url: string; headers: Record<string, string> | null; expireTime: string; model: string }> {
    const projectId = Deno.env.get("VERTEX_PROJECT_ID") ?? "";
    const location = Deno.env.get("VERTEX_LOCATION") ?? "us-central1";
    const now = Date.now();
    const expireTime = new Date(now + 10 * 60 * 1000).toISOString();

    const oauthToken = await this.getGoogleCloudAccessToken();
    const url = `wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;

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

  private async getGoogleCloudAccessToken(): Promise<string> {
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
    return data.access_token;
  }
}
