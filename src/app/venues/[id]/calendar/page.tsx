import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getVenueCalendar } from '@/domain/venues/calendar';
import { canViewVenueCatalogue } from '@/domain/venues/policy';
import {
  CALENDAR_MAX_DAYS,
  CALENDAR_PERIOD_LABELS,
  type CalendarPeriod,
  type VenueCalendar,
} from '@/domain/venues/schema';
import { NotFoundError, ValidationError } from '@/domain/shared/errors';
import { formatSingaporeDate, todayInSingapore } from '@/domain/shared/dates';
import { formatExpiry } from '@/domain/venue-hold/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import NoVenueAccess from '@/components/venue/NoVenueAccess';

/**
 * SCRUM-239 AC5 View a venue's calendar in exact time ranges (replacing
 * SCRUM-123's AM / PM / Night slots, which stays Done on slots).
 *
 * Each date lists its confirmed, pending, held and blocked periods with their
 * exact start and end times, in time order; no fixed lunch or dinner gap is
 * drawn. SCRUM-123's rules carry over: the venue's opening hours, outside which
 * it cannot be requested (AC3); Fully committed when committed periods cover
 * them (AC4); a Blocked period with its reason (AC7); a pending request shown
 * beside a commitment, never as one (AC8). SCRUM-227 AC7: a Held period with
 * its expiry time. AC9/AC10: needs
 * venue_catalogue_view, checked before anything is read; the API route
 * enforces the same rule with a 403. SCRUM-148 AC3/AC4: a Confirmed period
 * names its event for Venue Staff, the event's coordinator and Operations
 * Managers; others see only Confirmed.
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

const KIND_STYLE: Record<CalendarPeriod['kind'], string> = {
  confirmed: 'text-[var(--brand)] font-medium',
  pending: 'text-[var(--text)]',
  held: 'text-[var(--text)] font-medium',
  blocked: 'text-[var(--warning)] font-medium',
};

function PeriodItem({ period }: { period: CalendarPeriod }) {
  return (
    <li className="py-1">
      <span className="tabular-nums">
        {period.start}–{period.end}
      </span>{' '}
      <span className={KIND_STYLE[period.kind]}>{CALENDAR_PERIOD_LABELS[period.kind]}</span>
      {period.kind === 'pending' && <span className="text-xs text-[var(--text-muted)]"> · not a commitment</span>}
      {period.kind === 'blocked' && period.reason && (
        <span className="block text-xs text-[var(--text-muted)]">Reason: {period.reason}</span>
      )}
      {period.kind === 'held' && period.expiresAt && (
        <span className="block text-xs text-[var(--text-muted)]">Expires {formatExpiry(period.expiresAt)}</span>
      )}
      {period.kind === 'confirmed' && period.event && (
        <span className="block text-xs">
          {period.event.reference} · {period.event.name}
        </span>
      )}
    </li>
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
        <section aria-live="polite">
          <p className="mb-3 text-sm text-[var(--text-muted)]">
            Open {calendar.venue.opensAt}–{calendar.venue.closesAt}. Outside these hours the venue cannot be requested.
          </p>
          <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th scope="col" className="w-48 p-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Periods
                  </th>
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
                    <td className="p-3 align-top">
                      {day.periods.length === 0 ? (
                        <span className="text-[var(--success)]">
                          Available {calendar.venue.opensAt}–{calendar.venue.closesAt}
                        </span>
                      ) : (
                        <ul>
                          {day.periods.map((period) => (
                            <PeriodItem key={`${period.kind}-${period.start}-${period.end}`} period={period} />
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
