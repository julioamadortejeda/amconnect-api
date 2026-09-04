import { CommitmentCloseResult, CommitmentListFilters, CommitmentResponseDTO } from "./commitment.dto.ts";
import { CommitmentRepository, CommitmentUpdate } from "./commitment.repository.ts";

/** Solo lo que se puede cambiar después. `quote` no: ver `CommitmentUpdate`. */
export interface UpdateCommitmentInput {
  contactId?: string | null;
  label?: string;
  dueFrom?: string | null;
  dueTo?: string | null;
}

export interface CreateCommitmentInput {
  label: string;
  quote: string;
  contactId?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  /**
   * Todo lo que el asesor ha escrito en la conversación. Cuando viene, la cita
   * se verifica contra él. En voz no viene —el contexto de skills se arma una
   * vez por sesión, no por turno— y ahí la verificación se salta en vez de
   * mentir.
   */
  source?: string | null;
}

/**
 * Normaliza para comparar citas: minúsculas, sin acentos, sin puntuación y
 * **sin espacios**.
 *
 * Compactar así de agresivo no es exceso: sin ello la validación se cae con
 * cualquier dedazo del asesor. Caso real — el texto decía "qu ela busque en
 * noviembre" y el modelo copió la cita corrigiendo el typo, "que la busque en
 * noviembre". La misma frase, descartada por un espacio mal puesto.
 *
 * Sigue atrapando lo que importa: una cita inventada no comparte los caracteres
 * del original, con o sin espacios.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // acentos
    .replace(/[^a-z0-9]/g, ""); // puntuación, espacios y saltos de línea
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CommitmentService {
  constructor(private repository: CommitmentRepository) {}

  /**
   * Crea un compromiso a partir de lo que el asesor le dijo al asistente.
   *
   * La cita literal es lo que hace que el asesor le crea a la fila en vez de
   * sospechar que se la inventaron, así que se verifica cuando hay contra qué.
   * Verificar es avisar, no bloquear: ver el comentario del `console.warn`.
   */
  async create(agentId: string, input: CreateCommitmentInput): Promise<CommitmentResponseDTO> {
    const label = input.label?.trim();
    const quote = input.quote?.trim();

    // Error plano con mensaje accionable EN INGLÉS: lo lee el modelo, no el
    // asesor. `executeSkill` atrapa cualquier throw —AppError incluido— y lo
    // devuelve como `ok: false` con este texto, así que el modelo puede corregir
    // y volver a llamar.
    if (!label || !quote) {
      throw new Error(
        "A commitment needs both a label and the advisor's own words it comes from.",
      );
    }

    // Avisa, no bloquea. La cita importa —el asesor la lee días después, en la
    // ficha del cliente, cuando ya no se acuerda de si lo dijo así— pero el
    // pendiente importa más: perderlo por una frase parafraseada es un
    // intercambio pésimo, y tronar aquí ya costó una conversación entera en
    // bucle de disculpas.
    if (input.source && !normalize(input.source).includes(normalize(quote))) {
      // Sin el label ni la cita: los dos traen nombres de clientes y lo que
      // dijeron, y eso no va a los logs.
      console.warn("[Commitments] Cita no literal, se guarda igual.");
    }

    const { dueFrom, dueTo } = this.normalizeWindow(input.dueFrom ?? null, input.dueTo ?? null);

    return await this.repository.insertOne({
      agentId,
      contactId: input.contactId ?? null,
      label,
      quote,
      dueFrom,
      dueTo,
    });
  }

  /**
   * Completa un compromiso que ya existe — sobre todo, le pega el cliente.
   *
   * Existe porque la regla del asistente es "primero el registro, después el
   * cliente": cuando el asesor nombra a alguien ambiguo, el pendiente se guarda
   * de inmediato para no perderlo y el cliente se pregunta después. Sin esta
   * operación esa segunda mitad era imposible y el modelo la fingía — decía
   * "lo registré con Julio César" sobre un compromiso que quedaba huérfano.
   *
   * Las fechas se re-normalizan solo si viene alguna: pasar `dueFrom` suelto
   * define una ventana de un día, igual que al crear.
   */
  async update(
    agentId: string,
    id: string,
    input: UpdateCommitmentInput,
  ): Promise<CommitmentResponseDTO | null> {
    const changes: CommitmentUpdate = {};

    if (input.contactId !== undefined) changes.contactId = input.contactId;

    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) throw new Error("The label cannot be empty.");
      changes.label = label;
    }

    if (input.dueFrom !== undefined || input.dueTo !== undefined) {
      const { dueFrom, dueTo } = this.normalizeWindow(
        input.dueFrom ?? null,
        input.dueTo ?? null,
      );
      changes.dueFrom = dueFrom;
      changes.dueTo = dueTo;
    }

    return await this.repository.update(agentId, id, changes);
  }

  /**
   * Una fecha suelta vale como ventana de un día; una invertida se endereza.
   * Cualquier cosa que no sea YYYY-MM-DD se descarta y el compromiso queda sin
   * fecha — sigue sirviendo como pendiente que envejece, solo que no aparece en
   * las consultas por mes.
   */
  private normalizeWindow(
    rawFrom: string | null,
    rawTo: string | null,
  ): { dueFrom: string | null; dueTo: string | null } {
    const from = rawFrom && ISO_DATE.test(rawFrom) ? rawFrom : null;
    const to = rawTo && ISO_DATE.test(rawTo) ? rawTo : null;

    if (!from && !to) return { dueFrom: null, dueTo: null };
    if (from && !to) return { dueFrom: from, dueTo: from };
    if (!from && to) return { dueFrom: to, dueTo: to };
    return from! <= to! ? { dueFrom: from, dueTo: to } : { dueFrom: to, dueTo: from };
  }

  list(agentId: string, filters: CommitmentListFilters = {}): Promise<CommitmentResponseDTO[]> {
    return this.repository.list(agentId, filters);
  }

  /** Deshace un cierre equivocado. Ver `CommitmentRepository.reopen`. */
  reopen(agentId: string, id: string): Promise<CommitmentResponseDTO | null> {
    return this.repository.reopen(agentId, id);
  }


  /** Ver `CommitmentRepository.close`: devuelve el desenlace, no un null ambiguo. */
  close(
    agentId: string,
    id: string,
    status: "DONE" | "DISMISSED" = "DONE",
    resolutionNote?: string,
    sessionId?: string,
  ): Promise<CommitmentCloseResult> {
    return this.repository.close(agentId, id, status, resolutionNote, sessionId);
  }
}
