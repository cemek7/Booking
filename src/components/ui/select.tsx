'use client';

import React from 'react';
import cn from 'classnames';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  onValueChange?: (value: string) => void;
}

export function Select({ className, onValueChange, onChange, ...props }: SelectProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (onValueChange) {
      onValueChange(e.target.value);
    }
    if (onChange) {
      onChange(e);
    }
  };

  return (
    <select
      className={cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      onChange={handleChange}
      {...props}
    />
  );
}

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}

export function SelectTrigger({ className, children, ...props }: SelectTriggerProps) {
  return (
    <button
      className={cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
        'placeholder:text-muted-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export interface SelectValueProps {
  placeholder?: string;
}

export function SelectValue({ placeholder }: SelectValueProps) {
  return <span className="text-muted-foreground">{placeholder}</span>;
}

export interface SelectContentProps {
  children?: React.ReactNode;
  className?: string;
}

export function SelectContent({ children, className }: SelectContentProps) {
  return (
    <div
      className={cn(
        'relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
    >
      <div className="p-1">{children}</div>
    </div>
  );
}

export interface SelectItemProps extends React.OptionHTMLAttributes<HTMLOptionElement> {
  children?: React.ReactNode;
}

export function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <option
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </option>
  );
}
