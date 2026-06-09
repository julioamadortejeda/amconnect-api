import { BaseService } from "../../core/base_service.ts";
import { ContactRequestDTO, ContactResponseDTO } from "./contact.dto.ts";
import { ContactRepository } from "./contact.repository.ts";
import { objectToCamelCaseDeep, stripUndefined } from "../../shared/case_converter.ts";

export class ContactService extends BaseService<ContactRequestDTO, ContactResponseDTO> {
  private contactRepo: ContactRepository;

  constructor(repository: ContactRepository) {
    super(repository);
    this.contactRepo = repository;
  }

  protected override toDTO(row: unknown): ContactResponseDTO {
    return objectToCamelCaseDeep(row) as ContactResponseDTO;
  }

  protected override prepareForCreate(data: Partial<ContactRequestDTO>): Record<string, unknown> {
    return {
      agent_id: data.agentId,
      full_name: data.fullName,
      email: data.email ?? null,
      phone: data.phone ?? null,
      birthdate: data.birthdate ?? null,
      rfc: data.rfc ?? null,
      curp: data.curp ?? null,
      address: data.address ?? null,
      occupation: data.occupation ?? null,
      notes: data.notes ?? null,
      referred_by_id: data.referredById ?? null,
      external_referrer_source: data.externalReferrerSource ?? null,
    };
  }

  protected override prepareForUpdate(_id: string, data: Partial<ContactRequestDTO>): Record<string, unknown> {
    return stripUndefined({
      full_name: data.fullName,
      email: data.email,
      phone: data.phone,
      birthdate: data.birthdate,
      rfc: data.rfc,
      curp: data.curp,
      address: data.address,
      occupation: data.occupation,
      notes: data.notes,
      referred_by_id: data.referredById,
      external_referrer_source: data.externalReferrerSource,
    });
  }

  async findSimilarContact(agentId: string, query: string): Promise<ContactResponseDTO[] | null> {
    const rows = await this.contactRepo.findSimilar(agentId, query);
    return rows ? rows.map((r) => this.toDTO(r)) : null;
  }
}
