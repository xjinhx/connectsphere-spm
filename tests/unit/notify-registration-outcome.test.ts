import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-201 Notify attendees about registration outcomes (Jira, authoritative).
 * The messages are pure (policy.ts); which outcome sends which notification is
 * decided in event-registration/service.ts. The registration data layer and
 * the notifications insert are replaced with spies, so the real
 * notifyBestEffort and createNotification run (including the type check) and
 * nothing here needs a database. That the rows land in Postgres runs in
 * tests/integration/notify-registration-outcome.test.ts.
 *
 * Test case IDs are from SCRUM-201-test-cases.xlsx (TC-201-nn). The clock is
 * fixed at 01/11/2026 10:00 Singapore time unless a test says otherwise.
 */

vi.mock('@/lib/supabase/eventRegistrations', () => ({
  countRegisteredRegistrations: vi.fn(),
  fetchRegistrationEvent: vi.fn(),
  fetchRegisteredRegistration: vi.fn(),
  createRegistrationRow: vi.fn(),
}));
vi.mock('@/lib/supabase/notifications', () => ({ insertNotification: vi.fn() }));

import {
  countRegisteredRegistrations,
  createRegistrationRow,
  fetchRegisteredRegistration,
  fetchRegistrationEvent,
} from '@/lib/supabase/eventRegistrations';
import { insertNotification } from '@/lib/supabase/notifications';
import { getRegistrationPage, notifyRegistrationWithdrawn, registerForEvent } from '@/domain/event-registration/service';
import {
  NO_PLACES_REMAINING,
  eventFullMessage,
  registrationConfirmedMessage,
  registrationWithdrawnMessage,
} from '@/domain/event-registration/policy';
import { notificationHref } from '@/domain/notification/policy';
import { CapacityExceededError, ConflictError, ValidationError } from '@/domain/shared/errors';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ATTENDEE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VALID = { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' };
const NOW = new Date('2026-11-01T10:00:00+08:00');

const ROW = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reference: 'REG-2026-0001',
  event_request_id: EVENT_ID,
  full_name: VALID.fullName,
  email: VALID.email,
  contact_number: VALID.contactNumber,
  status: 'registered',
  registered_at: '2026-11-01T02:00:00+00:00',
};

const CONFIRMED =
  'You are registered for "Client Appreciation Night" on 17/11/2026, 19:00–22:00 at Marina Bay Ballroom. Your reference is REG-2026-0001.';
const WITHDRAWN = 'You have withdrawn from "Client Appreciation Night" on 17/11/2026. Your registration REG-2026-0001 is now Withdrawn.';
const FULL = 'Your registration for "Client Appreciation Night" on 17/11/2026 was not accepted: the event is full.';

type EventOptions = { capacity?: number | null; status?: string; start?: string; end?: string };

/** Client Appreciation Night, 17/11/2026 19:00–22:00 at Marina Bay Ballroom, registration open 29/10/2026 to 06/11/2026. */
function event({ capacity = 20, status = 'confirmed', start = '2026-10-29', end = '2026-11-06' }: EventOptions = {}) {
  vi.mocked(fetchRegistrationEvent).mockResolvedValue({
    data: {
      id: EVENT_ID,
      name: 'Client Appreciation Night',
      status,
      description: null,
      proposed_date: '2026-11-17',
      start_time: '19:00:00',
      end_time: '22:00:00',
      registration_start_date: start,
      registration_end_date: end,
      registration_capacity: capacity,
      venue_booking: [
        { status: 'confirmed', venue_id: 'v-ballroom', venues: { name: 'Marina Bay Ballroom', address: '10 Bayfront Avenue' } },
      ],
    },
    error: null,
  } as never);
}

function placesTaken(count: number) {
  vi.mocked(countRegisteredRegistrations).mockResolvedValue({ count, error: null } as never);
}

/** The attendee's Registered row: none before the insert, then `after` once it has run. */
function registrations(before: typeof ROW | null, after: typeof ROW | null = before) {
  vi.mocked(fetchRegisteredRegistration)
    .mockReset()
    .mockResolvedValueOnce({ data: before, error: null } as never)
    .mockResolvedValue({ data: after, error: null } as never);
}

function databaseSays(outcome: string) {
  vi.mocked(createRegistrationRow).mockResolvedValue({ data: outcome, error: null } as never);
}

/** The types of every notification inserted, in order. */
const sentTypes = () => vi.mocked(insertNotification).mock.calls.map(([notification]) => notification.type);

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  vi.clearAllMocks();
  event();
  placesTaken(5);
  registrations(null, ROW);
  databaseSays('registered');
  vi.mocked(insertNotification).mockResolvedValue({ error: null } as never);
});

