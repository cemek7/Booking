/**
 * Payer email for chat-originated payments. Falls back to a deterministic,
 * per-customer phone-derived address (never a shared placeholder).
 */
export function getCustomerEmail(email: string | null, phone: string): string {
  if (email && email.trim()) return email.trim();
  const cleanPhone = phone.replace(/\D/g, '');
  // No email and no phone digits: return '' so the settlement boundary rejects
  // (CUSTOMER_EMAIL_REQUIRED) and the booking is handed off, never a shared placeholder.
  if (!cleanPhone) return '';
  return `noemail+${cleanPhone}@example.com`;
}
