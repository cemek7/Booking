import React from 'react';

export default function LegalSection({
  heading,
  id,
  children,
}: {
  heading: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-8 first:mt-0">
      <h2 className="text-lg font-semibold text-[#10211a]">{heading}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-[#3a4a43] [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
        {children}
      </div>
    </section>
  );
}
