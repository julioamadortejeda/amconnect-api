export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function objectToSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toSnakeCase(k), v]),
  );
}

export function objectToCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toCamelCase(k), v]),
  );
}

// Conversión recursiva profunda — maneja objetos y arrays anidados
export function objectToSnakeCaseDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(objectToSnakeCaseDeep);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toSnakeCase(k),
        objectToSnakeCaseDeep(v),
      ]),
    );
  }
  return obj;
}

export function objectToCamelCaseDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(objectToCamelCaseDeep);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toCamelCase(k),
        objectToCamelCaseDeep(v),
      ]),
    );
  }
  return obj;
}

// Elimina las claves con valor undefined — para construir PATCHes parciales
// sin sobreescribir campos existentes en la DB.
export function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

// Aplana relaciones anidadas de Supabase en IDs planos.
// Ej: { contact: { id: 'abc', name: 'Juan' } } → { contact_id: 'abc' }
// Útil para preparar payloads de creación/actualización a partir de objetos con joins.
export function flattenRelations(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      if ("id" in nested) {
        result[`${toSnakeCase(key)}_id`] = nested.id;
      }
    } else {
      result[toSnakeCase(key)] = value;
    }
  }
  return result;
}
