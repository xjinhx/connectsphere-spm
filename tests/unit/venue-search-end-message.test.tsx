import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-266 Exp 4: when the venue search refuses an end not after the start,
 * the message shows once. ClockRangeSchema reports it on both time fields
 * (SCRUM-238 AC2), and the page listed each field's message, so it showed
 * twice. The page is rendered for real, as a coordinator; only the session and
 * the reads behind it are replaced, and the refusal is built from the real
 * search schema, as searchVenues builds it.
 */

// next/link needs the App Router mounted; a plain anchor is enough here.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/venues/service', () => ({ getVenueFormOptions: vi.fn(), searchVenues: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { getVenueFormOptions, searchVenues } from '@/domain/venues/service';
import { MIN_CAPACITY_MESSAGE, VenueSearchFiltersSchema, VenueSearchQuerySchema } from '@/domain/venues/schema';
import { ValidationError } from '@/domain/shared/errors';
import VenueSearchPage from '@/app/venues/search/page';

const END_MESSAGE = 'The end time must be after the start time.';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: 'Coordinator A',
    roles: ['coordinator'],
    clientOrganisation: null,
  });
  vi.mocked(getVenueFormOptions).mockResolvedValue({
    locations: [],
    facilities: [],
    accessibilityFeatures: [],
    operatingSlots: [],
    layouts: [],
  });
});

/** The refusal searchVenues throws for these query parameters, field messages from the real schemas. */
function refusalFor(params: Record<string, string>): ValidationError {
  const query = VenueSearchQuerySchema.safeParse(params);
  const filters = VenueSearchFiltersSchema.safeParse(params);
  return new ValidationError('The search could not be run.', {
    formErrors: query.success ? [] : query.error.flatten().formErrors,
    fieldErrors: {
      ...(query.success ? {} : query.error.flatten().fieldErrors),
      ...(filters.success ? {} : filters.error.flatten().fieldErrors),
    },
  });
}

async function renderSearch(params: Record<string, string>): Promise<string> {
  vi.mocked(searchVenues).mockRejectedValue(refusalFor(params));
  const page = (await VenueSearchPage({ searchParams: Promise.resolve(params) })) as ReactElement;
  return renderToStaticMarkup(page);
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe('TC-266-06: a bad range typed into the search address (Exp 4)', () => {
  it('lists "The end time must be after the start time." once, though both time fields carry it', async () => {
    const params = { date: '2026-12-17', start: '14:30', end: '14:00' };
    expect(refusalFor(params).details).toMatchObject({ fieldErrors: { start: [END_MESSAGE], end: [END_MESSAGE] } });

    const html = await renderSearch(params);

    expect(count(html, END_MESSAGE)).toBe(1);
    expect(html).not.toContain('<table');
  });

  it('still lists every different message, each once', async () => {
    const html = await renderSearch({ date: '2026-12-17', start: '14:30', end: '14:00', minCapacity: '0' });

    expect(count(html, END_MESSAGE)).toBe(1);
    expect(count(html, MIN_CAPACITY_MESSAGE)).toBe(1);
  });
});
