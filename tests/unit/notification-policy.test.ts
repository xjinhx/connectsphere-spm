import { describe, it, expect } from 'vitest';
import { canAccessNotification, notificationHref } from '@/domain/notification/policy';

/** SCRUM-193's implicit access rule: a notification is only its recipient's. */
describe('canAccessNotification', () => {
  it('allows the recipient', () => {
    expect(canAccessNotification('user-1', 'user-1')).toBe(true);
  });

  it('refuses anyone else', () => {
    expect(canAccessNotification('user-1', 'user-2')).toBe(false);
  });
});

/**
 * SCRUM-241 (bug found in SCRUM-193): the link a notification resolves to
 * must match who actually receives it, not a single hardcoded template.
 * 'coordinator_assigned' and 'venue_booking_update' go to the event's
 * coordinator, who can't open the organiser's /events/<id> (getEventRequest
 * throws ForbiddenError for anyone outside the organiser's own
 * organisation) - they need the review page instead.
 */
describe('notificationHref', () => {
  const eventRequestId = 'event-1';

  it('routes a venue booking update (coordinator-facing) to the review page', () => {
    expect(notificationHref({ type: 'venue_booking_update', eventRequestId })).toBe(
      '/events/event-1/review',
    );
  });

  it('routes a coordinator assignment (coordinator-facing) to the review page', () => {
    expect(notificationHref({ type: 'coordinator_assigned', eventRequestId })).toBe(
      '/events/event-1/review',
    );
  });

  it('routes an organiser-facing type (e.g. request_rejected) to the plain event page', () => {
    expect(notificationHref({ type: 'request_rejected', eventRequestId })).toBe(
      '/events/event-1',
    );
  });

  it('routes the remaining organiser-facing types to the plain event page', () => {
    expect(notificationHref({ type: 'request_approved', eventRequestId })).toBe('/events/event-1');
    expect(notificationHref({ type: 'coordinator_named', eventRequestId })).toBe('/events/event-1');
    expect(notificationHref({ type: 'clarification_requested', eventRequestId })).toBe(
      '/events/event-1',
    );
  });

  it('defaults an unrecognised type to the plain event page', () => {
    expect(notificationHref({ type: 'something_new', eventRequestId })).toBe('/events/event-1');
  });
});
