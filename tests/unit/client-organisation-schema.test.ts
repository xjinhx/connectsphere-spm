import { describe, it, expect } from 'vitest';
import { CreateClientOrganisationInputSchema } from '@/domain/client-organisation/schema';

/**
 * SCRUM-203 AC1 — a valid organisation needs a name; contact details are
 * optional on input but must be well-formed when given.
 */

describe('CreateClientOrganisationInputSchema: SCRUM-203 AC1', () => {
  it('accepts a name with no contact details', () => {
    const result = CreateClientOrganisationInputSchema.safeParse({ name: 'Acme Events' });
    expect(result.success).toBe(true);
  });

  it('accepts a name with full contact details', () => {
    const result = CreateClientOrganisationInputSchema.safeParse({
      name: 'Acme Events',
      contactName: 'Jane Tan',
      contactEmail: 'jane@acme.example',
      contactPhone: '+65 9123 4567',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a blank name', () => {
    const result = CreateClientOrganisationInputSchema.safeParse({ name: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing name', () => {
    const result = CreateClientOrganisationInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a malformed contact email', () => {
    const result = CreateClientOrganisationInputSchema.safeParse({
      name: 'Acme Events',
      contactEmail: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });
});
