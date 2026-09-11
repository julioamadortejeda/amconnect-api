import { Context } from "hono";
import { z } from "zod";
import { sendSuccess } from "../../shared/api_response.ts";
import { AppError } from "../../shared/errors.ts";
import { CommitmentService } from "../../features/commitments/commitment.service.ts";

const CloseCommitmentSchema = z.object({
  resolutionNote: z.string().optional().nullable(),
  /** true cuando el compromiso dejó de aplicar en vez de haberse cumplido. */
  dismissed: z.boolean().optional(),
});

export class CommitmentController {
  static async getAll(c: Context) {
    const agentId: string = c.get("agent_id");
    const service = c.get("services").commitmentService as CommitmentService;

    const items = await service.list(agentId, {
      from: c.req.query("from") ?? undefined,
      to: c.req.query("to") ?? undefined,
      contactId: c.req.query("contactId") ?? undefined,
      overdueOnly: c.req.query("overdueOnly") === "true",
      // El filtro de texto ya existía para el asistente (search_commitment_ids);
      // faltaba exponerlo para que la agenda pueda buscar en su pestaña de
      // compromisos con el mismo criterio que en la de recordatorios.
      query: c.req.query("query")?.trim() || undefined,
    });

    return sendSuccess(c, items);
  }

  static async close(c: Context) {
    const id = c.req.param("id");
    if (!id) throw new AppError("El parámetro 'id' es requerido.", 400);

    const agentId: string = c.get("agent_id");
    // Schema.parse: el ZodError lo formatea el globalErrorHandler (RULES §2).
    const parsed = CloseCommitmentSchema.parse(await c.req.json().catch(() => ({})));

    const service = c.get("services").commitmentService as CommitmentService;
    const result = await service.close(
      agentId,
      id,
      parsed.dismissed === true ? "DISMISSED" : "DONE",
      parsed.resolutionNote ?? undefined,
    );

    if (result.outcome === "not_found") throw new AppError("Compromiso no encontrado.", 404);

    // Ya cerrado no es error para la app: la palomita de la Agenda se puede
    // tocar dos veces —o dos dispositivos pueden cerrarlo a la vez— y el
    // usuario ya obtuvo lo que queria. Se responde el compromiso tal cual.
    return sendSuccess(c, result.commitment);
  }
}
