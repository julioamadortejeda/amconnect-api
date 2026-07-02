import { ConflictError } from "./errors.ts";

export function daysFromNowRange(days: number): { from: string; to: string } {
  return {
    from: new Date().toISOString(),
    to: new Date(Date.now() + days * 86400000).toISOString(),
  };
}

/**
 * Lanza ConflictError si ya existe una póliza activa con el mismo policy_number
 * para este agente. No hace nada si policyNumber es null/undefined/"" —
 * el número es opcional y varias pólizas sin número son válidas.
 */
export async function assertNoDuplicatePolicyNumber(
  policyService: { findByFilters(filters: Record<string, unknown>, limit?: number): Promise<{ id: string }[] | null> },
  agentId: string,
  policyNumber: string | null | undefined,
): Promise<void> {
  if (!policyNumber) return;
  const existing = await policyService.findByFilters({ agent_id: agentId, policy_number: policyNumber }, 1);
  if (existing && existing.length > 0) {
    throw new ConflictError(
      `Ya existe una póliza activa con el número '${policyNumber}'. Usa la opción de actualizar en vez de crear una nueva.`,
    );
  }
}

export async function resolveCatalogId(
  service: { getAll(): Promise<Record<string, unknown>[] | null> },
  queryText: string | undefined,
  defaultField: { key: string; value: string },
): Promise<string> {
  const items = await service.getAll();
  if (!items || items.length === 0) return "";

  if (queryText) {
    const q = queryText.toLowerCase().trim();
    const byCode = items.find((item) => item.code && String(item.code).toLowerCase() === q);
    if (byCode) return byCode.id as string;
    const byNameExact = items.find((item) => String(item.name).toLowerCase() === q);
    if (byNameExact) return byNameExact.id as string;
    const byNamePartial = items.find((item) => String(item.name).toLowerCase().includes(q));
    if (byNamePartial) return byNamePartial.id as string;
  }

  const byDefault = items.find((item) => String(item[defaultField.key]).toLowerCase() === defaultField.value.toLowerCase());
  return byDefault ? (byDefault.id as string) : (items[0]?.id as string ?? "");
}

export function appendNote(currentNotes: string | null | undefined, newNote: string): string {
  if (currentNotes && newNote.startsWith(currentNotes)) {
    return newNote;
  }
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  const entry = `[${day}/${month}/${year}]: ${newNote}`;
  return currentNotes ? `${currentNotes}\n${entry}` : entry;
}
