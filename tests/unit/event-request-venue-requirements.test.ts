import { describe, it, expect } from 'vitest';
import {
  describeAccessibility,
  describePreferredLocation,
  describeRoomLayout,
  incompleteFields,
  normaliseAccessibility,
} from '@/domain/event-request/policy';
import {
  ACCESSIBILITY_NOTES_MAX_LENGTH,
  eventRequestDraftSchema,
  eventRequestSaveSchema,
  venueRequirementsSchema,
} from '@/domain/event-request/schema';
import { ROOM_LAYOUTS } from '@/domain/venues/schema';

/**
 * SCRUM-79 — State venue and accessibility requirements.
 *
 * AC text is taken from the Jira card, which is authoritative.
 *
 * Sheet mapping (US-5.2 = SCRUM-79+80+81): US-5.2-TC01 covers the layout and
 * accessibility halves of AC1/AC2 here (its capacity and facilities halves are
 * SCRUM-80's). US-5.2-TC02 in the sheet describes filtering the layout list to
 * what venues currently support; the Jira card asks for the fixed seven, so
 * that is what is built and tested - see the note on AC1 below.
 *
 * Not coverable by a unit test - verify manually:
 *   "saved with the request" (every AC) — a database write; save a request
 *   and read the row on /events/[id].
 */

const A_MONDAY = '2026-11-09';

// Ids from the maintained accessibility list (seeded by the venue catalogue).
const STEP_FREE = '11111111-1111-4111-8111-111111111111';
const HEARING_LOOP = '22222222-2222-4222-8222-222222222222';
// An id from the maintained location list (SCRUM-116).
const BUGIS = '33333333-3333-4333-8333-333333333333';

const basicDetails = {
  name: 'Annual Tech Summit',
  purpose: 'Networking',
  description: 'Yearly gathering',
  proposedDate: '2026-11-15',
};

