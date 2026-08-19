import React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({ checked, defaultChecked, onCheckedChange, disabled, id, className }: SwitchProps) {
  const [internal, setInternal] = React.useState(defaultChecked ?? false);
  const isChecked = checked !== undefined ? checked : internal;

  const handleChange = () => {
    if (disabled) return;
    const next = !isChecked;
    if (checked === undefined) setInternal(next);
    onCheckedChange?.(next);
  };

  return (
    <button
      id={id}
      role="switch"
      type="button"
      aria-checked={isChecked}
      disabled={disabled}
      onClick={handleChange}
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        isChecked ? 'bg-indigo-600' : 'bg-gray-200',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform',
          isChecked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}

export default Switch;
