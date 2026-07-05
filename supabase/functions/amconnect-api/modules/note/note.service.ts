import type { NoteRepository, NoteResponseDTO, PolicyNoteRow, RecentNoteRow } from "./note.repository.ts";

/**
 * Capa de servicio para notas de conocimiento (agent_notes).
 * Hoy delega directo al repositorio, pero mantiene el contrato
 * controller → service → repository del resto de los módulos.
 */
export class NoteService {
  constructor(private repository: NoteRepository) {}

  getByContactId(contactId: string): Promise<NoteResponseDTO[]> {
    return this.repository.getByContactId(contactId);
  }

  getByPolicyId(policyId: string): Promise<PolicyNoteRow[]> {
    return this.repository.getByPolicyId(policyId);
  }

  getRecent(limit = 20): Promise<RecentNoteRow[]> {
    return this.repository.getRecent(limit);
  }

  deleteNote(agentId: string, noteId: string): Promise<void> {
    return this.repository.deleteNote(agentId, noteId);
  }

  getNotesSummary(): Promise<Record<string, number>> {
    return this.repository.getNotesSummary();
  }

  searchNotes(limit = 20, offset = 0, search?: string): Promise<RecentNoteRow[]> {
    return this.repository.searchNotes(limit, offset, search);
  }
}
