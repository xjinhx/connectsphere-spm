import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Venue service rules that are decided before any query runs, so the data
 * layer is replaced with spies and nothing here needs a database.
 */

vi.mock('@/lib/supabase/venues', () => ({
  fetchVenueDetail: vi.fn(),
}));

import { fetchVenueDetail } from '@/lib/supabase/venues';
import { getVenue } from '@/domain/venues/service';

beforeEach(() => {
  vi.mocked(fetchVenueDetail).mockReset();
});

describe('getVenue: SCRUM-121 AC2', () => {
  // Found reviewing SCRUM-215: /venues/abc answered 500, not the not-found page.
  it.each(['abc', '1234', 'not-a-venue-id'])(
    'treats the malformed id "%s" as a venue that does not exist, without querying',
    async (id) => {
      await expect(getVenue(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(fetchVenueDetail).not.toHaveBeenCalled();
    },
  );
});
