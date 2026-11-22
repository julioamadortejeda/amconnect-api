// Trabajo que debe terminar aunque el cliente ya se haya ido (p. ej. guardar el
// turno cancelado de un stream SSE). En Supabase Edge, `EdgeRuntime.waitUntil`
// evita que el worker se apague a media escritura; fuera de ese runtime (tests,
// Deno local) no existe y la promesa simplemente sigue su curso.
interface EdgeRuntimeLike {
  waitUntil?(promise: Promise<unknown>): void;
}

export function keepAlive(promise: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  runtime?.waitUntil?.(promise.catch(() => {}));
}
