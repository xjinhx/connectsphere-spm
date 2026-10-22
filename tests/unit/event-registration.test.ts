import { describe, expect, it } from 'vitest';
import { RegistrationInputSchema } from '@/domain/event-registration/schema';

/**
 * SCRUM-181 Register for an event (Jira, authoritative). The form's fields and
 * the registration period rule, by test case. Registering runs through the
 * service in tests/unit/event-registration-service.test.ts and against the
 * database in tests/integration/register-for-event.test.ts.
 *
 * Test case IDs are from SCRUM-181-test-cases.xlsx (TC-181-nn). "Today" is
 * 30/10/2026, Singapore time.
 */

const VALID = { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' };

function fieldErrors(input: unknown) {
  const result = RegistrationInputSchema.safeParse(input);
  return result.success ? {} : result.error.flatten().fieldErrors;
}

describe('the registration form (AC1)', () => {
  it('TC-181-01 accepts full name, email address and contact number, trimmed', () => {
    expect(RegistrationInputSchema.parse({ ...VALID, fullName: '  Tan Mei Ling ' })).toEqual(VALID);
  });

  it.each(['fullName', 'email', 'contactNumber'] as const)(
    'TC-181-03 refuses %s when empty, missing or blank, naming only that field',
    (field) => {
      for (const value of ['', undefined, '   ']) {
        const errors = fieldErrors({ ...VALID, [field]: value });
        expect(Object.keys(errors)).toEqual([field]);
      }
    },
  );

  it('TC-181-03 names all three fields together when all are blank', () => {
    expect(fieldErrors({ fullName: '', email: '', contactNumber: '' })).toEqual({
      fullName: ['Enter your full name.'],
      email: ['Enter your email address.'],
      contactNumber: ['Enter your contact number.'],
    });
  });

  it.each(['mei.ling@', 'mei ling@example.com', 'mei.ling.example.com'])(
    'TC-181-04 refuses the email %s, flagging the email field only',
    (email) => {
      expect(fieldErrors({ ...VALID, email })).toEqual({ email: ['Enter a valid email address.'] });
    },
  );
});
