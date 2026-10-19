import { describe, it, expect } from 'vitest';
import {
  EVENT_REQUEST_STATUS_DEFINITIONS,
  EventRequestStatusEnum,
} from '@/domain/event-request/schema';

/**
 * SCRUM-99 — See the current status of an event.
 *
 * AC text is from the Jira card, which is authoritative. Test case IDs match
 * the SCRUM-99 sheet of the Sprint 2 test case workbook (TC-99-NN).
 *
 * These test that a definition is held for every status. That the event page
 * shows it beside the badge is a page over the database: open /events/<id>.
 */

// One test per status, in the order the workbook lists them.
const AC1_CASES = [
  ['TC-99-01', 'draft'],
  ['TC-99-02', 'submitted'],
  ['TC-99-03', 'clarification_requested'],
  ['TC-99-04', 'approved'],
  ['TC-99-05', 'rejected'],
  ['TC-99-06', 'planning'],
  ['TC-99-07', 'confirmed'],
  // SCRUM-234 added Preparation after the workbook was written; no TC-99 id.
  ['SCRUM-234', 'preparation'],
  ['TC-99-08', 'completed'],
  ['TC-99-09', 'cancelled'],
] as const;

describe('SCRUM-99 AC1 — the status is shown with its one-line definition', () => {
  it.each(AC1_CASES)('%s: %s has a one-line definition', (_id, status) => {
    const definition = EVENT_REQUEST_STATUS_DEFINITIONS[status];
    expect(definition.trim()).not.toBe('');
    expect(definition).not.toContain('\n');
    expect(definition.endsWith('.')).toBe(true);
  });

  it('has a test case for every status, so a new status cannot go unchecked', () => {
    expect(AC1_CASES.map(([, status]) => status).sort()).toEqual([...EventRequestStatusEnum.options].sort());
  });
});
