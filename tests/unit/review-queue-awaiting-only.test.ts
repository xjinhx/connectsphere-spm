import { describe, it, expect } from 'vitest';
import { isAwaitingReview } from '@/domain/review/policy';

/**
 * SCRUM-97 AC1 (Jira, authoritative) — "... whereas my review queue shows only
 * those awaiting review."
 *
 * The review queue (src/app/assigned-events/page.tsx) keeps an assigned event
 * only when isAwaitingReview is true for its status. These test that rule for
 * the five statuses the AC names, including Planning and Confirmed, which
 * SCRUM-103 added after isAwaitingReview was written. They do not test the
 * page's filter itself: the page needs a signed-in session, so TC-97-03/04 are
 * checked by hand on /assigned-events.
 */
describe('SCRUM-97 AC1 — the review queue keeps only events awaiting review', () => {
  it('TC-97-03: keeps a submitted event', () => {
    expect(isAwaitingReview('submitted')).toBe(true);
  });

  it.each(['clarification_requested', 'approved', 'planning', 'confirmed'] as const)(
    'TC-97-04: leaves out a %s event',
    (status) => {
      expect(isAwaitingReview(status)).toBe(false);
    },
  );
});
