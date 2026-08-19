import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | Date): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatTime(timeStr: string | Date): string {
  if (!timeStr) return '';
  if (timeStr instanceof Date) {
    return timeStr.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function parseIso(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}