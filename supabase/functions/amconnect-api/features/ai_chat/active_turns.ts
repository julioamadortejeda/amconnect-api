// Turnos de chat en curso en ESTA instancia de la Edge Function, para que
// `POST /ai/sessions/:id/cancel` pueda detener uno a medias (§7.3).
//
// Limitación: es memoria del isolate. Si el cancel cae en otra instancia que
// la que corre el turno, no lo encuentra y el turno sigue hasta terminar (o
// hasta que el cliente se desconecte, que sí lo detiene). La fuente de verdad
// de "hay un turno en curso" sigue siendo el candado `turn_locked_until`.

export interface ActiveTurn {
  signal: AbortSignal;
  /** Quita el turno del registro; llamarlo en `finally`. */
  release(): void;
}

export class ActiveTurnRegistry {
  private turns = new Map<string, AbortController>();

  register(sessionId: string): ActiveTurn {
    const controller = new AbortController();
    this.turns.set(sessionId, controller);
    return {
      signal: controller.signal,
      release: () => {
        // Solo si sigue siendo el suyo: no borrar el de un turno posterior.
        if (this.turns.get(sessionId) === controller) this.turns.delete(sessionId);
      },
    };
  }

  /** Pide detener el turno en curso de la sesión. `true` si había uno aquí. */
  cancel(sessionId: string): boolean {
    const controller = this.turns.get(sessionId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  has(sessionId: string): boolean {
    return this.turns.has(sessionId);
  }
}

/** Registro compartido del isolate (un AiChatService nace por request). */
export const activeTurns = new ActiveTurnRegistry();
