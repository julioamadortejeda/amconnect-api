import { BaseService } from "../../core/base_service.ts";
import { ContactRequestDTO, ContactResponseDTO } from "./contact.dto.ts";
import { ContactRepository } from "./contact.repository.ts";
import { objectToCamelCaseDeep, stripUndefined, toTitleCase } from "../../shared/case_converter.ts";
import { type Searchable, type SearchHit, type SearchOptions, toSearchHits } from "../../shared/search_hits.ts";

export class ContactService extends BaseService<ContactRequestDTO, ContactResponseDTO>
  implements Searchable<ContactResponseDTO> {
  private contactRepo: ContactRepository;

  constructor(repository: ContactRepository) {
    super(repository);
    this.contactRepo = repository;
  }

  protected override toDTO(row: unknown): ContactResponseDTO {
    return objectToCamelCaseDeep(row) as ContactResponseDTO;
  }

  protected override prepareForCreate(data: Partial<ContactRequestDTO>): Record<string, unknown> {
    const fullName = typeof data.fullName === "string" ? toTitleCase(data.fullName) : data.fullName;
    return {
      agent_id: data.agentId,
      full_name: fullName,
      email: data.email ?? null,
      phone: data.phone ?? null,
      birthdate: data.birthdate ?? null,
      rfc: data.rfc ?? null,
      curp: data.curp ?? null,
      address: data.address ?? null,
      occupation: data.occupation ?? null,
      referred_by_id: data.referredById ?? null,
      external_referrer_source: data.externalReferrerSource ?? null,
      is_prospect: data.isProspect ?? false,
    };
  }

  protected override prepareForUpdate(_id: string, data: Partial<ContactRequestDTO>): Record<string, unknown> {
    const fullName = typeof data.fullName === "string" ? toTitleCase(data.fullName) : undefined;
    return stripUndefined({
      full_name: fullName,
      email: data.email,
      phone: data.phone,
      birthdate: data.birthdate,
      rfc: data.rfc,
      curp: data.curp,
      address: data.address,
      occupation: data.occupation,
      referred_by_id: data.referredById,
      external_referrer_source: data.externalReferrerSource,
      is_prospect: data.isProspect,
    });
  }

  async findSimilarContact(agentId: string, query: string): Promise<ContactResponseDTO[]> {
    const rows = await this.contactRepo.findSimilar(agentId, query);
    return rows.map((r) => this.toDTO(r));
  }

  /**
   * Fuente "contact" de `recall` (ver shared/search_hits.ts). Mismo
   * `search_contacts` que la skill `search_contact`; `score` es su
   * word_similarity. `contactId` no aplica aquí y se ignora.
   */
  async searchHits(agentId: string, query: string, opts: SearchOptions = {}): Promise<SearchHit<ContactResponseDTO>[]> {
    const contacts = await this.findSimilarContact(agentId, query);
    return toSearchHits("contact", contacts, (c) => c.id, {
      limit: opts.limit,
      scoreOf: (c) => (c as ContactResponseDTO & { similarity?: number }).similarity,
    });
  }

  /** Busca un contacto existente por RFC o similitud de nombre, sin crear nada. */
  async findMatchingContact(
    agentId: string,
    fullName: string,
    rfc: string | null,
  ): Promise<{ id: string; fullName: string } | null> {
    if (rfc) {
      const byRfc = await this.getByField("rfc", rfc, 1);
      if (byRfc?.[0]) return { id: byRfc[0].id, fullName: byRfc[0].fullName };
    }
    const similar = await this.findSimilarContact(agentId, fullName);
    if (similar?.[0]) return { id: similar[0].id, fullName: similar[0].fullName };
    return null;
  }
}
