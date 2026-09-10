import { describe, it, expect } from 'vitest';
import { AccountRolesSchema } from '@/domain/identity/roles';

describe('AccountRolesSchema', () => {
  it('accepts a valid single role', () => {
    const result = AccountRolesSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      roles: ['coordinator'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple roles', () => {
    const result = AccountRolesSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      roles: ['coordinator', 'venue_staff'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown role value', () => {
    const result = AccountRolesSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      roles: ['made_up_role'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty roles array', () => {
    const result = AccountRolesSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      roles: [],
    });
    expect(result.success).toBe(false);
  });
});