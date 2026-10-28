'use client';

import { useState } from 'react';
import { START_TIME_OPTIONS, endTimesAfter, keepEndAfterStart } from '@/domain/shared/times';

/**
 * The venue search's start and end time pickers (SCRUM-239 AC2).
 *
 * SCRUM-266: the end offers only times after the chosen start, and is cleared
 * when the start moves to or past it. They stay plain named selects, so the
 * page's GET form still sends ?start=&end= and a search is still a URL; the
 * server refuses an end not after the start, as before.
 */
export function SearchTimeFields({ start: initialStart, end: initialEnd }: { start: string; end: string }) {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);

  return (
    <div className="mb-4 flex flex-wrap gap-4">
      <div>
        <label htmlFor="start" className="mb-1 block text-sm font-medium">
          Start time
        </label>
        <select
          id="start"
          name="start"
          required
          value={start}
          onChange={(event) => {
            const next = event.target.value;
            setStart(next);
            setEnd((current) => keepEndAfterStart(next, current));
          }}
          className="rounded border border-[var(--border)] px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Choose
          </option>
          {START_TIME_OPTIONS.map((time) => (
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
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          className="rounded border border-[var(--border)] px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Choose
          </option>
          {endTimesAfter(start).map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
