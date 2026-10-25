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
  // DUMMY(SCRUM-250) D-20: Event Organiser nav is the landing page only.
  event_organiser: [{ href: '/events', label: 'My event requests' }],
  // DUMMY(SCRUM-251) D-20: Event Coordinator nav is the landing page only.
  coordinator: [{ href: '/assigned-events', label: 'Assigned events' }],
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
  // DUMMY(SCRUM-256) D-20: Safety Officer nav is the landing page only.
  safety_officer: [{ href: '/safety-checks', label: 'Safety checks' }],
};
