import Link from 'next/link';
import { searchVenues } from '@/domain/venues/service';
import { canViewVenueCatalogue } from '@/domain/venues/policy';
import { OPERATING_SLOTS, OPERATING_SLOT_LABELS, type VenueSearchResult } from '@/domain/venues/schema';
import { ValidationError } from '@/domain/shared/errors';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';
import NoVenueAccess from '@/components/venue/NoVenueAccess';

/**
 * SCRUM-128 Search venues by date and slot.
 *
 * AC1 enter a date and select one or more slots; only venues free in every
 *     selected slot are listed.
 * AC2-AC4 a confirmed booking or a slot recorded as unavailable excludes the
 *     venue; a booking in another slot doesn't.
 * AC5 any date, however far ahead.
 *
 * A server component with a plain GET form, so a search is a URL and the
 * rules run once, in searchVenues — the same call /api/venues/search makes.
 * Needs venue_catalogue_view, checked before anything is read.
 */

export const dynamic = 'force-dynamic';

type SearchParams = { date?: string; slots?: string | string[] };

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
  const selected = ([] as string[]).concat(params.slots ?? []);
  const searched = params.date !== undefined;

  let result: VenueSearchResult | null = null;
  let errors: string[] = [];
  if (searched) {
    try {
      result = await searchVenues({ date: params.date, slots: selected });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      errors = messagesFrom(error);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Search venues by date and slot</h1>
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

        <fieldset className="mb-4">
          <legend className="mb-1 text-sm font-medium">Slots — a venue must be free in every one you select</legend>
          <div className="flex flex-wrap gap-4">
            {OPERATING_SLOTS.map((slot) => (
              <label key={slot} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="slots" value={slot} defaultChecked={selected.includes(slot)} />
                {OPERATING_SLOT_LABELS[slot]}
              </label>
            ))}
          </div>
        </fieldset>

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
            {formatSingaporeDate(result.date)} in {result.slots.map((slot) => OPERATING_SLOT_LABELS[slot]).join(', ')}.
          </p>

          {result.venues.length === 0 ? (
            <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
              No venue is free in every selected slot on that date.
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
