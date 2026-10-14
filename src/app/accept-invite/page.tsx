import AcceptInvitation from '@/components/auth/AcceptInvitation';

export default function AcceptInvitePage() {
  return (
    <main className="min-h-screen bg-[#f6f5ef] px-4 py-12">
      <div className="mx-auto max-w-3xl rounded-3xl border border-[#d8d3c4] bg-white p-6 shadow-sm sm:p-10">
        <p className="text-sm font-semibold text-emerald-700">Booka by Techclave</p>
        <div className="mt-6">
          <AcceptInvitation />
        </div>
      </div>
    </main>
  );
}
