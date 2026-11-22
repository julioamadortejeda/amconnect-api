// Idioma de respuesta SIN llamar a un modelo. Función pura: solo español e
// inglés (los dos idiomas de la app). Cuenta palabras funcionales comunes,
// acentos y signos ¿¡ de cada idioma; si el mensaje es muy corto o no hay
// ventaja clara, devuelve el `fallback` (el idioma que ya traía la
// conversación o el que el asesor configuró).

export type ReplyLanguage = "Spanish" | "English";

export interface DetectedLanguage {
  language: ReplyLanguage;
  source: "detected" | "fallback";
}

// Palabras de un idioma que NO existen en el otro. Las que se escriben igual en
// ambos ("no", "me", "son", "sin", "he"...) no votan.
const ES_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "y", "en", "que", "qué", "por",
  "para", "con", "se", "su", "sus", "mi", "mis", "tu", "tus", "es", "está", "están", "fue", "tengo",
  "tiene", "tienen", "hay", "cuál", "cuáles", "cuándo", "cuánto", "cuántos", "cuántas", "dónde", "quién", "cómo",
  "como", "pero", "muy", "más", "también", "ya", "ayer", "mañana", "lunes", "martes", "miércoles",
  "jueves", "viernes", "sábado", "domingo", "dame", "dime", "muéstrame", "muestrame", "busca", "buscar", "crea",
  "agenda", "agéndame", "recuérdame", "recuerdame", "recordatorio", "recordatorios", "cliente", "clientes",
  "póliza", "polizas", "pólizas", "poliza", "teléfono", "telefono", "llamar", "llamada", "cita",
  "pendientes", "todos", "todas", "este", "esta", "estos", "estas", "ese", "esa", "lo", "le", "les", "nos",
  "te", "quiero", "necesito", "puedes", "puedo", "cuando", "donde", "cual", "quien", "cuanto",
  "número", "vence", "vencen", "semana", "mes", "año", "días", "dias", "sobre", "entre", "desde", "hasta",
  "otra", "otro", "aquí", "ahí", "sí", "si", "segundo", "primero", "tercero", "gracias", "hola", "buenos",
  "buenas",
]);

const EN_WORDS = new Set([
  "the", "an", "of", "and", "or", "in", "on", "at", "to", "for", "with", "without", "from", "by", "is", "are",
  "was", "were", "be", "been", "has", "have", "had", "do", "does", "did", "what", "which", "when", "where", "who",
  "whom", "how", "why", "my", "your", "his", "her", "their", "our", "its", "this", "that", "these", "those", "it",
  "i", "you", "she", "we", "they", "him", "them", "us", "can", "could", "will", "would", "should",
  "please", "show", "give", "tell", "find", "search", "look", "create", "schedule", "remind", "set", "add",
  "update", "change", "call", "phone", "number", "client", "clients", "policy", "policies", "reminder",
  "reminders", "note", "notes", "pending", "all", "any", "some", "about", "today", "tomorrow", "yesterday",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "next", "last", "week", "month",
  "year", "days", "day", "not", "there", "here", "also", "just", "than", "then", "if", "so", "but", "need",
  "want", "hello", "hi", "hey", "thanks", "thank", "second", "first", "third", "expires", "expire", "much",
  "many", "up", "out", "into", "over", "under", "between", "since", "until", "other", "another",
]);

/** Votos mínimos (palabras + acentos) para fiarse de la detección. Un "sí" o "gracias" suelto no basta. */
const MIN_VOTES = 2;
/** Ventaja mínima del ganador sobre el otro idioma. */
const MIN_MARGIN = 1;

// Cada aparición es evidencia fuerte de español; el inglés no usa estos signos.
const ES_ACCENT = /[áéíóúñü]/;
const ES_PUNCT = /[¿¡]/g;

/**
 * Idioma del mensaje o, si es ambiguo, el `fallback` tal cual (con
 * `source: "fallback"`). Sin red ni estado.
 */
export function detectReplyLanguage(message: string, fallback: ReplyLanguage): DetectedLanguage {
  let es = 0;
  let en = 0;
  for (const w of message.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const inEs = ES_WORDS.has(w);
    const inEn = EN_WORDS.has(w);
    if (inEs && !inEn) es++;
    else if (inEn && !inEs) en++;
    else if (!inEn && ES_ACCENT.test(w)) es++; // palabra desconocida pero acentuada: no hay inglés con ñ/á/é...
  }
  es += (message.match(ES_PUNCT) ?? []).length;

  if (Math.max(es, en) < MIN_VOTES || Math.abs(es - en) < MIN_MARGIN) {
    return { language: fallback, source: "fallback" };
  }
  return { language: es > en ? "Spanish" : "English", source: "detected" };
}
