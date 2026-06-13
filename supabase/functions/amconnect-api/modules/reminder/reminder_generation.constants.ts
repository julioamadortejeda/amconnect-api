export const REMINDER_TITLES: Record<string, (policyLabel: string) => string> = {
  PAYMENT: (label) => `Pago de Prima · ${label}`,
  RENEWAL: (label) => `Renovación · ${label}`,
  ANNIVERSARY: (label) => `Aniversario · ${label}`,
};
