import Link from 'next/link';

export default function InvalidInvitationPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-950">Invitation unavailable</h1>
      <p className="mt-3 text-slate-600">
        This invitation link is invalid or no longer available.
      </p>
      <Link className="mt-6 font-medium text-emerald-700 underline" href="/booka/auth/signin">
        Go to Booka sign in
      </Link>
    </main>
  );
}
