import type { ContactResponseDTO } from "../../modules/contact/contact.dto.ts";
import type { PolicyResponseDTO } from "../../modules/policy/policy.dto.ts";
import type { ReminderResponseDTO } from "../../modules/reminder/reminder.dto.ts";
import type { CommitmentResponseDTO } from "../commitments/commitment.dto.ts";
import type { NoteMatch } from "../rag/rag.repository.ts";

export const RECALL_GROUPS = ["contacts", "policies", "reminders", "commitments", "notes", "documents"] as const;
export type RecallGroup = (typeof RECALL_GROUPS)[number];

/** `agent_notes.source_type` de cada grupo de notas (D-013). */
export const NOTE_SOURCE_TYPES = ["text"] as const;
export const DOCUMENT_SOURCE_TYPES = ["pdf", "image", "audio", "document"] as const;

/** Un documento (o nota) = una fila de agent_notes; sus fragmentos se agrupan por `noteId`. */
export interface RecallDocument {
  noteId: string;
  sourceType: string;
  fileName: string | null;
  contactId: string | null;
  policyId: string | null;
  reminderId: string | null;
  createdAt: string;
  chunks: NoteMatch[];
  moreInDocument: boolean;
}

export interface RecallGroupResult<T> {
  items: T[];
  moreAvailable: boolean;
}

export interface RecallGroups {
  contacts?: RecallGroupResult<ContactResponseDTO>;
  policies?: RecallGroupResult<PolicyResponseDTO>;
  reminders?: RecallGroupResult<ReminderResponseDTO>;
  commitments?: RecallGroupResult<CommitmentResponseDTO>;
  notes?: RecallGroupResult<RecallDocument>;
  documents?: RecallGroupResult<RecallDocument>;
}

export interface RecallResult {
  searchId: string;
  page: number;
  groups: RecallGroups;
}

export interface RecallParams {
  query: string;
  contactId?: string;
  page?: number;
  groups?: RecallGroup[];
  searchId?: string;
  /** Busca solo dentro de este documento (sin tope por documento; la página es de fragmentos). */
  noteId?: string;
}

/** Cuántas palabras ocupa un elemento en lo que ve el modelo (`"chunks"`: fragmento al pedir un documento). */
export type RecallWeigh = (group: RecallGroup | "chunks", item: unknown) => number;