describe('AC1: a registration that is created sends a confirmation with the event details', () => {
  it('TC-201-01 the message names the event, its date (DD/MM/YYYY), times and venue, and the reference', () => {
    const message = registrationConfirmedMessage(
      {
        eventRequestId: EVENT_ID,
        eventName: 'Client Appreciation Night',
        eventDate: '2026-11-17',
        times: { start: '19:00', end: '22:00' },
        venues: [{ name: 'Marina Bay Ballroom', address: '10 Bayfront Avenue' }],
      },
      'REG-2026-0001',
    );

    expect(message).toBe(CONFIRMED);
  });

  it('TC-201-01 an event with no date, times or venue yet is confirmed with what it has; several venues are all named', () => {
    const base = { eventRequestId: EVENT_ID, eventName: 'Client Appreciation Night', eventDate: null, times: null, venues: [] };

    expect(registrationConfirmedMessage(base, 'REG-2026-0001')).toBe(
      'You are registered for "Client Appreciation Night". Your reference is REG-2026-0001.',
    );
    expect(
      registrationConfirmedMessage(
        {
          ...base,
          eventDate: '2026-11-17',
          venues: [
            { name: 'Bugis Seminar Room', address: null },
            { name: 'Marina Bay Ballroom', address: null },
            { name: 'Jurong East Training Room', address: null },
          ],
        },
        'REG-2026-0001',
      ),
    ).toBe(
      'You are registered for "Client Appreciation Night" on 17/11/2026 at Bugis Seminar Room, Marina Bay Ballroom and Jurong East Training Room. Your reference is REG-2026-0001.',
    );
  });

  it("TC-201-01 the confirmation opens the attendee's own page for the event", () => {
    expect(notificationHref({ type: 'registration_confirmed', eventRequestId: EVENT_ID })).toBe(`/register-events/${EVENT_ID}`);
  });

  it('TC-201-01 registering sends the attendee exactly one confirmation, for this event, with the message', async () => {
    const registration = await registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW);

    expect(registration.status).toBe('registered');
    expect(insertNotification).toHaveBeenCalledTimes(1);
    expect(insertNotification).toHaveBeenCalledWith({
      recipientId: ATTENDEE,
      type: 'registration_confirmed',
      eventRequestId: EVENT_ID,
      message: CONFIRMED,
    });
  });

  it('TC-201-01 a confirmation that cannot be saved does not undo the registration', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(insertNotification).mockResolvedValue({ error: { message: 'insert failed' } } as never);

    const registration = await registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW);

    expect(registration).toMatchObject({ reference: 'REG-2026-0001', status: 'registered' });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('TC-201-02 a refused registration sends no confirmation: already registered, period ended, event Cancelled, a blank field', async () => {
    registrations(ROW);
    expect(await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW))).toBeInstanceOf(ConflictError);

    registrations(null, ROW);
    event({ start: '2026-10-22', end: '2026-10-31' });
    expect(await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW))).toMatchObject({
      message: 'Registration closed on 31/10/2026.',
    });

    registrations(null, ROW);
    event({ status: 'cancelled' });
    expect(await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW))).toMatchObject({
      message: 'This event has been cancelled, so it is not taking registrations.',
    });

    registrations(null, ROW);
    event();
    expect(await refusal(registerForEvent(EVENT_ID, ATTENDEE, { ...VALID, contactNumber: ' ' }, NOW))).toBeInstanceOf(
      ValidationError,
    );

    expect(sentTypes()).not.toContain('registration_confirmed');
  });

  it('TC-201-02 a refusal the database finds with the event row locked sends no confirmation either', async () => {
    databaseSays('already_registered');
    registrations(null, ROW);

    expect(await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW))).toBeInstanceOf(ConflictError);
    expect(sentTypes()).not.toContain('registration_confirmed');
  });

  it('TC-201-03 taking the last place (19 of 20) is confirmed, and not told the event is full', async () => {
    placesTaken(19);

    const registration = await registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW);

    expect(registration.status).toBe('registered');
    expect(sentTypes()).toEqual(['registration_confirmed']);
  });
});

