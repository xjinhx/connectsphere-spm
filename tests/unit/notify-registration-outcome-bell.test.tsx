// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/register-events/event' }));

import { NotificationBell } from '@/components/notification/NotificationBell';
import { RegisteredPanel } from '@/components/event-registration/RegisteredPanel';
import { RegistrationForm } from '@/components/event-registration/RegistrationForm';
import type { Registration } from '@/domain/event-registration/schema';

/**
 * SCRUM-201: registering, being refused as full and withdrawing each create a
 * notification without leaving the page, so the bell in the header must show
 * it straight away rather than on the next page change. The real bell and form
 * are rendered together; only fetch is replaced. A refusal that sends no
 * notification (TC-201-02) leaves the bell alone.
 *
 * Test case IDs are from the ConnectSphere_TestCases_Sprint4 workbook,
 * SCRUM-201 tab (TC-201-nn).
 */

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const REGISTRATION: Registration = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reference: 'REG-2026-0001',
  eventRequestId: EVENT_ID,
  fullName: 'Tan Mei Ling',
  email: 'attendee@example.com',
  contactNumber: '+65 9123 4567',
  status: 'registered',
  registeredAt: '2026-10-30T02:00:00+00:00',
};

let unreadCount = 0;
let outcome: Response;

beforeEach(() => {
  unreadCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/notifications'
          ? new Response(JSON.stringify({ unreadCount }), { status: 200 })
          : outcome,
      ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const countRequests = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/notifications').length;

async function register() {
  const page = render(
    <>
      <NotificationBell />
      <RegistrationForm eventRequestId={EVENT_ID} eventName="Client Appreciation Night" canWithdraw />
    </>,
  );
  await waitFor(() => expect(countRequests()).toBe(1));
  expect(page.queryByLabelText(/unread notifications/)).toBeNull();

  fireEvent.change(page.getByLabelText('Full name'), { target: { value: 'Tan Mei Ling' } });
  fireEvent.change(page.getByLabelText('Email address'), { target: { value: 'attendee@example.com' } });
  fireEvent.change(page.getByLabelText('Contact number'), { target: { value: '+65 9123 4567' } });
  unreadCount = 1;
  fireEvent.click(page.getByRole('button', { name: 'Register' }));
  return page;
}

describe('SCRUM-201: the bell shows the new notification without leaving the page', () => {
  it('TC-201-01 registering: the bell refetches and shows 1 unread', async () => {
    outcome = new Response(JSON.stringify(REGISTRATION), { status: 201 });
    const page = await register();

    await waitFor(() => expect(page.getByLabelText('1 unread notifications').textContent).toBe('1'));
    expect(countRequests()).toBe(2);
  });

  it('TC-201-04 refused as full: the bell refetches and shows 1 unread', async () => {
    outcome = new Response(
      JSON.stringify({ error: 'CAPACITY_EXCEEDED', message: 'There are no places remaining for this event.' }),
      { status: 409 },
    );
    const page = await register();

    await waitFor(() => expect(page.getByLabelText('1 unread notifications').textContent).toBe('1'));
    expect(page.getByRole('status').textContent).toContain('Full.');
  });

  it('TC-201-02 refused for another reason: no notification, so the bell does not refetch', async () => {
    outcome = new Response(
      JSON.stringify({ error: 'INVALID_TRANSITION', message: 'Registration for this event has closed.' }),
      { status: 409 },
    );
    const page = await register();

    await waitFor(() => expect(page.getByRole('alert').textContent).toBe('Registration for this event has closed.'));
    expect(countRequests()).toBe(1);
    expect(page.queryByLabelText(/unread notifications/)).toBeNull();
  });

  it('TC-201-07 withdrawing: the bell refetches and shows the withdrawal as unread', async () => {
    outcome = new Response(JSON.stringify({ ...REGISTRATION, status: 'withdrawn' }), { status: 200 });
    unreadCount = 1;
    const page = render(
      <>
        <NotificationBell />
        <RegisteredPanel registration={REGISTRATION} eventName="Client Appreciation Night" canWithdraw canRegisterAgain={false} />
      </>,
    );
    await waitFor(() => expect(page.getByLabelText('1 unread notifications')).toBeTruthy());

    unreadCount = 2;
    fireEvent.click(page.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(page.getByRole('button', { name: 'Yes, withdraw' }));

    await waitFor(() => expect(page.getByLabelText('2 unread notifications').textContent).toBe('2'));
    expect(page.getByText('You have withdrawn from this event.')).toBeTruthy();
  });
});
