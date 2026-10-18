import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-197 AC1 — "Given an Event Organiser submits an event request, when
 * the submission completes, then a notification is generated for every
 * Event Coordinator Lead, because assignment is their responsibility."
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * Runs against the local Supabase stack. A real database is the point:
 * submitEventRequest() reads the mandatory-field rules from policy.ts and
 * writes through markEventRequestSubmitted(), then notifyLeadsOfSubmission()
 * reads every account holding the operations_manager role - none of that can
 * be proven without Postgres.
 *
 * getCurrentActor is mocked because submitEventRequest reads the signed-in
 * session and there is no browser here, the same pattern as
 * respond-to-clarification.test.ts. The mock is the session, not the code
 * under test.
 */

const actor = vi.hoisted(() => ({ current: null as { userId: string; roles: string[] } | null }));

vi.mock('@/lib/auth/currentActor', () => ({
  getCurrentActor: async () => {
    if (!actor.current) throw new Error('no actor set for this test');
    return {
      userId: actor.current.userId,
      fullName: 'Test Actor',
      roles: actor.current.roles,
      clientOrganisation: null,
    };
  },
}));

const { submitEventRequest } = await import('@/domain/event-request/service');

const supabase = createAdminClient();
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let organiserId: string;
let leadId: string;
let otherLeadId: string;
let coordinatorId: string;
const createdRequestIds: string[] = [];
const createdUserIds: string[] = [];

async function createAccount(label: string, roles: string[]): Promise<string> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { data, error } = await supabase.auth.admin.createUser({
    email: `${slug}+${Date.now()}${Math.random().toString(36).slice(2, 8)}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) {
    throw new Error(`could not create test ${label}: ${error?.message ?? 'no user returned'}`);
  }
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ roles, full_name: label })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set roles for ${label}: ${profileError.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

/** Complete enough to satisfy SCRUM-82's mandatory fields, so it can be submitted. */
async function createCompleteRequest(): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
      purpose: 'Bring the engineering teams together for the yearly update.',
      description: 'A full day of talks, workshops and a closing reception.',
      proposed_date: '2027-03-15',
      start_time: '09:00',
      end_time: '17:00',
      expected_attendance: 80,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);
  const id = data.id as string;
  createdRequestIds.push(id);
  return id;
}

async function latestNotificationFor(recipientId: string, eventRequestId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, message, read_at')
    .eq('recipient_id', recipientId)
    .eq('event_request_id', eventRequestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not read notification: ${error.message}`);
  return data;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);
  organiserId = await createAccount('Submit Organiser', ['event_organiser']);
  leadId = await createAccount('Submit Lead', ['operations_manager']);
  otherLeadId = await createAccount('Other Submit Lead', ['operations_manager']);
  coordinatorId = await createAccount('Submit Coordinator', ['coordinator']);
});

afterAll(async () => {
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await supabase.auth.admin.deleteUser(id);
  }
});

describe('SCRUM-197 AC1: submitting a request notifies every Event Coordinator Lead', () => {
  it('notifies every account holding the operations_manager role', async () => {
    const id = await createCompleteRequest();
    actor.current = { userId: organiserId, roles: ['event_organiser'] };

    await submitEventRequest(id);

    const leadNotification = await latestNotificationFor(leadId, id);
    const otherLeadNotification = await latestNotificationFor(otherLeadId, id);
    expect(leadNotification?.type).toBe('request_submitted');
    expect(leadNotification?.message).toContain('submitted');
    expect(otherLeadNotification?.type).toBe('request_submitted');
  });

  it('does not notify an account that is not an Event Coordinator Lead', async () => {
    const id = await createCompleteRequest();
    actor.current = { userId: organiserId, roles: ['event_organiser'] };

    await submitEventRequest(id);

    const coordinatorNotification = await latestNotificationFor(coordinatorId, id);
    expect(coordinatorNotification).toBeNull();
  });
});
