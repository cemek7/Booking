export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

export default function SignInPage() {
  redirect('/booka/auth/signin');
}
