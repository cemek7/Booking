"use client";
import React from 'react';

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  id?: string;
}

// Lightweight design container for consistent spacing & semantics
export function FormSection({ title, description, children, aside, id }: FormSectionProps) {
  const sectionId = id || `fs-${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;
  return (
    <section aria-labelledby={sectionId} className="rounded-md border bg-white/50 backdrop-blur-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 id={sectionId} className="text-sm font-semibold tracking-tight">{title}</h3>
          {description && <p className="text-xs text-gray-600 leading-relaxed">{description}</p>}
        </div>
        {aside && <div className="text-xs text-gray-500">{aside}</div>}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </section>
  );
}

export default FormSection;
