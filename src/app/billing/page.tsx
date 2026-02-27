import { redirect } from 'next/navigation';

// Billing has moved to the dashboard section (owner-only)
export default function BillingRedirect() {
  redirect('/dashboard/billing');
}
