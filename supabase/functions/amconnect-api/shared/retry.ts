/**
 * Reintento con espera creciente para los tropiezos del proveedor de IA.
 *
 * Por que existe: el 2026-09-11 un asesor vio "El servicio de IA no esta
 * disponible (429)" y perdio su pregunta. El 429 de Vertex NO habla de su
 * consumo — los modelos Gemini se sirven de una bolsa compartida, asi que basta
 * con que otros proyectos esten apretando la region para que a el le toque en su
 * primera pregunta del dia. La documentacion de Google es explicita: sin una
 * suscripcion de Provisioned Throughput, un 429 significa que el pozo comun esta
 * ocupado, y la recomendacion para eso es exponential backoff with jitter.
 *
 * Hasta hoy no habia UN solo reintento en el backend: el mensaje le pedia al
 * asesor que volviera a intentar en unos segundos, o sea que le pasabamos a el
 * el trabajo que le toca al codigo.
 *
 * El presupuesto es corto a proposito. El chat da hasta MAX_LOOPS vueltas al
 * modelo por turno, asi que cada reintento se multiplica: con 2 intentos extra
 * y estas esperas, el peor caso agrega ~1.6s por llamada y no arriesga el limite
 * de tiempo de la Edge Function.
 */

/** Cuantos intentos EXTRA despues del primero. */
const MAX_RETRIES = 2;

/** Espera base por intento, en ms. Se le suma jitter. */
const BACKOFF_MS = [400, 1200];

/**
 * Solo lo transitorio.
 *
 * 429 y 503 son "ahorita no, vuelve": capacidad compartida ocupada o servicio
 * saturado. 500 NO se reintenta aunque `wrapGeminiError` lo trate igual de cara
 * al asesor — puede ser una peticion que siempre va a fallar, y repetirla tres
 * veces solo la hace fallar mas lento.
 */
function isRetryable(e: unknown): boolean {
  // deno-lint-ignore no-explicit-any
  const err = e as any;
  const status: number | undefined = err?.status ?? err?.statusCode ?? err?.httpStatus;
  return status === 429 || status === 503;
}

/**
 * El jitter evita que todos los asesores que tropezaron en el mismo segundo
 * vuelvan a pegarle al proveedor exactamente a la vez, que es como un pico se
 * convierte en dos.
 */
function backoffWithJitter(attempt: number): number {
  const base = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return base + Math.floor(Math.random() * base * 0.3);
}

/** Corre `fn` y la reintenta mientras el error sea transitorio. */
export async function withAiRetry<T>(context: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= MAX_RETRIES || !isRetryable(e)) throw e;

      const delay = backoffWithJitter(attempt);
      // deno-lint-ignore no-explicit-any
      const status = (e as any)?.status ?? (e as any)?.statusCode;
      console.warn(
        `[AI] ${context}: transient ${status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
