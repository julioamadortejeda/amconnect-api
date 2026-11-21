import type { PaginatedResult } from "../../core/repository.interface.ts";
import type { NoteRepository, NoteResponseDTO, PolicyNoteRow, RecentNoteRow } from "./note.repository.ts";

/**
 * Capa de servicio para notas de conocimiento (agent_notes).
 * Hoy delega directo al repositorio, pero mantiene el contrato
 * controller → service → repository del resto de los módulos.
 */
export class NoteService {
  constructor(private repository: NoteRepository) {}

  getByContactId(contactId: string, page: number, pageSize: number): Promise<PaginatedResult<NoteResponseDTO>> {
    return this.repository.getByContactId(contactId, page, pageSize);
  }

  getByPolicyId(policyId: string, page: number, pageSize: number): Promise<PaginatedResult<PolicyNoteRow>> {
    return this.repository.getByPolicyId(policyId, page, pageSize);
  }

  getByReminderId(reminderId: string, page: number, pageSize: number): Promise<PaginatedResult<NoteResponseDTO>> {
    return this.repository.getByReminderId(reminderId, page, pageSize);
  }

  deleteNote(agentId: string, noteId: string): Promise<void> {
    return this.repository.deleteNote(agentId, noteId);
  }

  getNotesSummary(): Promise<Record<string, number>> {
    return this.repository.getNotesSummary();
  }

  searchNotes(page: number, pageSize: number, search?: string): Promise<PaginatedResult<RecentNoteRow>> {
    return this.repository.searchNotes(page, pageSize, search);
  }
}
