'use client';

import { useState } from 'react';
import type { Registration } from '@/domain/event-registration/schema';
import { RegistrationConfirmation } from './RegistrationConfirmation';
// RegistrationForm shows this panel once it registers; each is rendered by the
// other only after a click, so the two imports do not loop when loading.
import { RegistrationForm } from './RegistrationForm';
import { WithdrawRegistrationButton } from './WithdrawRegistrationButton';

/**
 * SCRUM-184 — the attendee's own registration on the event page, with the
 * Withdraw action (AC1), not offered once the event has taken place (AC3).
 * Once withdrawn the same panel shows it as Withdrawn and, while registration
 * is open, the form below it, since the place is free; no reload is needed.
 * `heading` replaces the registered heading, for the confirmation straight
 * after registering (SCRUM-181 AC1, AC5).
 */
export function RegisteredPanel({
  registration: initial,
  eventName,
  canWithdraw,
  canRegisterAgain,
  heading = 'You are registered for this event.',
}: {
  registration: Registration;
  eventName: string;
  canWithdraw: boolean;
  /** The registration period is open and the viewer is an attendee. */
  canRegisterAgain: boolean;
  heading?: string;
}) {
  const [registration, setRegistration] = useState(initial);
  const withdrawn = registration.status === 'withdrawn';

  return (
    <>
      <RegistrationConfirmation
        registration={registration}
        eventName={eventName}
        heading={withdrawn ? 'You have withdrawn from this event.' : heading}
        tone={withdrawn ? 'notice' : 'success'}
      />
      {withdrawn ? (
        canRegisterAgain ? (
          <RegistrationForm
            eventRequestId={registration.eventRequestId}
            eventName={eventName}
            canWithdraw={canWithdraw}
          />
        ) : null
      ) : canWithdraw ? (
        <div className="mt-3">
          <WithdrawRegistrationButton
            eventRequestId={registration.eventRequestId}
            registrationId={registration.id}
            eventName={eventName}
            onWithdrawn={setRegistration}
          />
        </div>
      ) : null}
    </>
  );
}
