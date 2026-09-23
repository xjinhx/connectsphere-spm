import { describe, it, expect, afterEach } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { insertClientOrganisation } from '@/lib/supabase/clientOrganisations';
import { isUniqueViolation } from '@/domain/shared/errors';

/**
 * SCRUM-203 — Create and maintain a client organisation.
 *
 * AC2 — "a name already in use is refused, not silently overwritten" — is a
 * unique constraint on client_organisations.name
 * (supabase/migrations/20260915100000_create_client_organisations.sql), so
 * unit tests against fixture data can't exercise it: only Postgres can raise
 * it. createClientOrganisation() in domain/client-organisation/service.ts
 * maps that violation onto ConflictError, but is gated behind
 * getCurrentActor(), which needs a real signed-in session; per the same
 * convention the other integration tests in this folder follow (see
 * assign-coordinator.test.ts), the session-gated path is left to manual
 * testing and this file proves the database constraint the service relies on.
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`).
 */

const supabase = createAdminClient();
const createdIds: string[] = [];

afterEach(async () => {
  for (const id of createdIds.splice(0)) {
    await supabase.from('client_organisations').delete().eq('id', id);
  }
});

describe('client_organisations unique name constraint: SCRUM-203 AC2', () => {
  it('saves the first organisation with a given name', async () => {
    const { data, error } = await insertClientOrganisation({
      name: `Acme Events ${Date.now()}`,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
    });

    expect(error).toBeNull();
    if (data) createdIds.push(data.id);
  });

  it('refuses a second organisation with the same name', async () => {
    const name = `Acme Events ${Date.now()}`;
    const first = await insertClientOrganisation({
      name,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
    });
    if (first.data) createdIds.push(first.data.id);
    expect(first.error).toBeNull();

    const second = await insertClientOrganisation({
      name,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
    });

    expect(second.data).toBeNull();
    expect(isUniqueViolation(second.error)).toBe(true);
  });
});
