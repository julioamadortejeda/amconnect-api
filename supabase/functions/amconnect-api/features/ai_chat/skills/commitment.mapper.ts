// Lo que el MODELO ve de los compromisos: hechos, nunca prosa (RULES §5).
import type { CommitmentCloseResult, CommitmentResponseDTO } from "../../commitments/commitment.dto.ts";

/** Los filtros tal como los pidió el modelo, para decirle cuáles vaciaron el resultado. */
export interface CommitmentListArgs {
  query?: unknown;
  contactId?: unknown;
  from?: unknown;
  to?: unknown;
  overdueOnly?: unknown;
  closedOnly?: unknown;
}

export function commitmentListResult(items: CommitmentResponseDTO[], args: CommitmentListArgs, sessionId: string) {
  // Que filters ESTRECHARON la busqueda. Importa cuando el resultado sale
  // vacio: sin filters, vacio significa "no tiene compromisos"; con
  // filters significa "ninguno pasa ESTE filtro", que es otra cosa.
  const filters: string[] = [];
  if (args.query) filters.push("query");
  if (args.contactId) filters.push("contact_id");
  if (args.from || args.to) filters.push("the date window");
  if (args.overdueOnly) filters.push("overdue_only");

  const emptyBecauseOfFilters = items.length === 0 && filters.length > 0;

  return {
    // Le promete al modelo que un vacio es un vacio de verdad, para que no
    // lo presente como "no encontre, tal vez buscando de otra forma".
    //
    // Pero solo cuando NO se estrecho la busqueda.
    //
    // OBSERVADO en produccion por voz el 2026-09-04: el asesor tiene DOS
    // clientes llamados Julio y el asistente contesto "no encontre ningun
    // compromiso de que Julio tuviera que entregarte el INE" — dos veces,
    // con el compromiso abierto y visible en la pantalla de inicio.
    //
    // DEDUCIDO, no visto: que mando el contact_id del Julio equivocado. No
    // hubo acceso a los argumentos de esa sesion. Lo que sí es seguro es
    // que con CUALQUIER filtro mal puesto la skill devolvia cero filas
    // jurando `exhaustive: true`, y con esa informacion negar rotundamente
    // es lo correcto: el modelo hizo lo que la herramienta le dijo.
    //
    // Por eso el arreglo va aqui y no en el prompt. La voz corre sobre
    // gemini-live-2.5-flash-native-audio, mas flojo con herramientas que el
    // modelo de texto —que en las mismas condiciones cerro 4 de 4— y no se
    // le puede pedir que razone mejor; lo que se puede es no dejarlo
    // concluir de mas.
    exhaustive: !emptyBecauseOfFilters,
    // Que filtros lo vaciaron es el dato; que hacer al respecto es politica
    // y vive en READING TOOL RESULTS del prompt.
    ...(emptyBecauseOfFilters ? { emptyBecauseOf: filters } : {}),
    count: items.length,
    // El hecho ya viaja por compromiso en closedByYouInThisConversation; que
    // hacer con esa marca es politica y vive en el prompt.
    commitments: items.map((c) => ({
      id: c.id,
      contactId: c.contactId,
      clientName: c.contact?.fullName ?? null,
      label: c.label,
      quote: c.quote,
      dueFrom: c.dueFrom,
      dueTo: c.dueTo,
      // Solo al listar cerrados, y solo los que cerro ESTA conversacion.
      //
      // Es lo que hace practico deshacer. "Solo era el primero" llega
      // despues de que el asistente cerro dos o tres seguidos, y sin esta
      // marca tendria que adivinar cuales entre TODOS los cerrados del
      // asesor —que en una cuenta con meses de uso son decenas— y podria
      // reabrir uno de hace tres semanas.
      ...(args.closedOnly && c.resolvedBySessionId === sessionId
        ? { closedByYouInThisConversation: true }
        : {}),
    })),
  };
}

/** Lo que el modelo necesita para confirmarle al asesor qué quedó registrado. */
export function commitmentSummary(c: CommitmentResponseDTO) {
  return {
    id: c.id,
    label: c.label,
    clientName: c.contact?.fullName ?? null,
    dueFrom: c.dueFrom,
    dueTo: c.dueTo,
  };
}

export function closeCommitmentResult(result: CommitmentCloseResult) {
  if (result.outcome === "not_found") {
    return { error: "No commitment found with that id for this advisor." };
  }

  // Cerrar lo ya cerrado NO se reporta como exito. Antes devolvia
  // `status: DONE` igual que un cierre bueno, y el modelo lo leia como
  // confirmacion de haber hecho algo: en produccion (2026-09-04) llamo dos
  // veces con el mismo id y remato diciendole al asesor que habia cerrado
  // dos compromisos. Nada de lo que dijo era falso por si solo; lo falso
  // era la cuenta.
  if (result.outcome === "already_closed") {
    return { alreadyClosed: true, label: result.commitment.label };
  }

  return {
    id: result.commitment.id,
    label: result.commitment.label,
    status: result.commitment.status,
    resolutionNote: result.commitment.resolutionNote,
  };
}
