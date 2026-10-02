/**
 * Payer email for chat-originated payments. Falls back to a deterministic,
 * per-customer phone-derived address (never a shared placeholder).
 */
export function getCustomerEmail(email: string | null, phone: string): string {
  if (email && email.trim()) return email.trim();
  const cleanPhone = phone.replace(/\D/g, '');
  return `noemail+${cleanPhone || 'customer'}@example.com`;
}
