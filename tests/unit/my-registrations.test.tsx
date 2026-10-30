// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MyRegistrationsList } from '@/components/event-registration/MyRegistrationsList';
import type { MyRegistration, Registration } from '@/domain/event-registration/schema';

/**
 * SCRUM-184 AC2: the attendee's registrations list. Rendered for real; only
 * fetch is replaced, so what is proved is that a withdrawn registration is
 * shown as Withdrawn and not removed, and that the Withdraw action is offered
 * only where the list says it may be.
 *
 * Test case IDs are from SCRUM-184-test-cases.xlsx (TC-184-nn).
 */

// next/link needs the App Router mounted; a plain anchor keeps the href.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NIGHT_ID = '11111111-1111-4111-8111-111111111111';
const LUNCH_ID = '22222222-2222-4222-8222-222222222222';

function registration(overrides: Partial<Registration>): Registration {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reference: 'REG-2026-0001',
    eventRequestId: NIGHT_ID,
    fullName: 'Tan Mei Ling',
    email: 'attendee@example.com',
    contactNumber: '+65 9123 4567',
    status: 'registered',
    registeredAt: '2026-10-30T02:00:00+00:00',
    ...overrides,
  };
}

const NIGHT: MyRegistration = {
  registration: registration({}),
  eventName: 'Client Appreciation Night',
  eventDate: '2026-11-15',
  canWithdraw: true,
};
const LUNCH: MyRegistration = {
  registration: registration({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reference: 'REG-2026-0002', eventRequestId: LUNCH_ID }),
  eventName: 'Partner Networking Lunch',
  eventDate: '2026-11-20',
  canWithdraw: true,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...NIGHT.registration, status: 'withdrawn' }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The list item for a reference. */
function rowFor(container: HTMLElement, reference: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-registration="${reference}"]`);
  if (!row) throw new Error(`no row for ${reference}`);
  return row;
}

describe('SCRUM-184 AC2: shown as Withdrawn rather than removed', () => {
  it('TC-184-05 withdrawing from the list keeps the row, now Withdrawn with the same reference; the other stays Registered', async () => {
    const { container } = render(<MyRegistrationsList registrations={[NIGHT, LUNCH]} />);
    const night = rowFor(container, 'REG-2026-0001');

    fireEvent.click(within(night).getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(within(night).getByRole('button', { name: 'Yes, withdraw' }));

    await waitFor(() => expect(within(night).getByText('Withdrawn')).toBeTruthy());
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(within(night).getByText('REG-2026-0001')).toBeTruthy();
    expect(within(night).queryByRole('button', { name: 'Withdraw' })).toBeNull();
    const lunch = rowFor(container, 'REG-2026-0002');
    expect(within(lunch).getByText('Registered')).toBeTruthy();
    expect(within(lunch).getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('TC-184-06 one Withdrawn and one Registered row for the same event: both listed, Withdraw only on the Registered one', () => {
    const withdrawn: MyRegistration = { ...NIGHT, registration: registration({ status: 'withdrawn' }), canWithdraw: false };
    const again: MyRegistration = {
      ...NIGHT,
      registration: registration({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', reference: 'REG-2026-0003' }),
    };
    const { container } = render(<MyRegistrationsList registrations={[again, withdrawn]} />);

    expect(container.querySelectorAll('li')).toHaveLength(2);
    const old = rowFor(container, 'REG-2026-0001');
    expect(within(old).getByText('Withdrawn')).toBeTruthy();
    expect(within(old).queryByRole('button', { name: 'Withdraw' })).toBeNull();
    const current = rowFor(container, 'REG-2026-0003');
    expect(within(current).getByText('Registered')).toBeTruthy();
    expect(within(current).getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });
});
