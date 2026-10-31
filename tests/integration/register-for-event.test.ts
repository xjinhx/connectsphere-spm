import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRegistrationPage, registerForEvent } from '@/domain/event-registration/service';
import { ALREADY_REGISTERED } from '@/domain/event-registration/policy';
import { ConflictError, ValidationError } from '@/domain/shared/errors';
import { TEST_CLIENT_ORGANISATION_ID, ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-181 Register for an event (Jira, authoritative):
 *   AC1 with the period open and places remaining, a registration is created
 *       with status Registered and a confirmation is generated;
 *   AC2 before the start date, refused with the start date shown;
 *   AC3 after the end date, refused with the end date shown;
 *   AC4 both dates inclusive;
 *   AC5 a second registration is refused and the existing one shown;
 *   AC6 no limit on how many events one attendee joins.
 *
 * Runs against the local Supabase stack. The clock is fixed at 30/10/2026
 * 10:00 Singapore time by passing `now`. Test case IDs are from the
 * ConnectSphere_TestCases_Sprint4 workbook, SCRUM-181 tab (TC-181-nn). Only
 * attendees reaching the route is tests/unit/event-registration-route.test.ts.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date('2026-10-30T10:00:00+08:00');
const VALID = { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' };

let organiserId: string;
const attendeeIds: string[] = [];
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+registration${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

async function createAttendee(): Promise<string> {
  const id = await createUser(`attendee${attendeeIds.length}`);
  attendeeIds.push(id);
  return id;
}

/**
 * An event whose registration period runs from `start` to `end` (YYYY-MM-DD).
 * Capacity 20 unless a test sets its own: since SCRUM-182 an event with no
 * capacity is refused as full (TC-182-02), and these tests are about the rest.
 */
async function createEvent(
  start: string | null,
  end: string | null,
  extra: { registration_capacity?: number; proposed_date?: string; start_time?: string; end_time?: string } = {},
): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Client Appreciation Night ${RUN}`,
      proposed_date: '2026-11-15',
      registration_start_date: start,
      registration_end_date: end,
      registration_capacity: 20,
      ...extra,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  return data.id;
}

async function rowsFor(eventId: string) {
  const { data, error } = await admin
    .from('event_registration')
    .select('attendee_id, full_name, email, contact_number, status, reference, registered_at')
    .eq('event_request_id', eventId);
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Registrations go with their events (cascade), then the accounts can go.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of [organiserId, ...attendeeIds]) if (id) await admin.auth.admin.deleteUser(id);
});

describe('AC1: registering with the period open and places remaining', () => {
  it('TC-181-01 stores one Registered registration with the three details, and returns it as the confirmation', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');
    const attendee = await createAttendee();

    const confirmation = await registerForEvent(eventId, attendee, VALID, NOW);

    const rows = await rowsFor(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attendee_id: attendee,
      full_name: 'Tan Mei Ling',
      email: 'attendee@example.com',
      contact_number: '+65 9123 4567',
      status: 'registered',
    });
    expect(rows[0]!.reference).toMatch(/^REG-\d{4}-\d{4,}$/);
    expect(confirmation).toMatchObject({ reference: rows[0]!.reference, status: 'registered' });
  });

  it('TC-181-02 the last remaining place can be taken', async () => {
    // Capacity 3 with 2 registered stands in for the sheet's 20 with 19: the
    // same boundary, fewer accounts to create.
    const eventId = await createEvent('2026-10-27', '2026-11-04', { registration_capacity: 3 });
    for (let i = 0; i < 2; i += 1) await registerForEvent(eventId, await createAttendee(), VALID, NOW);

    await expect(registerForEvent(eventId, await createAttendee(), VALID, NOW)).resolves.toMatchObject({
      status: 'registered',
    });
    expect(await rowsFor(eventId)).toHaveLength(3);
  });

  it('TC-181-03 a form with every field blank is refused, naming each, and nothing is written', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');

    const error = await registerForEvent(eventId, await createAttendee(), { fullName: ' ', email: '', contactNumber: '' }, NOW).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError & { details: { fieldErrors: object } }).details.fieldErrors)).toEqual([
      'fullName',
      'email',
      'contactNumber',
    ]);
    expect(await rowsFor(eventId)).toHaveLength(0);
  });

  it('the details are stored trimmed', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');
    await registerForEvent(eventId, await createAttendee(), { ...VALID, fullName: '  Tan Mei Ling  ' }, NOW);
    expect((await rowsFor(eventId))[0]!.full_name).toBe('Tan Mei Ling');
  });
});

describe('AC2 and AC3: outside the registration period', () => {
  it('TC-181-05, TC-181-06 before the start date: refused with 01/11/2026, and nothing is written', async () => {
    const eventId = await createEvent('2026-11-01', '2026-11-09');

    await expect(registerForEvent(eventId, await createAttendee(), VALID, NOW)).rejects.toThrow(
      'Registration opens on 01/11/2026.',
    );
    expect(await rowsFor(eventId)).toHaveLength(0);
  });

  it('TC-181-08, TC-181-09 after the end date: refused with 28/10/2026, and nothing is written', async () => {
    const eventId = await createEvent('2026-10-20', '2026-10-28');

    await expect(registerForEvent(eventId, await createAttendee(), VALID, NOW)).rejects.toThrow(
      'Registration closed on 28/10/2026.',
    );
    expect(await rowsFor(eventId)).toHaveLength(0);
  });

  it('the database function refuses outside the period on its own, whatever the caller checked', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');
    const attendee = await createAttendee();
    const call = (today: string) =>
      admin.rpc('register_for_event', {
        p_event_request_id: eventId,
        p_attendee_id: attendee,
        p_full_name: VALID.fullName,
        p_email: VALID.email,
        p_contact_number: VALID.contactNumber,
        p_today: today,
      });

    expect((await call('2026-10-26')).data).toBe('not_started');
    expect((await call('2026-11-05')).data).toBe('ended');
    expect(await rowsFor(eventId)).toHaveLength(0);
  });
});

describe('AC4: both dates are inclusive', () => {
  it('TC-181-11 registering on the start date succeeds', async () => {
    const eventId = await createEvent('2026-10-30', '2026-11-04');
    await registerForEvent(eventId, await createAttendee(), VALID, NOW);
    expect(await rowsFor(eventId)).toHaveLength(1);
  });

  it('TC-181-12 registering on the end date succeeds', async () => {
    const eventId = await createEvent('2026-10-25', '2026-10-30');
    await registerForEvent(eventId, await createAttendee(), VALID, NOW);
    expect(await rowsFor(eventId)).toHaveLength(1);
  });

  it('TC-181-13 a single-day period: 00:15 and 23:45 SGT that day succeed, 00:15 SGT the next day is refused', async () => {
    const eventId = await createEvent('2026-10-30', '2026-10-30');

    await registerForEvent(eventId, await createAttendee(), VALID, new Date('2026-10-30T00:15:00+08:00'));
    await registerForEvent(eventId, await createAttendee(), VALID, new Date('2026-10-30T23:45:00+08:00'));
    await expect(
      registerForEvent(eventId, await createAttendee(), VALID, new Date('2026-10-31T00:15:00+08:00')),
    ).rejects.toThrow('Registration closed on 30/10/2026.');

    expect(await rowsFor(eventId)).toHaveLength(2);
  });
});

describe('AC5: registering again for the same event', () => {
  it('TC-181-14 the second registration is refused with the existing one, even with a different contact number', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');
    const attendee = await createAttendee();
    const first = await registerForEvent(eventId, attendee, VALID, NOW);

    const error = await registerForEvent(eventId, attendee, { ...VALID, contactNumber: '+65 8000 1111' }, NOW).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toBe(ALREADY_REGISTERED);
    expect((error as ConflictError).details).toMatchObject({ registration: { reference: first.reference } });
    expect(await rowsFor(eventId)).toHaveLength(1);
    // The page shows it too.
    expect((await getRegistrationPage(eventId, attendee, NOW)).registration?.reference).toBe(first.reference);
  });

  it('TC-181-15 two registrations sent at the same moment create only one', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');
    const attendee = await createAttendee();

    const results = await Promise.allSettled([
      registerForEvent(eventId, attendee, VALID, NOW),
      registerForEvent(eventId, attendee, VALID, NOW),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(ConflictError);
    expect(await rowsFor(eventId)).toHaveLength(1);
  });

  it('TC-181-16 another attendee can still register for the same event', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');
    await registerForEvent(eventId, await createAttendee(), VALID, NOW);

    await registerForEvent(
      eventId,
      await createAttendee(),
      { fullName: 'Lim Wei Jie', email: 'attendee2@example.com', contactNumber: '+65 9876 5432' },
      NOW,
    );

    expect(await rowsFor(eventId)).toHaveLength(2);
  });

  it('only a Registered row blocks: someone whose registration was withdrawn can register again (PO, 23/10/2026)', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');
    const attendee = await createAttendee();
    await registerForEvent(eventId, attendee, VALID, NOW);
    // Withdrawing is SCRUM-184's; set it by hand here.
    await admin.from('event_registration').update({ status: 'withdrawn' }).eq('event_request_id', eventId);

    await registerForEvent(eventId, attendee, VALID, NOW);

    expect((await rowsFor(eventId)).map((row) => row.status).sort()).toEqual(['registered', 'withdrawn']);
  });

  it('the database refuses a second Registered row for the same attendee and event outright', async () => {
    const eventId = await createEvent('2026-10-27', '2026-11-04');
    const attendee = await createAttendee();
    const row = { event_request_id: eventId, attendee_id: attendee, full_name: 'A', email: 'a@example.com', contact_number: '1' };
    await admin.from('event_registration').insert(row);

    const { error } = await admin.from('event_registration').insert(row);

    expect(error?.code).toBe('23505');
  });
});

describe('AC6: no limit on how many events', () => {
  it('TC-181-17 registering for a third event succeeds, and the other two are unchanged', async () => {
    const attendee = await createAttendee();
    const others = [await createEvent('2026-10-27', '2026-11-04'), await createEvent('2026-10-27', '2026-11-04')];
    for (const other of others) await registerForEvent(other, attendee, VALID, NOW);
    const eventId = await createEvent('2026-10-27', '2026-11-04');

    await registerForEvent(eventId, attendee, VALID, NOW);

    const { data } = await admin.from('event_registration').select('event_request_id, status').eq('attendee_id', attendee);
    expect(data).toHaveLength(3);
    expect(data!.every((row) => row.status === 'registered')).toBe(true);
  });

  it('TC-181-18 registering for an event at the same time as an existing registration succeeds', async () => {
    const attendee = await createAttendee();
    const launch = await createEvent('2026-10-27', '2026-11-04', { start_time: '10:00', end_time: '12:00' });
    const night = await createEvent('2026-10-27', '2026-11-04', { start_time: '11:00', end_time: '13:00' });
    await registerForEvent(launch, attendee, VALID, NOW);

    await expect(registerForEvent(night, attendee, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });
  });
});

describe('the registration period on the event', () => {
  it('refuses a period that ends before it starts, or has only one end', async () => {
    const backwards = await admin.from('event_request').insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Backwards ${RUN}`,
      registration_start_date: '2026-11-04',
      registration_end_date: '2026-10-27',
    });
    const halfOpen = await admin.from('event_request').insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Half open ${RUN}`,
      registration_start_date: '2026-11-04',
    });

    expect(backwards.error?.code).toBe('23514');
    expect(halfOpen.error?.code).toBe('23514');
  });
});
