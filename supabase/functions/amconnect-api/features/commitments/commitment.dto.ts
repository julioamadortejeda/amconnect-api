export interface CommitmentResponseDTO {
  id: string;
  agentId: string;
  contactId: string | null;
  label: string;
  quote: string;
  dueFrom: string | null;
  dueTo: string | null;
  status: "OPEN" | "DONE" | "DISMISSED";
  resolutionNote: string | null;
  resolvedAt: string | null;
  /** Sesion de IA que lo cerro. `null` = lo cerro el asesor a mano. */
  resolvedBySessionId: string | null;
  createdAt: string;
  // Relación
  contact?: { id: string; fullName: string } | null;
}

export interface CommitmentListFilters {
  from?: string;
  to?: string;
  contactId?: string;
  /**
   * Texto libre sobre `label` y `quote`. Existe porque el asesor pregunta por
   * TEMA ("¿tengo algo de diagnostico con Alejandra?"), no por fecha, y sin
   * esto la unica forma de encontrar un compromiso por tema era listarlos
   * todos y leerlos — que es justo lo que el modelo no hace: se iba a
   * search_knowledge, volvia vacio y contestaba que no habia nada.
   */
  query?: string;
  status?: "OPEN" | "DONE" | "DISMISSED";
  /** Solo los que ya vencieron y siguen abiertos. */
  overdueOnly?: boolean;
  /** Solo los cerrados — para poder deshacer un cierre equivocado. */
  closedOnly?: boolean;
}

/**
 * Desenlace de un cierre. `already_closed` existe porque el modelo repite
 * llamadas: sin distinguirlo, el segundo intento se veia identico a un cierre
 * bueno (observado en produccion el 2026-09-04).
 */
export type CommitmentCloseResult =
  | { outcome: "closed"; commitment: CommitmentResponseDTO }
  | { outcome: "already_closed"; commitment: CommitmentResponseDTO }
  | { outcome: "not_found" };
