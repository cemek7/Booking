import { redirect } from 'next/navigation';

export default function AdminDashboardRedirect() {
  // Keep /admin as the canonical admin dashboard route. Redirects from
  // /admin/dashboard to /admin avoid 404s when code navigates to the
  // nested path.
  redirect('/admin');
}
