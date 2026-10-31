// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { RegisteredPanel } from '@/components/event-registration/RegisteredPanel';
import type { Registration } from '@/domain/event-registration/schema';

/**
 * SCRUM-184 AC1: the Withdraw action on the event page. Rendered for real;
 * only fetch is replaced, so what is proved is that nothing is sent until the
 * attendee confirms (TC-184-02), and that a confirmed withdrawal shows the
 * registration as Withdrawn (TC-184-01).
 *
 * Test case IDs are from the ConnectSphere_TestCases_Sprint4 workbook,
 * SCRUM-184 tab (TC-184-nn).
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...REGISTRATION, status: 'withdrawn' }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPanel = () =>
  render(<RegisteredPanel registration={REGISTRATION} eventName="Client Appreciation Night" canWithdraw />);

describe('SCRUM-184 AC1: withdraw and confirm', () => {
  it('TC-184-01 Withdraw, then Yes, withdraw: one request to the withdraw route, and the registration is shown as Withdrawn', async () => {
    const { getByRole, getByText, queryByRole } = renderPanel();
    expect(getByText('You are registered for this event.')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(getByRole('button', { name: 'Yes, withdraw' }));

    await waitFor(() => expect(getByText('You have withdrawn from this event.')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`/api/events/${EVENT_ID}/registrations/${REGISTRATION.id}/withdraw`, {
      method: 'POST',
    });
    expect(getByText('Withdrawn')).toBeTruthy();
    expect(queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('TC-184-02 Withdraw, then Keep my registration: nothing is sent and it is still Registered', () => {
    const { getByRole, getByText, queryByRole } = renderPanel();

    fireEvent.click(getByRole('button', { name: 'Withdraw' }));
    expect(getByRole('alertdialog', { name: 'Confirm withdrawal' })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Keep my registration' }));

    expect(fetch).not.toHaveBeenCalled();
    expect(queryByRole('alertdialog')).toBeNull();
    expect(getByText('You are registered for this event.')).toBeTruthy();
    expect(getByText('Registered')).toBeTruthy();
    expect(getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('TC-184-03 a refusal is shown in the prompt and the registration stays as it was', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'INVALID_TRANSITION', message: 'This registration has already been withdrawn.' }),
        { status: 409 },
      ),
    );
    const { getByRole, getByText } = renderPanel();

    fireEvent.click(getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(getByRole('button', { name: 'Yes, withdraw' }));

    await waitFor(() => expect(getByRole('alert').textContent).toBe('This registration has already been withdrawn.'));
    expect(getByText('You are registered for this event.')).toBeTruthy();
  });
});

describe('SCRUM-184 AC3: no withdraw action once the event has taken place', () => {
  it('TC-184-07, TC-184-08 the registration is shown, with no Withdraw', () => {
    const { getByText, queryByRole } = render(
      <RegisteredPanel registration={REGISTRATION} eventName="Client Appreciation Night" canWithdraw={false} />,
    );

    expect(getByText('You are registered for this event.')).toBeTruthy();
    expect(getByText('Registered')).toBeTruthy();
    expect(queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });
});
