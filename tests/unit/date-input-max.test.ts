import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isISODate, LATEST_DATE, LATEST_DATE_TIME } from '@/domain/shared/dates';

/**
 * SCRUM-267 (bug on SCRUM-76, 150, 151, 227, 239): a date input without a max
 * lets a mistyped year run on to 275760. The browser enforces the max, so the
 * check here is that each input carries it; tests/e2e/scrum-267-date-year-overflow.spec.ts
 * types into the venue search and calendar to show the browser stopping at
 * four digits. Test case IDs match the SCRUM-267 tab of the test case sheet.
 */

const SRC = join(process.cwd(), 'src');

/** Every `<input ...>` tag in a file, read up to its closing `>` outside any `{...}`. */
function inputTags(source: string): string[] {
  const tags: string[] = [];
  let from = source.indexOf('<input');
  while (from !== -1) {
    let depth = 0;
    let end = from;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(source.slice(from, end + 1));
    from = source.indexOf('<input', end);
  }
  return tags;
}

function dateInputs(file: string): string[] {
  const source = readFileSync(join(SRC, file), 'utf8');
  return inputTags(source).filter((tag) => /type="(date|datetime-local)"/.test(tag));
}

/** True when the input caps the year at 9999, as SCRUM-258 did on the booking line. */
function hasYearLimit(tag: string): boolean {
  if (tag.includes('type="datetime-local"')) return tag.includes('max={LATEST_DATE_TIME}');
  return tag.includes('max={LATEST_DATE}') || tag.includes('max="9999-12-31"');
}

function expectAllCapped(file: string, count: number): void {
  const inputs = dateInputs(file);
  expect(inputs).toHaveLength(count);
  for (const tag of inputs) {
    expect(hasYearLimit(tag), `${file}: ${tag}`).toBe(true);
  }
}

function allSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return allSourceFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('SCRUM-267: every date input stops the year at 9999', () => {
  it('TC-267-01: Proposed date on New event request (already capped by SCRUM-257)', () => {
    expectAllCapped('components/event-request/EventRequestForm.tsx', 1);
  });

  it('TC-267-02: Mark a period unavailable', () => {
    expectAllCapped('components/venue/MarkPeriodUnavailableForm.tsx', 1);
  });

  it('TC-267-03: Hold a venue, Date and Hold expires at', () => {
    expectAllCapped('components/venue/HoldVenueForm.tsx', 2);
  });

  it('TC-267-04: Suggest another date when rejecting a booking line', () => {
    expectAllCapped('components/venue-booking/VenueBookingDecisionForm.tsx', 1);
  });

  it('TC-267-05: Venue search Date', () => {
    expectAllCapped('app/venues/search/page.tsx', 1);
  });

  it('TC-267-06: Venue calendar From and To', () => {
    expectAllCapped('app/venues/[id]/calendar/page.tsx', 2);
  });

  it('TC-267-07: Edit schedule Date on the event page', () => {
    expectAllCapped('components/event-request/EventSchedulePanel.tsx', 1);
  });

  it('TC-267-08: the limit is 31/12/9999 itself, so that date is still accepted', () => {
    expect(LATEST_DATE).toBe('9999-12-31');
    expect(isISODate(LATEST_DATE)).toBe(true);
    expect(LATEST_DATE_TIME).toBe('9999-12-31T23:59');
  });

  it('no date input anywhere in src is left without the limit', () => {
    const missing = allSourceFiles(SRC).flatMap((path) =>
      dateInputs(relative(SRC, path))
        .filter((tag) => !hasYearLimit(tag))
        .map((tag) => `${relative(SRC, path)}: ${tag}`),
    );
    expect(missing).toEqual([]);
  });
});
