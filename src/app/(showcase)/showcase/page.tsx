import Link from 'next/link';
export const metadata = { title: 'Capability Showcase' };
export default function ShowcaseIndex() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-semibold">TechClave Capability Showcase</h1>
      <p className="mt-4 text-neutral-600">Industry capability demonstrators built to show design, development, and conversion-system capabilities.</p>
      <Link href="/showcase/work" className="mt-8 inline-block underline">See all demonstrators →</Link>
    </main>
  );
}
