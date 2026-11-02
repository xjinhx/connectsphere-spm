import { describe, expect, it } from 'vitest';
import { formatChangeRequestValue } from '@/domain/change-request/policy';

/**
 * SCRUM-272 (bug on SCRUM-187 AC6): a change request line printed the stored
 * YYYY-MM-DD date. Dates shown to users are DD/MM/YYYY (Sprint 4 Planning).
 * The event page shows each line as "<current> → <proposed>" through
 * formatChangeRequestValue. Test case IDs match the SCRUM-272 tab of the test
 * case sheet.
 */

function line(field: Parameters<typeof formatChangeRequestValue>[0], current: unknown, proposed: unknown): string {
  return `${formatChangeRequestValue(field, current)} → ${formatChangeRequestValue(field, proposed)}`;
}

describe('SCRUM-272: change request lines show dates as DD/MM/YYYY', () => {
  it("TC-272-01: a Proposed date line reads '21/11/2026 → 28/11/2026'", () => {
    expect(line('proposedDate', '2026-11-21', '2026-11-28')).toBe('21/11/2026 → 28/11/2026');
  });

  it('TC-272-01: the day and month are not swapped or shifted by a time zone', () => {
    expect(formatChangeRequestValue('proposedDate', '2026-01-02')).toBe('02/01/2026');
    expect(formatChangeRequestValue('proposedDate', '2026-12-31')).toBe('31/12/2026');
  });

  it("TC-272-02: an Expected attendance line still reads '150 → 220'", () => {
    expect(line('expectedAttendance', 150, 220)).toBe('150 → 220');
  });

  it("TC-272-02: a missing value is still shown as '—'", () => {
    expect(line('proposedDate', null, '2026-11-28')).toBe('— → 28/11/2026');
    expect(formatChangeRequestValue('description', undefined)).toBe('—');
  });

  it('TC-272-02: other text and time values are shown as entered', () => {
    expect(line('startTime', '09:00', '10:30')).toBe('09:00 → 10:30');
    expect(formatChangeRequestValue('name', '2026-11-21 Gala')).toBe('2026-11-21 Gala');
  });
});
