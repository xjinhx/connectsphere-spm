import type { SupabaseClient } from '@supabase/supabase-js';
import { isUniqueViolation } from '@/domain/shared/errors';

/**
 * SCRUM-203 added client_organisations and the foreign key
 * event_request.client_organisation_id -> client_organisations.id. Several
 * integration tests predate that FK and insert event_request rows against a
 * fixed placeholder id ('22222222-2222-2222-2222-222222222222') that now has
 * to actually exist, or the insert is refused with a foreign key violation.
 *
 * Upserted, never deleted: several test files share this one id and can run
 * concurrently, so a delete in one file's afterAll could race another file's
 * still-running tests. The row is harmless to leave behind between runs -
 * `supabase db reset` clears it anyway.
 *
 * `onConflict: 'id'` only covers a conflict on the id column. The table also
 * has `name text not null unique`, and every caller upserts the same name, so
 * two of these running at once can both miss seeing the other's uncommitted
 * insert and both attempt an INSERT, one of which then fails the *name*
 * constraint instead of the id one - `onConflict` never sees it, since that
 * option only rewrites the conflict target it names. Treating that specific
 * failure as success is safe here because every caller upserts the exact same
 * row: a unique violation on name at this call site only ever means someone
 * else has already seeded it.
 */
export const TEST_CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

export async function ensureTestClientOrganisation(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase
    .from('client_organisations')
    .upsert({ id: TEST_CLIENT_ORGANISATION_ID, name: 'Integration Test Organisation' }, { onConflict: 'id' });
  if (error && !isUniqueViolation(error)) {
    throw new Error(`could not seed the test client organisation: ${error.message}`);
  }
}
