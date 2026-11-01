import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { NOTIFICATION_TYPES } from '@/domain/notification/schema';
import { TEST_CLIENT_ORGANISATION_ID, ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-201 Notify attendees about registration outcomes (Jira, authoritative):
 *   AC1 a registration that is created sends the attendee a confirmation with
 *       the event details;
 *   AC3 a registration refused because the event is full tells the attendee
 *       so (CL-73: the notification is the record of the refusal);
 *   AC4 a confirmed withdrawal sends the attendee a notification confirming it.
 * AC2 moved to SCRUM-186 (CL-34); AC5 is SCRUM-105 AC4 (CL-35). Not tested.
 *
 * Runs against the local Supabase stack: what is proved is the row that lands
 * in notifications, under the database's own type check, and the refusal
 * register_for_event finds with the event row locked. The clock is fixed at
 * 01/11/2026 10:00 Singapore time by passing `now`. Capacity 3 stands in for
 * the sheet's 20: the same boundary, fewer accounts to create.
 *
 * Test case IDs are from SCRUM-201-test-cases.xlsx (TC-201-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let organiserId: string;
const userIds: string[] = [];
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}${userIds.length}+notify${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  userIds.push(data.user.id);
  return data.user.id;
}

/** An event open for registration on 01/11/2026, held on 17/11/2026. */
async function createEvent(): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Client Appreciation Night ${RUN}`,
      proposed_date: '2026-11-17',
      registration_start_date: '2026-10-29',
      registration_end_date: '2026-11-06',
      registration_capacity: 3,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Registrations and notifications go with their events (cascade), then the accounts can go.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
}, 60_000);

describe('the migration keeps every notification type already on main', () => {
  it('TC-201-01 every type in NOTIFICATION_TYPES, the 15 before SCRUM-201 and its 3, is accepted by notifications_type_known', async () => {
    const eventId = await createEvent();
    const recipient = await createUser('attendee');

    const { error } = await admin.from('notifications').insert(
      NOTIFICATION_TYPES.map((type) => ({ recipient_id: recipient, type, event_request_id: eventId, message: type })),
    );

    expect(error).toBeNull();
    expect(NOTIFICATION_TYPES).toHaveLength(18);
  });
});
