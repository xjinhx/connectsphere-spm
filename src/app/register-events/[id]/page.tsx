/**
 * Placeholder only — not a real feature. Added so SCRUM-72 AC1 ("an Attendee
 * viewing the event page must not see internal planning data") has a page to
 * point at at all; before this there was no Attendee-facing event page in the
 * codebase for AC1 to be tested against (see the SCRUM-72 PR description).
 *
 * Deliberately renders nothing from the domain layer - no getEventRequest,
 * no registration/attendance check, no event data of any kind - so there is
 * nothing here that could leak internal planning fields. That also means it
 * does not prove AC1's hiding behaviour; it only removes the "there is
 * nothing to test against" blocker. AC1 stays pending real verification once
 * the actual Attendee Registration story (out of this sprint, see
 * CLAUDE.md "Current sprint scope") builds the real event-viewing page.
 */
export default function AttendeeEventPlaceholderPage() {
  return (
    <main className="flex min-h-screen flex-col gap-2 p-8">
      <h1 className="text-2xl font-semibold">Event</h1>
      <p className="text-[var(--text-muted)]">
        This page is a placeholder. Attendee-facing event details have not been built yet.
      </p>
    </main>
  );
}
