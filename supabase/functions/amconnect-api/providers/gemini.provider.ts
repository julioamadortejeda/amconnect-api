import { GoogleGenAI } from "@google/genai";
import { GoogleGenAiProvider } from "./google_genai.provider.ts";
import { PromptService } from "../modules/prompt/prompt.service.ts";

export class GeminiProvider extends GoogleGenAiProvider {
  constructor(apiKey: string, model: string, promptService?: PromptService) {
    super(new GoogleGenAI({ apiKey }), model, promptService);
  }
}
