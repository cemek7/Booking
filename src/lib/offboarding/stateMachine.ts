import type { LifecycleState } from './types';

const ALLOWED: Record<LifecycleState, LifecycleState[]> = {
  active: ['scheduled_for_deletion'],
  scheduled_for_deletion: ['active', 'purging'],
  purging: ['purged'],
  purged: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid lifecycle transition: ${from} → ${to}`);
  }
}
