import { describe, expect, it } from 'vitest';
import { refusalMessage, type ChangeRequestRefusal } from '@/components/change-request/refusalMessage';
import { RaiseChangeRequestInputSchema } from '@/domain/change-request/schema';
import { ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';

/**
 * SCRUM-273 (bug on SCRUM-187 AC1): the change request form showed "The
 * change request is not valid." for every refusal, though the API sends the
 * reason on the field. Each refusal here is the JSON the form receives, built
 * the way the route builds it: raiseChangeRequest's ValidationError from the
 * real schema, turned into a response by handleApiError.
 *
 * Exp 2 (nothing is saved) is unchanged by this fix and stays covered by the
 * SCRUM-187 integration tests in tests/integration/change-request.test.ts
 * (TC-187-04, and the missing proposed value). Test case IDs match the
 * SCRUM-273 tab of the test case sheet.
 */

const GENERIC = 'The change request is not valid.';

/** The body POST /api/event-requests/[id]/change-requests returns for this input. */
async function refusalFor(input: unknown): Promise<ChangeRequestRefusal> {
  const parsed = RaiseChangeRequestInputSchema.safeParse(input);
  if (parsed.success) throw new Error('expected the input to be refused');
  const response = handleApiError(new ValidationError(GENERIC, parsed.error.flatten()));
  return (await response.json()) as ChangeRequestRefusal;
}

describe('SCRUM-273: a refused change request shows the reason on the field (Exp 1)', () => {
  it('TC-273-01: no reason shows "A reason is required.", not the generic message', async () => {
    const payload = await refusalFor({ fields: [{ field: 'expectedAttendance', proposedValue: 190 }], reason: '' });

    expect(payload?.message).toBe(GENERIC);
    expect(refusalMessage(payload)).toBe('A reason is required.');
  });

  it('TC-273-02: a selected field left blank shows "Give the new value for each selected field."', async () => {
    // The form sends null for a blank text field (parseValue in ChangeRequestForm).
    const payload = await refusalFor({ fields: [{ field: 'description', proposedValue: null }], reason: 'Clearing it' });

    expect(payload?.message).toBe(GENERIC);
    expect(refusalMessage(payload)).toBe('Give the new value for each selected field.');
  });

  it('names both problems, each once, when a request has two', async () => {
    const payload = await refusalFor({
      fields: [
        { field: 'description', proposedValue: null },
        { field: 'purpose', proposedValue: null },
      ],
      reason: '',
    });

    expect(refusalMessage(payload)).toBe('Give the new value for each selected field. A reason is required.');
  });

  it("keeps the API's own message when a refusal names no field", async () => {
    const response = handleApiError(new ForbiddenError('You can only request changes to your own event requests.'));
    const payload = (await response.json()) as ChangeRequestRefusal;

    expect(refusalMessage(payload)).toBe('You can only request changes to your own event requests.');
  });

  it('falls back to "The change request could not be sent." when there is no answer to read', () => {
    expect(refusalMessage(null)).toBe('The change request could not be sent.');
  });
});
