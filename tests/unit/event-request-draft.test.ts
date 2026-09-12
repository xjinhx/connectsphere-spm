import { describe, it, expect } from 'vitest';
import {
  eventRequestDraftSchema,
  eventRequestSaveSchema,
  type EventRequestDraftInput,
} from '@/domain/event-request/schema';
import {
  canSubmit,
  incompleteFields,
  isOwnRequest,
  isResumable,
  type StoredEventRequestFields,
} from '@/domain/event-request/policy';

/**
 * SCRUM-83 — Save an incomplete request as a draft
 * SCRUM-85 — Resume editing a draft
 * SCRUM-87 — Submit a draft for review
 * (US-6.1 "Save, resume and submit a draft")
 *
 * AC text is taken from the Jira cards, which are authoritative (CLAUDE.md:
 * "Acceptance criteria: Jira is authoritative, not the spreadsheet"). The
 * sheet's US-6.1 is a consolidated story covering SCRUM-83+84+85+87 and its
 * AC list does not carry SCRUM-83's Jira AC3 (a colleague's draft is not
 * listed and access is denied) at all — that is covered below regardless,
 * because Jira wins.
 *
 * Test case mapping, sheet → what is asserted here:
 *   US-6.1-TC01 → SCRUM-83 AC1: only the name entered, saved with no error
 *   US-6.1-TC03 → SCRUM-85 AC3: a reopened draft still holds what was entered
 *   US-6.1-TC04 → SCRUM-83 AC4: re-saving edits the same draft (rule half)
 *   US-6.1-TC05 → SCRUM-87 AC5: a complete draft submits under the SAME rules
 *                 as any other request — so this asserts against SCRUM-82's
 *                 incompleteFields()/canSubmit(), rather than a second
 *                 implementation of "what is mandatory".
 *
 * US-6.1-TC02 (drafts shown separately in the event list) is SCRUM-84's
 * story, not one of these three, and is not covered here.
 *
 * Not coverable by a unit test - verify manually once Authentication lands:
 *   TC01/TC03/TC04 end to end — every service function starts at
 *        getCurrentActor(), which throws by design until the Authentication
 *        story implements it (see src/lib/auth/currentActor.ts).
 *   TC04's "no duplicate draft is created" — the half that matters at runtime
 *        is that updateEventRequestDraft() issues an UPDATE on the id and
 *        never an INSERT; check the row count after re-saving.
 *   TC03's pre-filled form — a page; open /events/<id>/edit on a draft.
 */

const A_MONDAY = '2026-11-09';

describe('SCRUM-83 — Save an incomplete request as a draft', () => {
  describe('AC1 — whatever is filled in is saved, with no mandatory-field check', () => {
    // US-6.1-TC01 — only the event name has been entered
    it('saves a draft with nothing but the event name', () => {
      const result = eventRequestDraftSchema.safeParse({ name: 'Charity Gala' });

      expect(result.success).toBe(true);
      expect(result.success && result.data.name).toBe('Charity Gala');
    });

    it('treats blank fields as "not entered" rather than as errors', () => {
      const result = eventRequestDraftSchema.safeParse({
        name: 'Charity Gala',
        purpose: '',
        description: '',
        proposedDate: '',
        expectedAttendance: undefined,
      });

      expect(result.success).toBe(true);
      expect(result.success && result.data.purpose).toBeUndefined();
      expect(result.success && result.data.proposedDate).toBeUndefined();
    });

    // The same payload put through SCRUM-76's save is refused. Both are
    // correct: US-5.1 AC5 makes the basic details mandatory on "Save request",
    // US-6.1 AC1 says they are not on "Save as draft". This asserts the two
    // actions really do behave differently, which is the whole point of 83.
    it('accepts what the mandatory-field save (SCRUM-76) refuses', () => {
      const nameOnly = { name: 'Charity Gala' };

      expect(eventRequestDraftSchema.safeParse(nameOnly).success).toBe(true);
      expect(eventRequestSaveSchema.safeParse(nameOnly).success).toBe(false);
    });

    it('keeps every value that was entered', () => {
      const result = eventRequestDraftSchema.safeParse({
        name: 'Annual Tech Summit',
        purpose: 'Networking',
        description: 'Yearly gathering',
        proposedDate: '2026-11-15',
        timeSlots: ['pm'],
        expectedAttendance: 80,
      });

      expect(result.success).toBe(true);
      const draft = (result as { data: EventRequestDraftInput }).data;
      expect(draft.purpose).toBe('Networking');
      expect(draft.timeSlots).toEqual(['pm']);
      expect(draft.expectedAttendance).toBe(80);
    });
  });

  describe('AC1 — format is still checked on values that were entered', () => {
    // "no mandatory-field check" is not "no checks at all": a value the
    // organiser actually typed still has to be a usable one.
    it('refuses an attendance that is zero or negative', () => {
      expect(
        eventRequestDraftSchema.safeParse({ name: 'Gala', expectedAttendance: 0 }).success,
      ).toBe(false);
      expect(
        eventRequestDraftSchema.safeParse({ name: 'Gala', expectedAttendance: -5 }).success,
      ).toBe(false);
    });

    it('refuses a fractional attendance', () => {
      expect(
        eventRequestDraftSchema.safeParse({ name: 'Gala', expectedAttendance: 12.5 }).success,
      ).toBe(false);
    });

    it('refuses a proposed date that is not a date', () => {
      expect(
        eventRequestDraftSchema.safeParse({ name: 'Gala', proposedDate: 'next Tuesday' }).success,
      ).toBe(false);
    });

    it('refuses a slot that does not exist', () => {
      expect(
        eventRequestDraftSchema.safeParse({ name: 'Gala', timeSlots: ['MIDNIGHT'] }).success,
      ).toBe(false);
    });

    // The column is `not null` with a non-blank check, the event list needs a
    // label for the draft (AC2), and TC01 supplies one.
    it('still requires an event name', () => {
      expect(eventRequestDraftSchema.safeParse({}).success).toBe(false);
      expect(eventRequestDraftSchema.safeParse({ name: '' }).success).toBe(false);
    });
  });

  describe('AC3 (Jira) — a colleague cannot open my draft', () => {
    // No sheet test case covers this; it is on the Jira card, which wins.
    // Applied by requireOwnRequest() before any draft is returned, so it
    // guards GET /api/event-requests/<id>, the edit page and the draft PATCH
    // alike — a direct URL is refused the same as a link would be.
    it('recognises the organiser who saved the draft as its owner', () => {
      expect(isOwnRequest({ organiserId: 'organiser-1' }, 'organiser-1')).toBe(true);
    });

    it('denies a colleague in the same client organisation', () => {
      expect(isOwnRequest({ organiserId: 'organiser-1' }, 'colleague-2')).toBe(false);
    });
  });

  describe('AC4 — saving again updates the same draft', () => {
    // US-6.1-TC04 — the rule half: a draft stays editable, so the second save
    // has something to update. The "one row, not two" half is the service
    // issuing an UPDATE, noted above as manual.
    it('leaves a draft editable after it has been saved', () => {
      expect(isResumable('draft')).toBe(true);
    });
  });
});

