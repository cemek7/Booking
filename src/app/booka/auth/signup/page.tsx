export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

export default function BookaSignUpPage() {
  redirect('/booka/auth/onboarding');
}
