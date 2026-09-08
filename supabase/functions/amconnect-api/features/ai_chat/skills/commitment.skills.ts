import { z } from "zod";
import { assertHasChanges, SkillDefinition } from "./skill.core.ts";

/**
 * Compromisos: lo que quedó pendiente con cada cliente. Nacen en el asistente
 * —el asesor se lo cuenta— y NO de la ingesta de notas: ese camino se quitó
 * para que las notas volvieran a ser expediente y nada más.
 *
 * Estas skills existen porque el RAG NO puede contestar preguntas temporales ni
 * enumerativas. `search_knowledge` devuelve las notas más parecidas a la
 * pregunta; si el asesor tiene 12 clientes que buscar en noviembre, trae 5 y no
 * hay forma de saber que faltaron 7. Aquí la consulta es SQL: salen todos.
 */
export const commitmentSkills: SkillDefinition[] = [
  {
    domain: "commitment",
    declaration: {
      name: "get_commitments",
      description:
        "Lists the advisor's open commitments: what each client is waiting on, who asked to be contacted on a certain date, and what the advisor promised. This is the ONLY correct tool for time-based or list-style questions about pending matters — 'who should I call this month', 'who owes me documents', 'what do I have pending with María'. It also searches BY TOPIC through `query` ('do I have anything about a diagnostic session with Alejandra'). It returns ALL matching commitments, not a sample, so never fall back to knowledge search for these questions. Use search_knowledge only for questions about what was SAID in a note ('what did María tell me about her job'), not about what is pending.",
      schema: z.object({
        from: z.string().optional().describe(
          "Start of the window in ISO date (YYYY-MM-DD), in the advisor's local time. For 'this month', use the first day of the current month from the [CONTEXT] block.",
        ),
        to: z.string().optional().describe(
          "End of the window (YYYY-MM-DD). For 'this month', the last day of the current month.",
        ),
        contact_id: z.string().optional().describe(
          "UUID of a contact, to list only what is pending with that client.",
        ),
        query: z.string().optional().describe(
          "Free text matched against what was promised. Use the advisor's own topic word " +
            "('diagnostico', 'cotizacion', 'INE'), NOT a whole sentence and NOT a client name — " +
            "for a client use contact_id. Omit it to list everything in the window.",
        ),
        overdue_only: z.boolean().optional().describe(
          "True to list ONLY commitments whose date already passed and are still open — what slipped through.",
        ),
        closed_only: z.boolean().optional().describe(
          "True to list ONLY commitments already closed. Use it to find the one to undo when the " +
            "advisor says you closed the wrong thing ('ese no era', 'todavia no me lo manda').",
        ),
      }),
    },
    async execute(args, ctx) {
      const params = args as Record<string, unknown>;
      const items = await ctx.commitmentService.list(ctx.agentId, {
        from: params.from as string | undefined,
        to: params.to as string | undefined,
        contactId: params.contact_id as string | undefined,
        query: params.query as string | undefined,
        overdueOnly: params.overdue_only as boolean | undefined,
        closedOnly: params.closed_only as boolean | undefined,
      });

      // Que filters ESTRECHARON la busqueda. Importa cuando el resultado sale
      // vacio: sin filters, vacio significa "no tiene compromisos"; con
      // filters significa "ninguno pasa ESTE filtro", que es otra cosa.
      const filters: string[] = [];
      if (params.query) filters.push("query");
      if (params.contact_id) filters.push("contact_id");
      if (params.from || params.to) filters.push("the date window");
      if (params.overdue_only) filters.push("overdue_only");

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
        ...(emptyBecauseOfFilters
          ? {
            instruction:
              `Empty because of the filters you sent (${filters.join(", ")}), NOT because the ` +
              "advisor has no commitments. A contact_id can be the wrong person when two clients " +
              "share a first name, a date window hides everything outside it, and a query only " +
              "matches those exact words. Call get_commitments again with NO filters and read the " +
              "labels and client names yourself before telling them anything is missing.",
          }
          : {}),
        count: items.length,
        ...(params.closed_only
          ? {
            undoHint:
              "The ones marked closedByYouInThisConversation are the ones YOU just closed. When " +
              "the advisor corrects you — 'solo era el primero', 'ese no', 'el del documento " +
              "todavia no' — reopen from among those, never from the older ones they closed " +
              "themselves.",
          }
          : {}),
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
          ...(params.closed_only && c.resolvedBySessionId === ctx.sessionId
            ? { closedByYouInThisConversation: true }
            : {}),
        })),
      };
    },
  },
  {
    domain: "commitment",
    declaration: {
      name: "create_commitment",
      description:
        "Records something the advisor has to follow up on but that does NOT belong on a specific day. " +
        "THE DATE DECIDES between this and create_reminder: if you can pin ONE day without inventing it, " +
        "that is a reminder and it rings; if the advisor gives a fuzzy window ('en unos días', 'la próxima " +
        "semana', 'en diciembre'), gives no time at all, or is asked for a day and does not settle on one, " +
        "it is a commitment and it does not ring. Never interrogate the advisor for a date they do not have: " +
        "create the commitment, then offer to schedule it if they want to be alerted on a particular day. " +
        "Also use it when the advisor is just telling you what happened ('Rafael me va a mandar sus " +
        "resultados') — there, propose it first and create it once they agree, because they did not ask " +
        "you for anything. NEVER call this twice for the same pending matter: if you already created it " +
        "in this conversation, change it with update_commitment instead of creating a duplicate.",
      schema: z.object({
        label: z.string({ required_error: "A short description of what is pending is required" })
          .describe(
            "What is pending, in a few words, in the advisor's language. 'buscar a José', " +
              "'esperando resultados médicos de Rafael'. Free text — there is no fixed list. " +
              "YOU write it from the conversation; NEVER ask the advisor to word it for you.",
          ),
        quote: z.string({ required_error: "The advisor's own words are required" }).describe(
          "The sentence the advisor already wrote where they mentioned this — from ANY of their " +
            "messages in this conversation, not necessarily the last one. When they answer a " +
            "follow-up question ('al segundo', 'sí, ese'), the sentence you want is still the " +
            "earlier one where they told you what happened. Prefer their exact words, but a close " +
            "copy is fine and NOTHING is rejected: it is shown to them days later so they " +
            "recognise where the pending matter came from. NEVER ask the advisor for this — you " +
            "already have everything they wrote. Asking is always the wrong move.",
        ),
        contact_id: z.string().optional().describe(
          "UUID of the client this is about. Call search_contact first when the advisor names " +
            "someone. Leave empty when the search finds nobody — create the commitment without " +
            "a client rather than losing it, and offer to add the person afterwards.",
        ),
        due_from: z.string().optional().describe(
          "Start of the window as ISO date (YYYY-MM-DD), resolved against the current date in " +
            "[CONTEXT]. 'la próxima semana' -> that Monday. 'en diciembre' -> December 1st. " +
            "Omit when there is no time reference at all.",
        ),
        due_to: z.string().optional().describe(
          "End of the window (YYYY-MM-DD). 'la próxima semana' -> that Sunday. 'en diciembre' -> " +
            "December 31st. Omit when due_from is omitted.",
        ),
      }),
    },
    async execute(args, ctx) {
      const params = args as Record<string, unknown>;
      const created = await ctx.commitmentService.create(ctx.agentId, {
        label: params.label as string,
        quote: params.quote as string,
        contactId: params.contact_id as string | undefined,
        dueFrom: params.due_from as string | undefined,
        dueTo: params.due_to as string | undefined,
        source: ctx.advisorWords,
      });

      return {
        id: created.id,
        label: created.label,
        clientName: created.contact?.fullName ?? null,
        dueFrom: created.dueFrom,
        dueTo: created.dueTo,
        // Para que el modelo no le prometa al asesor un aviso que no existe.
        ringsAnAlarm: false,
      };
    },
  },
  {
    domain: "commitment",
    declaration: {
      name: "update_commitment",
      description:
        "Completes or corrects a commitment that already exists. Its main use is ATTACHING THE " +
        "CLIENT: when the advisor names someone ambiguous, record the commitment right away so it " +
        "is never lost, ask which person they meant, and the moment they answer call this to link " +
        "them. Never claim a commitment is linked to a client unless this call (or create_commitment " +
        "with contact_id) actually succeeded. Also use it to fix the wording or add a date the " +
        "advisor gives you later. Call get_commitments first if you do not have the id.",
      schema: z.object({
        commitment_id: z.string({ required_error: "The UUID of the commitment is required" })
          .describe("UUID of the commitment to change. From create_commitment or get_commitments."),
        contact_id: z.string().optional().describe(
          "UUID of the client to attach — the reason this skill usually exists. PASS IT: calling this " +
            "with only commitment_id changes nothing and fails. Take the UUID from the search_contact " +
            "results already in this conversation; do not search again unless you lost them.",
        ),
        label: z.string().optional().describe("A better wording of what is pending."),
        due_from: z.string().optional().describe(
          "Start of the window (YYYY-MM-DD), when the advisor gives a date they did not have before.",
        ),
        due_to: z.string().optional().describe("End of the window (YYYY-MM-DD)."),
      }),
    },
    async execute(args, ctx) {
      const params = args as Record<string, unknown>;
      // Alias tolerantes (RULES §5): el modelo renombra parámetros seguido, y
      // aquí un nombre no reconocido se vuelve "nada que actualizar" y deja el
      // compromiso huérfano.
      const changes = {
        contactId: (params.contact_id ?? params.client_id) as string | undefined,
        label: (params.label ?? params.title) as string | undefined,
        dueFrom: (params.due_from ?? params.from) as string | undefined,
        dueTo: (params.due_to ?? params.to) as string | undefined,
      };
      // Mensaje propio antes del genérico: el de assertHasChanges dice "pregunta
      // al asesor qué quiere cambiar", que aquí es exactamente lo que NO debe
      // hacer — el dato que falta es un UUID que el asesor no conoce. Sin esto
      // el modelo recibía el rechazo y creaba el compromiso OTRA VEZ (duplicado).
      if (Object.values(changes).every((v) => v === undefined)) {
        throw new Error(
          "update_commitment needs the field you are changing. To attach the client — the usual " +
            "case — pass contact_id with the UUID you got from search_contact. Do NOT ask the " +
            "advisor for it, and do NOT call create_commitment again: the commitment already exists.",
        );
      }
      // Regla del CLAUDE.md: sin esto una actualización vacía es indistinguible
      // de una exitosa y el modelo le confirma al asesor un cambio que no pasó.
      assertHasChanges(changes);

      const updated = await ctx.commitmentService.update(
        ctx.agentId,
        (params.commitment_id ?? params.id) as string,
        changes,
      );
      if (!updated) {
        return { error: "No open commitment found with that id for this advisor." };
      }
      return {
        id: updated.id,
        label: updated.label,
        clientName: updated.contact?.fullName ?? null,
        dueFrom: updated.dueFrom,
        dueTo: updated.dueTo,
      };
    },
  },
  {
    domain: "commitment",
    declaration: {
      name: "reopen_commitment",
      description:
        "Undoes a close: puts a commitment back in the advisor's pending list. Use it the moment " +
        "they say the wrong one was closed ('ese no era', 'todavia no me lo manda', 'regresamelo'), " +
        "AND when they narrow down after you closed something ('solo era el primero', 'nada mas " +
        "el de la INE', 'el del documento todavia no'). READ THOSE THE RIGHT WAY ROUND: whatever " +
        "they NAME is the part that was true, so that one STAYS CLOSED — you reopen the OTHERS. " +
        "'Solo era la INE' means the INE was really delivered; reopening it is the exact opposite " +
        "of what they asked. The ids are ALREADY in this conversation — every close_commitment " +
        "you made carries its id and label in the transcript, and a correction always refers to " +
        "something you closed moments ago, right here. Take the id from there. Only call " +
        "get_commitments with closed_only if you cannot; the entries marked " +
        "closedByYouInThisConversation are yours. If nothing you closed is what they are taking " +
        "back, reopen NOTHING, and never create a new commitment for something already sitting " +
        "open — check get_commitments before assuming it is missing. Say which ones you brought " +
        "back, by their exact labels.",
      schema: z.object({
        commitment_id: z.string({ required_error: "The UUID of the commitment is required" })
          .describe("UUID of the commitment to reopen, from get_commitments with closed_only."),
      }),
    },
    async execute(args, ctx) {
      const params = args as Record<string, unknown>;
      const result = await ctx.commitmentService.reopen(
        ctx.agentId,
        (params.commitment_id ?? params.id) as string,
      );
      if (!result) {
        return { error: "No commitment found with that id for this advisor." };
      }
      return { id: result.id, label: result.label, status: result.status };
    },
  },
  {
    domain: "commitment",
    declaration: {
      name: "close_commitment",
      description:
        "Marks a commitment as resolved. Use it when the advisor says a pending matter is done — 'the one " +
        "about José's documents, he already sent them'. Call get_commitments first to get the id. " +
        "Close ONE, never several, and only when EXACTLY ONE open commitment can be what they meant: " +
        "if two or more could match, close nothing, list them by label and ask which one. ALWAYS tell " +
        "the advisor which one you closed, by its exact label — that sentence is how they catch a wrong " +
        "guess. If they say it was the wrong one, undo it with reopen_commitment.",
      schema: z.object({
        commitment_id: z.string({ required_error: "The UUID of the commitment is required" })
          .describe("UUID of the commitment to close"),
        resolution_note: z.string().optional().describe(
          "What the advisor said about how it was resolved ('ya me mandó los documentos'). Saved as the record of why it was closed.",
        ),
        dismissed: z.boolean().optional().describe(
          "True when the commitment no longer applies rather than having been fulfilled (the client cancelled, it stopped being relevant).",
        ),
      }),
    },
    async execute(args, ctx) {
      const params = args as Record<string, unknown>;
      const id = (params.commitment_id ?? params.id) as string;

      const result = await ctx.commitmentService.close(
        ctx.agentId,
        id,
        params.dismissed === true ? "DISMISSED" : "DONE",
        params.resolution_note as string | undefined,
        ctx.sessionId,
      );
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
        return {
          error: `"${result.commitment.label}" was ALREADY closed before this call — nothing changed. ` +
            "Do NOT count it as something you just did, and do not mention it as closed unless the " +
            "advisor asked about it. If you meant a different commitment, call get_commitments " +
            "with no filters and pick the right id.",
          alreadyClosed: true,
          label: result.commitment.label,
        };
      }

      return {
        id: result.commitment.id,
        label: result.commitment.label,
        status: result.commitment.status,
        resolutionNote: result.commitment.resolutionNote,
      };
    },
  },
];
