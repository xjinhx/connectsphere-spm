import { describe, it, expect } from 'vitest';
import { canAccessNotification } from '@/domain/notification/policy';

/** SCRUM-193's implicit access rule: a notification is only its recipient's. */
describe('canAccessNotification', () => {
  it('allows the recipient', () => {
    expect(canAccessNotification('user-1', 'user-1')).toBe(true);
  });

  it('refuses anyone else', () => {
    expect(canAccessNotification('user-1', 'user-2')).toBe(false);
  });
});
