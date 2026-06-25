export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

export default function SignUpPage() {
  redirect('/booka/auth/onboarding');
}
