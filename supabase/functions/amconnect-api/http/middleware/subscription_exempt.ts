// Rutas que deben responder aunque la suscripción esté vencida. Sin ellas, un
// asesor con el trial vencido no puede ver su cuenta ni los planes, aplicar un
// código promocional, ni desregistrar su dispositivo al cerrar sesión (el token
// push quedaría vivo y le seguirían llegando notificaciones). Lista explícita
// a propósito: cualquier ruta nueva queda protegida por defecto.
// Vive aparte (y no en el DI) para que `http/openapi/` documente el 402 con la
// misma lista, sin importar todo el contenedor.
export const SUBSCRIPTION_EXEMPT_ROUTES = new Set([
  "GET /agents/me",
  "POST /agents/me/privacy-consent",
  "DELETE /agents/device-tokens",
  "GET /subscription",
  "GET /subscription/plans",
  "POST /subscription/apply-promo",
]);
