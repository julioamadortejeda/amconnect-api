import { Context } from "hono";
import { z } from "zod";
import { sendSuccess } from "../../shared/api_response.ts";
import { AppError } from "../../shared/errors.ts";
import { CommitmentService } from "../../features/commitments/commitment.service.ts";
import { validated } from "../middleware/validate.ts";
import { CommitmentsQuerySchema, IdParamSchema } from "../routes/route_schemas.ts";

export const CloseCommitmentSchema = z.object({
  resolutionNote: z.string().optional().nullable(),
  /** true cuando el compromiso dejó de aplicar en vez de haberse cumplido. */
  dismissed: z.boolean().optional(),
});

export class CommitmentController {
  static async getAll(c: Context) {
    const agentId: string = c.get("agent_id");
    const service = c.get("services").commitmentService as CommitmentService;

    const { page, pageSize, ...filters } = validated(c, "query", CommitmentsQuerySchema);

    // `query` ya existía para el asistente (search_commitment_ids); se expone
    // para que la agenda busque en su pestaña de compromisos con el mismo
    // criterio que en la de recordatorios.
    return sendSuccess(c, await service.listPage(agentId, filters, page, pageSize));
  }

  static async close(c: Context) {
    const { id } = validated(c, "param", IdParamSchema);

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
