'use client';

import { useState } from 'react';
import type { Registration } from '@/domain/event-registration/schema';
import { RegistrationConfirmation } from './RegistrationConfirmation';
import { WithdrawRegistrationButton } from './WithdrawRegistrationButton';

/**
 * SCRUM-184 — the attendee's own registration on the event page, with the
 * Withdraw action (AC1). Once withdrawn the same panel shows it as Withdrawn;
 * reloading the page then offers the form again, since the place is free.
 */
export function RegisteredPanel({
  registration: initial,
  eventName,
}: {
  registration: Registration;
  eventName: string;
}) {
  const [registration, setRegistration] = useState(initial);
  const withdrawn = registration.status === 'withdrawn';

  return (
    <>
      <RegistrationConfirmation
        registration={registration}
        eventName={eventName}
        heading={withdrawn ? 'You have withdrawn from this event.' : 'You are registered for this event.'}
        tone={withdrawn ? 'notice' : 'success'}
      />
      {withdrawn ? null : (
        <div className="mt-3">
          <WithdrawRegistrationButton
            eventRequestId={registration.eventRequestId}
            registrationId={registration.id}
            eventName={eventName}
            onWithdrawn={setRegistration}
          />
        </div>
      )}
    </>
  );
}
