/**
 * Versión y URL vigentes del aviso de privacidad. Al publicar un aviso nuevo se
 * cambia SOLO esta constante: todos los asesores que aceptaron otra versión
 * vuelven a ver `privacy.required = true` en `GET /agents/me`.
 */
export const PRIVACY_POLICY_VERSION = "2026-11-v1";

// TODO(usuario): URL definitiva cuando se publique el aviso
export const PRIVACY_POLICY_URL = "https://amconnect.app/privacidad";
