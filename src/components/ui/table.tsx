import { ReactNode } from "react";

export function Table({ children }: { children: ReactNode }) {
  return <table className="min-w-full bg-white/5 border border-white/6 rounded">{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-gray-100">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children }: { children: ReactNode }) {
  return <tr className="border-b last:border-0">{children}</tr>;
}

export function TH({ children }: { children: ReactNode }) {
  return <th className="px-4 py-2 text-left font-semibold text-gray-200/90">{children}</th>;
}

import { TdHTMLAttributes } from "react";
export function TD({ children, ...props }: { children: ReactNode } & TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className="px-4 py-2 text-sm text-gray-100/90" {...props}>{children}</td>;
}
