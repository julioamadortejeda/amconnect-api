import type { ContactRequestDTO, ContactResponseDTO } from "./contact.dto.ts";
import type { ContactService } from "./contact.service.ts";
import type { UsageService } from "../subscription/usage.service.ts";
import {
  type KnowledgeIngestionService,
  QUICK_NOTE_MAX_LENGTH,
} from "../../features/document_processing/knowledge_ingestion.service.ts";

/**
 * Resultado de buscar a un cliente por cómo lo nombró el asesor. El service
 * dice QUÉ pasó; qué decirle al modelo en cada caso lo decide la skill.
 */
export type ContactNameResolution =
  | { outcome: "none" }
  | { outcome: "ambiguous"; matches: ContactResponseDTO[] }
  | { outcome: "unique"; contact: ContactResponseDTO };

export type AddNoteByNameResult =
  | { outcome: "none" }
  | { outcome: "ambiguous"; matches: ContactResponseDTO[] }
  | { outcome: "added"; contact: ContactResponseDTO };

type ContactDeps = Pick<ContactService, "findSimilarContact" | "create">;
type UsageDeps = Pick<UsageService, "checkAndIncrementIngestion">;
type IngestionDeps = Pick<KnowledgeIngestionService, "ingestText">;

/**
 * Flujos de contacto que cruzan módulos: resolver un cliente por nombre y
 * guardarle notas (cuota de ingesta + RAG). Lo usan las skills del asistente
 * y lo podrá usar `recall` o cualquier otro flujo sin pasar por una skill.
 */
export class ContactWorkflowService {
  constructor(
    private contactService: ContactDeps,
    private usageService: UsageDeps,
    private knowledgeIngestionService: IngestionDeps,
  ) {}

  /** Un nombre → ninguno, varios (para preguntar cuál) o exactamente uno. */
  async resolveByName(agentId: string, name: string): Promise<ContactNameResolution> {
    const contacts = await this.contactService.findSimilarContact(agentId, name);
    if (!contacts || contacts.length === 0) return { outcome: "none" };
    if (contacts.length > 1) return { outcome: "ambiguous", matches: contacts };
    return { outcome: "unique", contact: contacts[0] };
  }

  /**
   * Crea el contacto y, si viene, le guarda la nota inicial. Devuelve null si
   * el insert no regresó fila (igual que `ContactService.create`).
   */
  async createWithNotes(
    agentId: string,
    sessionId: string,
    input: Partial<ContactRequestDTO>,
    notes?: string,
  ): Promise<ContactResponseDTO | null> {
    const contact = await this.contactService.create(input);
    if (!contact) return null;
    if (notes) await this.addNote(agentId, sessionId, contact.id, notes);
    return contact;
  }

  /**
   * Guarda una nota de texto en el expediente del cliente.
   *
   * La cuota de ingesta solo se descuenta si el texto necesita el resumen de
   * IA (ver QUICK_NOTE_MAX_LENGTH): una nota corta siempre se trackea (tokens
   * de embedding), pero no consume créditos del plan.
   */
  async addNote(agentId: string, sessionId: string, contactId: string, content: string): Promise<void> {
    if (content.length > QUICK_NOTE_MAX_LENGTH) {
      await this.usageService.checkAndIncrementIngestion(agentId);
    }
    await this.knowledgeIngestionService.ingestText(agentId, sessionId, {
      content,
      sourceType: "text",
      contactId,
    });
  }

  /** Resuelve al cliente por nombre y, solo si es uno, le guarda la nota. */
  async addNoteByName(
    agentId: string,
    sessionId: string,
    clientName: string,
    content: string,
  ): Promise<AddNoteByNameResult> {
    const resolution = await this.resolveByName(agentId, clientName);
    if (resolution.outcome !== "unique") return resolution;
    await this.addNote(agentId, sessionId, resolution.contact.id, content);
    return { outcome: "added", contact: resolution.contact };
  }
}
