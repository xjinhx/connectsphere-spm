import type { Role } from '@/domain/identity/roles';
import type { NavItem } from './schema';

/**
 * SCRUM-249 — the nav items shown for each role, left to right. The shared
 * header (src/components/navigation/AppHeader.tsx) renders the list for the
 * role the account is working as.
 *
 * Each role's own nav story fills in its entry (SCRUM-250 to 256). Until then
 * each role shows only its landing page, so the header, its highlighting (AC4)
 * and the folded phone menu (AC6) have something real to show. Change only
 * your own role's entry, to keep merges small.
 */
export const ROLE_NAV: Record<Role, readonly NavItem[]> = {
  // SCRUM-250 AC2: Event requests, New event request, in that order.
  event_organiser: [
    { href: '/events', label: 'Event requests' },
    { href: '/events/new', label: 'New event request' },
  ],
  // SCRUM-251 AC2: Review queue, My events, Venues, Client organisations, Equipment, in that order.
  coordinator: [
    { href: '/assigned-events', label: 'Review queue' },
    { href: '/my-events', label: 'My events' },
    { href: '/venues', label: 'Venues' },
    { href: '/organisations', label: 'Client organisations' },
    { href: '/equipment', label: 'Equipment' },
  ],
  // DUMMY(SCRUM-252) D-20: Event Coordinator Lead nav is the landing page only.
  operations_manager: [{ href: '/assignment-queue', label: 'Assignment queue' }],
  // DUMMY(SCRUM-253) D-20: Venue Staff nav is the landing page only.
  venue_staff: [{ href: '/booking-queue', label: 'Booking requests' }],
  // SCRUM-254 AC2: Equipment requests, Equipment catalogue, Venues, in that order.
  technical_support: [
    { href: '/equipment-queue', label: 'Equipment requests' },
    { href: '/equipment', label: 'Equipment catalogue' },
    { href: '/venues', label: 'Venues' },
  ],
  // SCRUM-255 AC2: Open events, which is also the landing page.
  attendee: [{ href: '/register-events', label: 'Open events' }],
  // SCRUM-256 AC2: Safety checks, which is also the landing page.
  safety_officer: [{ href: '/safety-checks', label: 'Safety checks' }],
};
