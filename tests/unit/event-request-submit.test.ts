import { describe, it, expect } from 'vitest';
import {
  canBeSubmitted,
  canSubmit,
  incompleteFields,
  isEditable,
  PAST_PROPOSED_DATE_MESSAGE,
  submissionSummary,
  type StoredEventRequestFields,
} from '@/domain/event-request/policy';
import {
  EVENT_REQUEST_STATUS_LABELS,
  MANDATORY_FIELD_LABELS,
} from '@/domain/event-request/schema';
import { formatSingaporeDateTime } from '@/domain/shared/dates';

/**
 * SCRUM-82 — Submit a completed event request (US-5.3).
 *
 * AC text is taken from the Jira card, which is authoritative. The sheet's
 * US-5.3 AC numbering differs from Jira's; mapping by content:
 *   US-5.3-TC01 → Jira AC1 (status becomes Submitted) + AC4 (direct edit blocked)
 *   US-5.3-TC02 → Jira AC2 (attendance blank → rejected, field named)
 *   US-5.3-TC03 → Jira AC4 (opened request shows status "Submitted")
 *   US-5.3-TC04 → Jira AC1 (appears in the Ops Manager's assignment queue)
 *   US-5.3-TC05 → Jira AC3 (my event list: reference, status, submission date)
 *
 * Not coverable by a unit test - verify manually:
 *   TC01 end to end — blocked twice over: on Authentication (getCurrentActor),
 *        and on SCRUM-78's attendance input, which the form does not yet have.
 *        Until it does, every request is incomplete on "Expected attendance"
 *        and TC01 cannot pass. Flag for re-execution when 78 lands.
 *   AC1 "submission date and time are recorded" — stamped by a database
 *        trigger; check submitted_at after submitting.
 *   TC04 the assignment queue — a query (listSubmittedEventRequests); the
 *        page, and the Event Operations Manager role, are Coordinator
 *        Assignment's story and an open question respectively (CLAUDE.md).
 *   TC05 the event list itself — a page over the database; open /events. The
 *        reference is shown as stored, so the only logic to test is what the
 *        row says about status and submission time, which is covered below.
 *   AC4 no edit/save/delete offered — a page; open a submitted request.
 */

const A_MONDAY = '2026-11-09';

const complete: StoredEventRequestFields = {
  name: 'Annual Tech Summit',
  purpose: 'Networking',
  description: 'Yearly gathering',
  proposedDate: '2026-11-15',
  timeSlots: ['PM'],
  expectedAttendance: 80,
};