describe('SCRUM-79 — State venue and accessibility requirements', () => {
  describe('AC1 — a layout from Theatre, Classroom, Boardroom, Banquet, U-shape, Cabaret or Standing is saved', () => {
    // US-5.2-TC01 — layout=Theatre is saved against the request
    it('keeps the chosen layout on a full save', () => {
      const result = eventRequestSaveSchema.parse({ ...basicDetails, roomLayout: 'theatre' });
      expect(result.roomLayout).toBe('theatre');
    });

    it('keeps the chosen layout on a draft save too', () => {
      const result = eventRequestDraftSchema.parse({ name: 'Summit', roomLayout: 'cabaret' });
      expect(result.roomLayout).toBe('cabaret');
    });

    it('offers exactly the seven layouts named on the card, in the catalogue order', () => {
      // The list is the venue catalogue's (SCRUM-118), not a second copy.
      expect(ROOM_LAYOUTS).toEqual([
        'theatre',
        'classroom',
        'boardroom',
        'banquet',
        'u_shape',
        'cabaret',
        'standing',
      ]);
      for (const layout of ROOM_LAYOUTS) {
        expect(venueRequirementsSchema.safeParse({ roomLayout: layout }).success).toBe(true);
      }
    });

    it('refuses a layout that is not one of the seven', () => {
      for (const invented of ['Theatre', 'ushape', 'hollow_square', 'lecture']) {
        expect(venueRequirementsSchema.safeParse({ roomLayout: invented }).success).toBe(false);
      }
    });

    it('reads a blank select as "not yet chosen", not as an invalid layout', () => {
      expect(eventRequestSaveSchema.parse({ ...basicDetails, roomLayout: '' }).roomLayout).toBeUndefined();
      expect(eventRequestSaveSchema.parse(basicDetails).roomLayout).toBeUndefined();
    });

    it('is not needed to submit - the mandatory set is unchanged', () => {
      const complete = { ...basicDetails, startTime: '13:00', endTime: '18:00', expectedAttendance: 80 };
      expect(incompleteFields(complete, A_MONDAY)).toEqual([]);
    });

    it('shows the layout in the catalogue\'s own words on the request', () => {
      expect(describeRoomLayout('u_shape')).toBe('U-shape');
      expect(describeRoomLayout(null)).toBe('Not yet provided');
    });
  });

  describe('AC2 — selected accessibility options and free-text notes are both saved', () => {
    // US-5.2-TC01 — accessibility=Wheelchair access is saved against the request
    it('keeps the chosen features and the notes when the answer is yes', () => {
      const parsed = eventRequestSaveSchema.parse({
        ...basicDetails,
        accessibilityRequired: true,
        accessibilityFeatureIds: [STEP_FREE, HEARING_LOOP],
        accessibilityNotes: 'Wheelchair user on the panel; needs a ramp to the stage.',
      });
      expect(normaliseAccessibility(parsed)).toEqual({
        required: true,
        featureIds: [STEP_FREE, HEARING_LOOP],
        notes: 'Wheelchair user on the panel; needs a ramp to the stage.',
      });
    });

    it('keeps them on a draft save too', () => {
      const parsed = eventRequestDraftSchema.parse({
        name: 'Summit',
        accessibilityRequired: true,
        accessibilityFeatureIds: [STEP_FREE],
      });
      expect(normaliseAccessibility(parsed).featureIds).toEqual([STEP_FREE]);
    });

    it('accepts a yes with features but no notes, and a yes with notes but no features', () => {
      expect(
        normaliseAccessibility({ accessibilityRequired: true, accessibilityFeatureIds: [STEP_FREE] }),
      ).toEqual({ required: true, featureIds: [STEP_FREE], notes: null });
      expect(
        normaliseAccessibility({
          accessibilityRequired: true,
          accessibilityFeatureIds: [],
          accessibilityNotes: 'Sign language interpreter needed',
        }),
      ).toEqual({ required: true, featureIds: [], notes: 'Sign language interpreter needed' });
    });

    it('treats the selection as a set and stores nothing for blank notes', () => {
      const result = normaliseAccessibility({
        accessibilityRequired: true,
        accessibilityFeatureIds: [STEP_FREE, STEP_FREE],
        accessibilityNotes: '   ',
      });
      expect(result).toEqual({ required: true, featureIds: [STEP_FREE], notes: null });
    });

    it('only accepts ids that could be on the maintained list', () => {
      expect(
        venueRequirementsSchema.safeParse({ accessibilityFeatureIds: ['wheelchair'] }).success,
      ).toBe(false);
    });

    it(`refuses notes longer than ${ACCESSIBILITY_NOTES_MAX_LENGTH} characters`, () => {
      const tooLong = 'x'.repeat(ACCESSIBILITY_NOTES_MAX_LENGTH + 1);
      expect(venueRequirementsSchema.safeParse({ accessibilityNotes: tooLong }).success).toBe(false);
      expect(
        venueRequirementsSchema.safeParse({ accessibilityNotes: tooLong.slice(1) }).success,
      ).toBe(true);
    });

    it('shows the features and the notes on the request', () => {
      expect(
        describeAccessibility({
          accessibilityRequired: true,
          accessibilityFeatures: [{ name: 'Step-free access' }, { name: 'Hearing loop' }],
          accessibilityNotes: 'Ramp to the stage',
        }),
      ).toBe('Step-free access, Hearing loop\nRamp to the stage');
    });
  });

  describe('AC3 — "none" is saved as an explicit answer, not left blank', () => {
    it('distinguishes "none" from "not yet answered"', () => {
      const none = normaliseAccessibility({ accessibilityRequired: false, accessibilityFeatureIds: [] });
      const unanswered = normaliseAccessibility({ accessibilityFeatureIds: [] });
      expect(none.required).toBe(false);
      expect(unanswered.required).toBeNull();
    });

    it('reads an untouched radio as unanswered and a "none" as false', () => {
      expect(eventRequestSaveSchema.parse(basicDetails).accessibilityRequired).toBeUndefined();
      expect(
        eventRequestSaveSchema.parse({ ...basicDetails, accessibilityRequired: false })
          .accessibilityRequired,
      ).toBe(false);
    });

    it('drops features and notes left over from before the answer became "none"', () => {
      const result = normaliseAccessibility({
        accessibilityRequired: false,
        accessibilityFeatureIds: [STEP_FREE],
        accessibilityNotes: 'typed earlier',
      });
      expect(result).toEqual({ required: false, featureIds: [], notes: null });
    });

    it('drops them too while the question is still unanswered', () => {
      const result = normaliseAccessibility({
        accessibilityFeatureIds: [STEP_FREE],
        accessibilityNotes: 'typed earlier',
      });
      expect(result).toEqual({ required: null, featureIds: [], notes: null });
    });

    it('tells the two apart on the request', () => {
      const noDetails = { accessibilityFeatures: [], accessibilityNotes: null };
      expect(describeAccessibility({ accessibilityRequired: false, ...noDetails })).toBe(
        'None required',
      );
      expect(describeAccessibility({ accessibilityRequired: null, ...noDetails })).toBe(
        'Not yet answered',
      );
      expect(describeAccessibility({ accessibilityRequired: true, ...noDetails })).toBe(
        'Required - details not yet given',
      );
    });
  });

  describe('AC4 — a blank location saves, and is recorded as no preference', () => {
    it('keeps a chosen location', () => {
      const result = eventRequestSaveSchema.parse({ ...basicDetails, preferredLocationId: BUGIS });
      expect(result.preferredLocationId).toBe(BUGIS);
    });

    it('saves with the location left blank', () => {
      const blank = eventRequestSaveSchema.safeParse({ ...basicDetails, preferredLocationId: '' });
      expect(blank.success).toBe(true);
      expect(blank.success && blank.data.preferredLocationId).toBeUndefined();
      expect(eventRequestSaveSchema.parse(basicDetails).preferredLocationId).toBeUndefined();
    });

    it('saves a draft with the location left blank too', () => {
      expect(eventRequestDraftSchema.parse({ name: 'Summit' }).preferredLocationId).toBeUndefined();
    });

    it('only accepts a location that could be on the maintained list', () => {
      expect(venueRequirementsSchema.safeParse({ preferredLocationId: 'Bugis' }).success).toBe(false);
    });

    it('shows a blank location as no preference on the request', () => {
      expect(describePreferredLocation(null)).toBe('No preference');
      expect(describePreferredLocation({ name: 'Bugis' })).toBe('Bugis');
    });
  });
});
