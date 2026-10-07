import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getVenueCalendar } from '@/domain/venues/calendar';
import { canViewVenueCatalogue } from '@/domain/venues/policy';
import {
  CALENDAR_MAX_DAYS,
  CALENDAR_SLOT_STATE_LABELS,
  OPERATING_SLOTS,
  OPERATING_SLOT_LABELS,
  type CalendarSlot,
  type VenueCalendar,
} from '@/domain/venues/schema';
import { NotFoundError, ValidationError } from '@/domain/shared/errors';
import { formatSingaporeDate, todayInSingapore } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';
import NoVenueAccess from '@/components/venue/NoVenueAccess';

/**
 * SCRUM-123 View a venue's calendar with the state of each slot.
 *
 * AC1 every date in the range shows its AM, PM and Night slot with a state.
 * AC2 Available, AC3 Outside operating hours (cannot be requested), AC5
 *     Confirmed, AC6 Pending request, AC7 Blocked with its reason.
 * AC4 a date with every slot it runs committed reads Fully committed.
 * AC8 a request on a confirmed slot leaves it Confirmed, with the request
 *     shown beside it.
 * AC9/AC10 needs venue_catalogue_view, checked before anything is read; the
 *     API route enforces the same rule with a 403.
 * SCRUM-148 AC3/AC4 a Confirmed slot names its event for Venue Staff, the
 *     event's coordinator and Operations Managers; others see only Confirmed.
 *
 * A server component with a plain GET form, so a range is a URL and the rules
 * run once, in getVenueCalendar — the same call the API route makes. With no
 * range given it opens on the next seven days.
 */

export const dynamic = 'force-dynamic';

type SearchParams = { from?: string; to?: string };

function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The field messages from a refused range, e.g. "The end date cannot be before the start date." */
function messagesFrom(error: ValidationError): string[] {
  const details = error.details as
    | { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> }
    | undefined;
  const messages = [...(details?.formErrors ?? []), ...Object.values(details?.fieldErrors ?? {}).flat()].filter(
    (m): m is string => Boolean(m),
  );
  return messages.length > 0 ? messages : [error.message];
}

const STATE_STYLE: Record<CalendarSlot['state'], string> = {
  outside_operating_hours: 'text-[var(--text-muted)]',
  blocked: 'text-[var(--warning)] font-medium',
  confirmed: 'text-[var(--brand)] font-medium',
  pending_request: 'text-[var(--text)]',
  available: 'text-[var(--success)]',
};

function SlotCell({ slot }: { slot: CalendarSlot }) {
  return (
    <td className="p-3 align-top">
      <span className={STATE_STYLE[slot.state]}>{CALENDAR_SLOT_STATE_LABELS[slot.state]}</span>
      {slot.state === 'outside_operating_hours' && (
        <span className="block text-xs text-[var(--text-muted)]">Cannot be requested</span>
      )}
      {slot.state === 'blocked' && slot.reason && (
        <span className="block text-xs text-[var(--text-muted)]">Reason: {slot.reason}</span>
      )}
      {slot.state === 'confirmed' && slot.event && (
        <span className="block text-xs">
          {slot.event.reference} · {slot.event.name}
        </span>
      )}
      {slot.state === 'confirmed' && slot.pendingRequests > 0 && (
        <span className="block text-xs text-[var(--text-muted)]">
          +{slot.pendingRequests} pending {slot.pendingRequests === 1 ? 'request' : 'requests'}, not a commitment
        </span>
      )}
      {slot.state === 'pending_request' && slot.pendingRequests > 1 && (
        <span className="block text-xs text-[var(--text-muted)]">{slot.pendingRequests} requests</span>
      )}
    </td>
  );
}

export default async function VenueCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const actor = await getCurrentActor();
  if (!canViewVenueCatalogue(actor.roles)) {
    return <NoVenueAccess need="view" />;
  }

  const { id } = await params;
  const query = await searchParams;
  const from = query.from ?? todayInSingapore();
  const to = query.to ?? plusDays(from, 6);

  let calendar: VenueCalendar | null = null;
  let errors: string[] = [];
  try {
    calendar = await getVenueCalendar(id, { from, to }, actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (!(error instanceof ValidationError)) throw error;
    errors = messagesFrom(error);
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link href={`/venues/${id}`} className="text-sm text-[var(--brand)] underline">
        Back to venue
      </Link>
      <h1 className="mb-6 mt-3 text-2xl font-semibold">
        {calendar ? `${calendar.venue.name}: calendar` : 'Venue calendar'}
      </h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-4 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
        <div>
          <label htmlFor="from" className="mb-1 block text-sm font-medium">
            From
          </label>
          <input id="from" name="from" type="date" required defaultValue={from} className="rounded border border-[var(--border)] px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-sm font-medium">
            To
          </label>
          <input id="to" name="to" type="date" required defaultValue={to} className="rounded border border-[var(--border)] px-3 py-2 text-sm" />
        </div>
        <button
          type="submit"
          className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
        >
          Show calendar
        </button>
        <p className="w-full text-xs text-[var(--text-muted)]">Up to {CALENDAR_MAX_DAYS} days at a time.</p>
      </form>

      {errors.length > 0 && (
        <ul role="alert" className="mb-4 rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {calendar && (
        <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]" aria-live="polite">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th scope="col" className="p-3 font-medium">
                  Date
                </th>
                {OPERATING_SLOTS.map((slot) => (
                  <th key={slot} scope="col" className="p-3 font-medium">
                    {OPERATING_SLOT_LABELS[slot]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calendar.days.map((day) => (
                <tr key={day.date} className="border-b border-[var(--border)] last:border-b-0">
                  <th scope="row" className="p-3 align-top font-medium">
                    {formatSingaporeDate(day.date)}
                    {day.fullyCommitted && (
                      <span className="block text-xs font-medium text-[var(--warning)]">Fully committed</span>
                    )}
                  </th>
                  {day.slots.map((slot) => (
                    <SlotCell key={slot.slot} slot={slot} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
