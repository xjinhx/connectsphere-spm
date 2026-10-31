import type { NavItem } from './schema';

/**
 * SCRUM-251 AC3 — the event review page links back to the list it was opened
 * from. My events marks its rows with `?from=my-events`; anything else (Review
 * queue's rows, a notification, a typed URL) goes back to Review queue, the
 * coordinator's landing page.
 */
export const FROM_MY_EVENTS = 'my-events';

export function reviewBackLink(from: string | string[] | undefined): NavItem {
  return from === FROM_MY_EVENTS
    ? { href: '/my-events', label: 'My events' }
    : { href: '/assigned-events', label: 'Review queue' };
}
