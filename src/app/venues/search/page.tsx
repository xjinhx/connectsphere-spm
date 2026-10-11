import Link from 'next/link';
import { searchVenues } from '@/domain/venues/service';
import { canViewVenueCatalogue } from '@/domain/venues/policy';
import { type VenueSearchResult } from '@/domain/venues/schema';
import { END_OF_DAY, isQuarterHourEnd, isQuarterHourStart } from '@/domain/shared/times';
import { ValidationError } from '@/domain/shared/errors';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';
import NoVenueAccess from '@/components/venue/NoVenueAccess';

/**
 * SCRUM-239 AC2 Search venues by date and exact start and end time (replacing
 * SCRUM-128's slots, which stays Done on slots per the Week 7 guide).
 *
 * Only venues open for the whole period (AC1) and with nothing committed in
 * any of it are listed: a confirmed booking (AC2) or an unavailable period
 * (AC8) excludes the venue; one that only touches the period doesn't. Any date, however far
 * ahead (SCRUM-128 AC5).
 *
 * A server component with a plain GET form, so a search is a URL and the
 * rules run once, in searchVenues — the same call /api/venues/search makes.
 * Needs venue_catalogue_view, checked before anything is read.
 */

export const dynamic = 'force-dynamic';

type SearchParams = { date?: string; start?: string; end?: string };

/** Every quarter hour of the day, 00:00 to 24:00. The pickers offer only these (SCRUM-238 AC1). */
const QUARTER_HOURS: string[] = Array.from({ length: 24 * 4 + 1 }, (_, i) =>
  i === 24 * 4 ? END_OF_DAY : `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
);
const START_TIMES = QUARTER_HOURS.filter(isQuarterHourStart);
const END_TIMES = QUARTER_HOURS.filter(isQuarterHourEnd);

/** The field messages from a failed search, e.g. "Select at least one slot." */
function messagesFrom(error: ValidationError): string[] {
  const details = error.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined;
  const messages = Object.values(details?.fieldErrors ?? {}).flat().filter((m): m is string => Boolean(m));
  return messages.length > 0 ? messages : [error.message];
}

export default async function VenueSearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!canViewVenueCatalogue(actor.roles)) {
    return <NoVenueAccess need="view" />;
  }

  const params = await searchParams;
  const searched = params.date !== undefined;

  let result: VenueSearchResult | null = null;
  let errors: string[] = [];
  if (searched) {
    try {
      result = await searchVenues({ date: params.date, start: params.start, end: params.end });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      errors = messagesFrom(error);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Search venues by date and time</h1>
        <Link href="/venues" className="text-sm text-[var(--brand)] underline">
          Back to catalogue
        </Link>
      </div>

      <form method="get" className="mb-6 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-4">
          <label htmlFor="date" className="mb-1 block text-sm font-medium">
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={params.date ?? ''}
            className="rounded border border-[var(--border)] px-3 py-2 text-sm"
          />
        </div>

        <div className="mb-4 flex flex-wrap gap-4">
          <div>
            <label htmlFor="start" className="mb-1 block text-sm font-medium">
              Start time
            </label>
            <select
              id="start"
              name="start"
              required
              defaultValue={params.start ?? ''}
              className="rounded border border-[var(--border)] px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Choose
              </option>
              {START_TIMES.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="end" className="mb-1 block text-sm font-medium">
              End time
            </label>
            <select
              id="end"
              name="end"
              required
              defaultValue={params.end ?? ''}
              className="rounded border border-[var(--border)] px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Choose
              </option>
              {END_TIMES.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
        >
          Search
        </button>
      </form>

      {errors.length > 0 && (
        <ul role="alert" className="mb-4 rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {result && (
        <section aria-live="polite">
          <p className="mb-3 text-sm text-[var(--text-muted)]">
            {result.venues.length} {result.venues.length === 1 ? 'venue is' : 'venues are'} free on{' '}
            {formatSingaporeDate(result.date)} from {result.start} to {result.end}.
          </p>

          {result.venues.length === 0 ? (
            <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
              No venue is open and free for that whole period on that date.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                    <th scope="col" className="p-3 font-medium">
                      Name
                    </th>
                    <th scope="col" className="p-3 font-medium">
                      Location
                    </th>
                    <th scope="col" className="p-3 font-medium">
                      Maximum capacity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.venues.map((venue) => (
                    <tr key={venue.id} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="p-3">
                        <Link href={`/venues/${venue.id}`} className="text-[var(--brand)] underline">
                          {venue.name}
                        </Link>
                      </td>
                      <td className="p-3">{venue.location.name}</td>
                      <td className="p-3">{venue.maxCapacity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
