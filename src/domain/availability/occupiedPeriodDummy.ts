import { END_OF_DAY, toMinutes, type ClockRange, type ClockTime } from '@/domain/shared/times';

/**
 * DUMMY(SCRUM-225) D-17: stands in for SCRUM-225's occupied-time rule, which
 * SCRUM-225's owner is writing ("I'll write the setup + turnaround rule in
 * 225, and 226 calls it inside getVenueCommitments", 10 Oct 2026). SCRUM-226
 * only calls it. When SCRUM-225 merges, import its function in
 * src/domain/availability/service.ts instead and delete this file (see D-17
 * in docs/dummies.md).
 *
 * Shaped as agreed for the real one: a period and the venue's setup and
 * turnaround in, the occupied period out. Setup comes before the start and
 * turnaround after the end (SCRUM-226: 10:00-12:00 with 30 min setup and
 * 45 min turnaround is occupied 09:30-12:45).
 *
 * Kept to one date: the result never starts before 00:00 or ends after 24:00.
 * The PO's assumption (8 Oct 2026) is that setup and turnaround fit inside the
 * venue's opening hours, which end by 24:00, so a real booking never needs
 * more; the clamp only keeps the arithmetic safe for a search window.
 */

/** A venue's setup and turnaround, in minutes on the 15-minute unit. */
export interface SetupTurnaround {
  setupMinutes: number;
  turnaroundMinutes: number;
}

export function occupiedPeriod(period: ClockRange, venue: SetupTurnaround): ClockRange {
  return {
    start: clockTime(Math.max(0, toMinutes(period.start) - venue.setupMinutes)),
    end: clockTime(Math.min(toMinutes(END_OF_DAY), toMinutes(period.end) + venue.turnaroundMinutes)),
  };
}

function clockTime(minutes: number): ClockTime {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
