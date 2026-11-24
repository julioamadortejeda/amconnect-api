// Lo que el MODELO (y la tarjeta del chat) ven de un contacto. Solo forma: las
// reglas de negocio viven en ContactWorkflowService.
import type { ContactResponseDTO } from "../../../modules/contact/contact.dto.ts";
import { formatPhoneOrNull } from "../../../shared/phone_format.ts";

export const slimContact = (c: ContactResponseDTO) => ({
  id: c.id,
  fullName: c.fullName,
  phone: c.phone,
  email: c.email,
  birthdate: c.birthdate,
  occupation: c.occupation,
  address: c.address,
  rfc: c.rfc,
  curp: c.curp,
});

/**
 * Lo que lee el MODELO: igual que `slimContact` pero con el teléfono ya legible
 * en el MISMO campo (el modelo copia datos, no sigue instrucciones de estilo, y
 * así no puede elegir el crudo). La tarjeta usa `slimContact` (la app formatea).
 */
const modelContact = (c: ContactResponseDTO) => ({ ...slimContact(c), phone: formatPhoneOrNull(c.phone) });

/**
 * Lista de contactos + la tarjeta `contact_list`. Sin resultados no hay
 * tarjeta: cero contactos pintaba un "Matching Contacts" con encabezado y nada
 * debajo. Que no haya coincidencias ya lo dice el modelo con palabras.
 *
 * NO agregar aquí una instrucción para el modelo. Se intentó el 2026-08-13
 * (para que no llamara get_contact sobre gente que esta respuesta ya trae
 * completa) y no cambió nada, pero sí se quedaba en el historial de la sesión:
 * en voz Live el contexto se recobra en cada turno, así que el texto muerto se
 * paga una y otra vez.
 */
export function contactListResult(contacts: ContactResponseDTO[] | null) {
  const slim = (contacts ?? []).map(slimContact);
  return {
    contacts: (contacts ?? []).map(modelContact),
    ...(slim.length > 0
      ? {
        __skillMetadata: {
          type: "contact_list",
          contacts: slim,
        },
      }
      : {}),
  };
}

/** El contacto completo + su tarjeta (`contact_info` o `contact_created`). */
export function contactCardResult(contact: ContactResponseDTO, type: "contact_info" | "contact_created") {
  return {
    ...contact,
    phone: formatPhoneOrNull(contact.phone), // modelo: legible; la metadata de abajo conserva el crudo
    __skillMetadata: {
      type,
      contactId: contact.id,
      fullName: contact.fullName,
      email: contact.email,
      phone: contact.phone,
      isProspect: contact.isProspect,
    },
  };
}

/** Error para el modelo cuando el nombre no identifica a un solo cliente. */
export function clientNotResolved(
  clientName: string,
  resolution: { outcome: "none" } | { outcome: "ambiguous"; matches: { id: string; fullName: string }[] },
) {
  if (resolution.outcome === "none") {
    return { error: `No client found matching '${clientName}'.` };
  }
  return {
    error: `Multiple clients found matching '${clientName}'. Please be more specific.`,
    matches: resolution.matches.map((c) => ({ id: c.id, fullName: c.fullName })),
  };
}
