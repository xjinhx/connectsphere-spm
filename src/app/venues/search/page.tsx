import Link from 'next/link';
import { getVenueFormOptions, searchVenues } from '@/domain/venues/service';
import { canViewVenueCatalogue } from '@/domain/venues/policy';
import {
  NO_VENUE_MATCHES_FILTERS_MESSAGE,
  ROOM_LAYOUTS,
  ROOM_LAYOUT_LABELS,
  type VenueSearchResult,
} from '@/domain/venues/schema';
import { END_OF_DAY, isQuarterHourEnd, isQuarterHourStart } from '@/domain/shared/times';
import { ValidationError } from '@/domain/shared/errors';
import { formatSingaporeDate, LATEST_DATE } from '@/domain/shared/dates';
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
 * SCRUM-130 narrows it: minimum capacity (AC1, AC2), a layout (AC2, AC3),
 * facilities (AC4), a location from the maintained list or all locations
 * (AC5, AC6) and accessibility features (AC7). Every filter set must hold.
 * With filters set and nothing found, the page says so in those words.
 *
 * A server component with a plain GET form, so a search is a URL and the
 * rules run once, in searchVenues — the same call /api/venues/search makes.
 * Needs venue_catalogue_view, checked before anything is read.
 */

export const dynamic = 'force-dynamic';

type SearchParams = {
  date?: string;
  start?: string;
  end?: string;
  // SCRUM-130
  minCapacity?: string;
  layout?: string;
  location?: string;
  facility?: string | string[];
  accessibility?: string | string[];
};

/** A repeated query parameter (a ticked checkbox) as a list. */
const listOf = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

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
  const options = await getVenueFormOptions();
  const chosenFacilities = listOf(params.facility);
  const chosenFeatures = listOf(params.accessibility);
  const chosenLayout = ROOM_LAYOUTS.find((layout) => layout === params.layout) ?? null;

  let result: VenueSearchResult | null = null;
  let errors: string[] = [];
  if (searched) {
    try {
      result = await searchVenues({
        date: params.date,
        start: params.start,
        end: params.end,
        minCapacity: params.minCapacity,
        layout: params.layout,
        locationId: params.location,
        facilityIds: chosenFacilities,
        accessibilityFeatureIds: chosenFeatures,
      });
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
            max={LATEST_DATE}
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

        {/* SCRUM-130: optional filters. Left blank, each one narrows nothing. */}
        <fieldset className="mb-4 border-t border-[var(--border)] pt-4">
          <legend className="mb-2 text-sm font-semibold">Filters (optional)</legend>
          <div className="mb-4 flex flex-wrap gap-4">
            <div>
              <label htmlFor="minCapacity" className="mb-1 block text-sm font-medium">
                Minimum capacity
              </label>
              {/* AC1, AC2. Text, not a number input, so the server's message names a bad value (TC-130-05). */}
              <input
                id="minCapacity"
                name="minCapacity"
                type="text"
                inputMode="numeric"
                defaultValue={params.minCapacity ?? ''}
                className="w-36 rounded border border-[var(--border)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="layout" className="mb-1 block text-sm font-medium">
                Layout
              </label>
              <select
                id="layout"
                name="layout"
                defaultValue={params.layout ?? ''}
                className="rounded border border-[var(--border)] px-3 py-2 text-sm"
              >
                <option value="">Any layout</option>
                {ROOM_LAYOUTS.map((layout) => (
                  <option key={layout} value={layout}>
                    {ROOM_LAYOUT_LABELS[layout]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="location" className="mb-1 block text-sm font-medium">
                Location
              </label>
              {/* AC5: only the maintained list. AC6: "All locations" leaves it unset. */}
              <select
                id="location"
                name="location"
                defaultValue={params.location ?? ''}
                className="rounded border border-[var(--border)] px-3 py-2 text-sm"
              >
                <option value="">All locations</option>
                {options.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-8">
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Required facilities</legend>
              {options.facilities.map((facility) => (
                <label key={facility.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="facility"
                    value={facility.id}
                    defaultChecked={chosenFacilities.includes(facility.id)}
                  />
                  {facility.name}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Required accessibility features</legend>
              {options.accessibilityFeatures.map((feature) => (
                <label key={feature.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="accessibility"
                    value={feature.id}
                    defaultChecked={chosenFeatures.includes(feature.id)}
                  />
                  {feature.name}
                </label>
              ))}
            </fieldset>
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
            {formatSingaporeDate(result.date)} from {result.start} to {result.end}.
          </p>

          {result.venues.length === 0 ? (
            <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
              {result.filtered
                ? `${NO_VENUE_MATCHES_FILTERS_MESSAGE}.`
                : 'No venue is open and free for that whole period on that date.'}
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
                    {chosenLayout ? (
                      <th scope="col" className="p-3 font-medium">
                        {ROOM_LAYOUT_LABELS[chosenLayout]} capacity
                      </th>
                    ) : null}
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
                      {chosenLayout ? <td className="p-3">{venue.layoutCapacity}</td> : null}
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