describe('SCRUM-85 — Resume editing a draft', () => {
  describe('AC3 — a saved draft reopens with what was entered', () => {
    // US-6.1-TC03 — the values the edit form is seeded with are the values
    // that were stored; nothing is dropped on the way back out.
    it('round-trips a partially filled draft', () => {
      const stored = { name: 'Charity Gala', purpose: 'Fundraising' };
      const result = eventRequestDraftSchema.safeParse(stored);

      expect(result.success).toBe(true);
      expect(result.success && result.data).toMatchObject(stored);
    });

    it('allows a draft to be reopened', () => {
      expect(isResumable('draft')).toBe(true);
    });
  });

  describe('AC3 — a submitted request is not a draft and cannot be resumed', () => {
    // Guards the edit page and PATCH /api/event-requests/<id>/draft: SCRUM-82
    // AC4 made a submitted request read-only, and resuming must not be a way
    // around it.
    it('refuses to reopen a submitted request', () => {
      expect(isResumable('submitted')).toBe(false);
    });
  });
});

describe('SCRUM-87 — Submit a draft for review', () => {
  const completeDraft: StoredEventRequestFields = {
    name: 'Annual Tech Summit',
    purpose: 'Networking',
    description: 'Yearly gathering',
    proposedDate: '2026-11-15',
    timeSlots: ['pm'],
    expectedAttendance: 80,
  };

  const partialDraft: StoredEventRequestFields = {
    name: 'Charity Gala',
    purpose: null,
    description: null,
    proposedDate: null,
    timeSlots: null,
    expectedAttendance: null,
  };

  describe('AC5 — a complete draft submits under the same rules as any request', () => {
    // US-6.1-TC05. AC5 says "follows the same submission rules as any other
    // request", so this deliberately asserts against SCRUM-82's own functions.
    // If that rule ever changes, this test moves with it instead of drifting.
    it('lets a draft with every mandatory field filled in be submitted', () => {
      expect(incompleteFields(completeDraft, A_MONDAY)).toEqual([]);
      expect(canSubmit(completeDraft, A_MONDAY)).toBe(true);
    });
  });

  describe('AC5 — an incomplete draft is refused, and says what is missing', () => {
    it('blocks a draft that is still mostly empty', () => {
      expect(canSubmit(partialDraft, A_MONDAY)).toBe(false);
    });

    it('names every field that is still missing', () => {
      const missing = incompleteFields(partialDraft, A_MONDAY).map((field) => field.field);

      expect(missing).toEqual([
        'purpose',
        'description',
        'proposedDate',
        'timeSlots',
        'expectedAttendance',
      ]);
    });

    it('leaves the draft editable so it can be finished', () => {
      expect(isResumable('draft')).toBe(true);
    });
  });
});