describe('SCRUM-82 — Submit a completed event request', () => {
  describe('AC1 — every mandatory field complete: the request can be submitted', () => {
    // US-5.3-TC01 — all mandatory fields filled: submission goes through
    it('finds nothing incomplete in a fully filled-in request', () => {
      expect(incompleteFields(complete, A_MONDAY)).toEqual([]);
      expect(canSubmit(complete, A_MONDAY)).toBe(true);
    });

    it('lets a draft be submitted, and never a request that already is', () => {
      expect(canBeSubmitted('DRAFT')).toBe(true);
      expect(canBeSubmitted('SUBMITTED')).toBe(false);
    });

    it('renders the submission time in Singapore time, zone shown', () => {
      // 18:00 UTC on the 14th is already 2:00 am on the 15th in Singapore.
      const rendered = formatSingaporeDateTime('2026-11-14T18:00:00Z');
      expect(rendered).toContain('15 Nov 2026');
      expect(rendered).toContain('2:00 am');
      // The zone's short name depends on the ICU build: 'SGT' or 'GMT+8'.
      expect(rendered).toMatch(/SGT|GMT\+8/);
    });
  });

  describe('AC2 — incomplete mandatory fields: submission blocked, each listed by name', () => {
    // US-5.3-TC02 — attendance left blank: rejected, "attendance" identified
    it('names expected attendance when it was left blank', () => {
      const result = incompleteFields({ ...complete, expectedAttendance: null }, A_MONDAY);
      expect(result).toEqual([
        {
          field: 'expectedAttendance',
          label: 'Expected attendance',
          reason: 'Expected attendance is required',
        },
      ]);
      expect(canSubmit({ ...complete, expectedAttendance: null }, A_MONDAY)).toBe(false);
    });

    it('names a blank purpose', () => {
      const result = incompleteFields({ ...complete, purpose: '' }, A_MONDAY);
      expect(result.map((item) => item.label)).toEqual(['Purpose']);
    });

    it('names a field that was never filled in at all', () => {
      const result = incompleteFields({ ...complete, description: null }, A_MONDAY);
      expect(result.map((item) => item.field)).toEqual(['description']);
    });

    it('lists every incomplete field, not just the first, in form order', () => {
      const result = incompleteFields(
        { ...complete, purpose: '', timeSlots: [], expectedAttendance: null },
        A_MONDAY,
      );
      expect(result.map((item) => item.label)).toEqual([
        'Purpose',
        'Time slots',
        'Expected attendance',
      ]);
    });

    it('lists a field once even when it breaks more than one rule', () => {
      // -2.5 is neither a whole number nor positive: two schema issues, one entry.
      const result = incompleteFields({ ...complete, expectedAttendance: -2.5 }, A_MONDAY);
      expect(result).toHaveLength(1);
      expect(result[0]?.field).toBe('expectedAttendance');
    });

    it('treats a proposed date that has passed as incomplete (SCRUM-76 AC3)', () => {
      const result = incompleteFields({ ...complete, proposedDate: '2026-11-08' }, A_MONDAY);
      expect(result).toEqual([
        { field: 'proposedDate', label: 'Proposed date', reason: PAST_PROPOSED_DATE_MESSAGE },
      ]);
    });

    it('accepts a proposed date of today - the date rule has no lead time', () => {
      expect(incompleteFields({ ...complete, proposedDate: A_MONDAY }, A_MONDAY)).toEqual([]);
    });

    it('gives every mandatory field a name to list it by', () => {
      const allEmpty: StoredEventRequestFields = {
        name: null,
        purpose: null,
        description: null,
        proposedDate: null,
        timeSlots: null,
        expectedAttendance: null,
      };
      const result = incompleteFields(allEmpty, A_MONDAY);
      expect(result.map((item) => item.label)).toEqual(Object.values(MANDATORY_FIELD_LABELS));
      for (const item of result) expect(item.reason).not.toBe('');
    });

    it('keeps a refused draft editable', () => {
      // A refusal changes nothing: the request is still a draft, so still editable.
      expect(isEditable('DRAFT')).toBe(true);
    });
  });

  describe('AC3 — my event list shows reference, status and submission date', () => {
    // US-5.3-TC05 — request just submitted: appears with reference, "Submitted"
    // badge, and its submission date in Singapore time
    it('describes a submitted request by its Singapore-time submission moment', () => {
      // 18:00 UTC on the 14th is 2:00 am on the 15th in Singapore - the row
      // must say the 15th, or the organiser is shown the wrong day.
      const summary = submissionSummary('2026-11-14T18:00:00Z');
      expect(summary).toMatch(/^Submitted /);
      expect(summary).toContain('15 Nov 2026');
      expect(summary).toContain('2:00 am');
      expect(EVENT_REQUEST_STATUS_LABELS.SUBMITTED).toBe('Submitted');
    });

    it('says so plainly when a request has not been submitted yet', () => {
      expect(submissionSummary(null)).toBe('Not yet submitted');
    });
  });

  describe('AC4 — a submitted request is read-only and shows its status', () => {
    // US-5.3-TC01 (second half) — attempting to edit directly is blocked
    it('offers no edit, save or delete once submitted', () => {
      expect(isEditable('SUBMITTED')).toBe(false);
    });

    // US-5.3-TC03 — status "Submitted" is displayed
    it('labels the status "Submitted" for the organiser', () => {
      expect(EVENT_REQUEST_STATUS_LABELS.SUBMITTED).toBe('Submitted');
      expect(EVENT_REQUEST_STATUS_LABELS.DRAFT).toBe('Draft');
    });
  });
});