describe('AC3: a registration refused because the event is full tells the attendee so', () => {
  it('TC-201-04 the message names the event and its date (DD/MM/YYYY) and says it is full; only the name before it has a date', () => {
    expect(eventFullMessage('Client Appreciation Night', '2026-11-17')).toBe(FULL);
    expect(eventFullMessage('Client Appreciation Night', null)).toBe(
      'Your registration for "Client Appreciation Night" was not accepted: the event is full.',
    );
  });

  it("TC-201-04 the notification opens the attendee's own page for the event", () => {
    expect(notificationHref({ type: 'registration_refused_full', eventRequestId: EVENT_ID })).toBe(`/register-events/${EVENT_ID}`);
  });

  it('TC-201-04 at capacity (20 of 20): refused as full, nothing written, and the attendee is told the event is full', async () => {
    placesTaken(20);

    const error = await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW));

    expect(error).toBeInstanceOf(CapacityExceededError);
    expect(error).toMatchObject({ message: NO_PLACES_REMAINING });
    expect(createRegistrationRow).not.toHaveBeenCalled();
    expect(insertNotification).toHaveBeenCalledTimes(1);
    expect(insertNotification).toHaveBeenCalledWith({
      recipientId: ATTENDEE,
      type: 'registration_refused_full',
      eventRequestId: EVENT_ID,
      message: FULL,
    });
  });

  it('TC-201-04 no capacity set counts as full (CL-63): refused and told the same', async () => {
    event({ capacity: null });
    placesTaken(0);

    expect(await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW))).toBeInstanceOf(CapacityExceededError);
    expect(sentTypes()).toEqual(['registration_refused_full']);
  });

  it('TC-201-04 a notification that cannot be saved does not change the refusal', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    placesTaken(20);
    vi.mocked(insertNotification).mockRejectedValue(new Error('network down'));

    const error = await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW));

    expect(error).toBeInstanceOf(CapacityExceededError);
    expect(error).toMatchObject({ message: NO_PLACES_REMAINING });
    logged.mockRestore();
  });

  it('TC-201-05 a refusal for another reason is not told the event is full: not open yet, closed, Cancelled, Completed, already registered', async () => {
    const refusals: [EventOptions, string][] = [
      [{ start: '2026-11-04', end: '2026-11-10' }, 'Registration opens on 04/11/2026.'],
      [{ start: '2026-10-22', end: '2026-10-31' }, 'Registration closed on 31/10/2026.'],
      [{ status: 'cancelled' }, 'This event has been cancelled, so it is not taking registrations.'],
      [{ status: 'completed' }, 'This event has already taken place, so it is not taking registrations.'],
    ];
    // Full as well, so only the order of the checks keeps these from being told it is full.
    placesTaken(20);
    for (const [options, message] of refusals) {
      event(options);
      registrations(null, ROW);
      expect(await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW))).toMatchObject({ message });
    }
    event();
    registrations(ROW);
    expect(await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW))).toBeInstanceOf(ConflictError);

    expect(insertNotification).not.toHaveBeenCalled();
  });

  it('TC-201-05 opening a full event\'s page is not a refusal and sends nothing', async () => {
    placesTaken(20);
    registrations(null);

    const view = await getRegistrationPage(EVENT_ID, ATTENDEE, NOW);

    expect(view.full).toBe(true);
    expect(insertNotification).not.toHaveBeenCalled();
  });

  it('TC-201-06 the last place taken after the read (the database says full): told the event is full, not confirmed', async () => {
    placesTaken(19);
    databaseSays('full');

    const error = await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW));

    expect(error).toBeInstanceOf(CapacityExceededError);
    expect(createRegistrationRow).toHaveBeenCalledTimes(1);
    expect(sentTypes()).toEqual(['registration_refused_full']);
  });
});

/**
 * AC4 against DUMMY(SCRUM-184) D-28: withdrawRegistration (PR #167) is not on
 * main, so these call notifyRegistrationWithdrawn as it will once the
 * withdrawal has gone through. TC-201-08 and TC-201-09 (nothing is sent when
 * the withdrawal does not happen) need withdrawRegistration's own refusals and
 * are not tested here; see docs/dummies.md, D-28.
 */
describe('AC4: a confirmed withdrawal sends the attendee a notification confirming it', () => {
  const EVENT = { id: EVENT_ID, name: 'Client Appreciation Night', proposed_date: '2026-11-17' };

  it('TC-201-07 the message names the event and its date (DD/MM/YYYY) and the registration now Withdrawn', () => {
    expect(registrationWithdrawnMessage('Client Appreciation Night', '2026-11-17', 'REG-2026-0001')).toBe(WITHDRAWN);
    expect(registrationWithdrawnMessage('Client Appreciation Night', null, 'REG-2026-0001')).toBe(
      'You have withdrawn from "Client Appreciation Night". Your registration REG-2026-0001 is now Withdrawn.',
    );
  });

  it("TC-201-07 the notification opens the attendee's own page for the event", () => {
    expect(notificationHref({ type: 'registration_withdrawn', eventRequestId: EVENT_ID })).toBe(`/register-events/${EVENT_ID}`);
  });

  it('TC-201-07 sends the attendee exactly one notification, for this event, with the message', async () => {
    await notifyRegistrationWithdrawn(ATTENDEE, EVENT, { reference: 'REG-2026-0001' });

    expect(insertNotification).toHaveBeenCalledTimes(1);
    expect(insertNotification).toHaveBeenCalledWith({
      recipientId: ATTENDEE,
      type: 'registration_withdrawn',
      eventRequestId: EVENT_ID,
      message: WITHDRAWN,
    });
  });

  it('TC-201-07 a notification that cannot be saved is not an error, so it cannot undo the withdrawal', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(insertNotification).mockResolvedValue({ error: { message: 'insert failed' } } as never);

    await expect(notifyRegistrationWithdrawn(ATTENDEE, EVENT, { reference: 'REG-2026-0001' })).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
