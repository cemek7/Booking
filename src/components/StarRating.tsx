'use client';

import { useState } from 'react';

interface StarRatingProps {
  rating: number;
  interactive?: boolean;
  onChange?: (rating: number) => void;
}

/**
 * Accessible star-rating widget.
 * - Non-interactive: read-only display (buttons are disabled, no ARIA roles).
 * - Interactive: full keyboard navigation (Enter / Space to select) and
 *   ARIA radiogroup semantics so screen readers announce the selected value.
 */
export default function StarRating({ rating, interactive = false, onChange }: StarRatingProps) {
  const [hovered, setHovered] = useState(0);
  return (
    <div
      className="flex gap-0.5"
      role={interactive ? 'radiogroup' : undefined}
      aria-label={interactive ? 'Rating' : undefined}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => interactive && setHovered(star)}
          onMouseLeave={() => interactive && setHovered(0)}
          onKeyDown={(e) => {
            if (interactive && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onChange?.(star);
            }
          }}
          aria-label={interactive ? `${star} star${star !== 1 ? 's' : ''}` : undefined}
          aria-pressed={interactive ? star === rating : undefined}
          className={`text-xl leading-none ${!interactive ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <span className={star <= (hovered || rating) ? 'text-yellow-400' : 'text-gray-200'}>★</span>
        </button>
      ))}
    </div>
  );
}
