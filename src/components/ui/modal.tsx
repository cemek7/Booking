import { ReactNode, useEffect, useRef, useState } from 'react';
import GlassCard from '@/components/ui/GlassCard';

export default function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    // Small delay to trigger CSS transition
    const t = setTimeout(() => setVisible(true), 10);
    // autofocus first focusable element inside the modal when opening
    const focusTimer = setTimeout(() => {
      try {
        if (contentRef.current) {
          const first = contentRef.current.querySelector<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement | HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
          (first as HTMLElement | null)?.focus?.();
        }
      } catch (e) {
        // ignore
      }
    }, 120);
    return () => { clearTimeout(t); clearTimeout(focusTimer); };
  }, [open]);

  if (!open) return null;
  return (
    // Backdrop: clicking it closes the modal
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      {/* Stop propagation inside the content area so clicks do not close the modal */}
      <div onClick={(e) => e.stopPropagation()} ref={contentRef}>
        {/* Subtle entrance animation using opacity + scale */}
          <GlassCard
            className={`p-6 min-w-[300px] relative transition duration-150 ${
              visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
          <button className="absolute top-2 right-2" onClick={onClose}>&times;</button>
          {children}
          </GlassCard>
      </div>
    </div>
  );
}
