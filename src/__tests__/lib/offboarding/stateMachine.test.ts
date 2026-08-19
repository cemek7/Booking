import { canTransition, assertTransition } from '@/lib/offboarding/stateMachine';

describe('lifecycle state machine', () => {
  it('allows the forward path', () => {
    expect(canTransition('active', 'scheduled_for_deletion')).toBe(true);
    expect(canTransition('scheduled_for_deletion', 'purging')).toBe(true);
    expect(canTransition('purging', 'purged')).toBe(true);
  });
  it('allows reactivation only from scheduled_for_deletion', () => {
    expect(canTransition('scheduled_for_deletion', 'active')).toBe(true);
    expect(canTransition('purging', 'active')).toBe(false);
    expect(canTransition('purged', 'active')).toBe(false);
  });
  it('rejects skips and unknown states', () => {
    expect(canTransition('active', 'purging')).toBe(false);
    expect(canTransition('active', 'purged')).toBe(false);
  });
  it('assertTransition throws on invalid', () => {
    expect(() => assertTransition('purged', 'active')).toThrow(/invalid lifecycle transition/i);
    expect(() => assertTransition('active', 'scheduled_for_deletion')).not.toThrow();
  });
});
